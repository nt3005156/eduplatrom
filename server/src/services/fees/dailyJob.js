// Daily fee job. Runs once per school date, between 00:00 and 02:00 Asia/Kathmandu.
//
// What one run does:
//   1. Reconciles yesterday's payments (and every completed Khalti attempt) against the ledger.
//   2. Stores each mismatch as an exception. An exception stays open until someone resolves it.
//   3. Applies the automatic credit refunds (closed account, or credit unused for 90 days).
//   4. Escalates open exceptions to the Head of Finance when they are older than 48 hours or above the threshold.
//   5. Sends reports. Finance gets the full itemized list, Ops gets a summary, and the Head of Finance gets escalations.
//      Every send is recorded with its real outcome: sent, simulated, held (no provider or no recipients), or failed.
//
// Recipients come from env (comma-separated emails):
//   FEES_FINANCE_EMAILS, FEES_OPS_EMAILS, FEES_HEAD_FINANCE_EMAILS
// FEES_ESCALATE_AMOUNT_PAISA sets the escalation threshold (default 5,000,000 paisa = NPR 50,000).
// FEES_DAILY_JOB=off disables the schedule. A manual run is still possible through the API.
import db from '../../db/index.js';
import { logAudit } from '../../utils/audit.js';
import { reconcile, todayNepal, autoRefundCredits } from './ledger.js';
import { send, ProviderError } from '../messaging/providers.js';

const JOB = 'daily';
const WINDOW_HOURS = [0, 1];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function nepalHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

export function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const money = paisa => `NPR ${(Number(paisa || 0) / 100).toFixed(2)}`;

export function escalationThreshold() {
  return Number(process.env.FEES_ESCALATE_AMOUNT_PAISA) || 5000000;
}

function recipientsFrom(envName) {
  return String(process.env[envName] || '').split(',').map(s => s.trim()).filter(e => EMAIL_RE.test(e));
}

const insDispatch = db.prepare('INSERT INTO fee_dispatches (run_date, audience, recipient, subject, body, status, error) VALUES (?,?,?,?,?,?,?)');

async function dispatch(runDate, audience, envName, subject, body) {
  const list = recipientsFrom(envName);
  const counts = { sent: 0, simulated: 0, held: 0, failed: 0 };
  if (list.length === 0) {
    insDispatch.run(runDate, audience, null, subject, body, 'held', `no recipients configured (${envName})`);
    counts.held++;
    return counts;
  }
  for (const to of list) {
    let status;
    let error = null;
    try {
      const r = await send({ channel: 'email', recipient: to, subject, body });
      status = r?.simulated ? 'simulated' : 'sent';
    } catch (err) {
      status = err instanceof ProviderError && err.notConfigured ? 'held' : 'failed';
      error = String(err.message || err).slice(0, 300);
    }
    insDispatch.run(runDate, audience, to, subject, body, status, error);
    counts[status]++;
  }
  return counts;
}

const findEx = db.prepare('SELECT * FROM reconciliation_exceptions WHERE exception_key = ?');
const insEx = db.prepare('INSERT INTO reconciliation_exceptions (exception_key, type, amount_paisa, details, first_seen_date, last_seen_date) VALUES (?,?,?,?,?,?)');
const touchEx = db.prepare('UPDATE reconciliation_exceptions SET last_seen_date = ?, details = ?, amount_paisa = ? WHERE id = ?');
const reopenEx = db.prepare(`UPDATE reconciliation_exceptions SET status = 'open', first_seen_date = ?, last_seen_date = ?, details = ?, amount_paisa = ?,
  escalated_at = NULL, resolved_by = NULL, resolved_at = NULL, resolution_note = NULL WHERE id = ?`);

function exceptionKey(m) {
  return [m.type, m.payment_id ?? '', m.gateway_id ?? '', m.provider_transaction_id ?? ''].join(':');
}

/** Stores mismatches. The same mismatch is one row, however many days it is seen. */
export function recordExceptions(mismatches, today) {
  for (const m of mismatches) {
    const key = exceptionKey(m);
    const amount = m.amount_paisa ?? m.payment_paisa ?? m.gateway_paisa ?? m.settlement_paisa ?? null;
    const details = JSON.stringify(m);
    const ex = findEx.get(key);
    if (!ex) insEx.run(key, m.type, amount, details, today, today);
    else if (ex.status === 'resolved') reopenEx.run(today, today, details, amount, ex.id);
    else touchEx.run(today, details, amount, ex.id);
  }
}

export function openExceptions() {
  return db.prepare("SELECT * FROM reconciliation_exceptions WHERE status = 'open' ORDER BY first_seen_date, id").all();
}

function exceptionsDueForEscalation(today) {
  return db.prepare(`SELECT * FROM reconciliation_exceptions WHERE status = 'open' AND escalated_at IS NULL
    AND (amount_paisa >= ? OR first_seen_date <= ?) ORDER BY id`).all(escalationThreshold(), shiftDate(today, -2));
}

const markEscalated = db.prepare("UPDATE reconciliation_exceptions SET escalated_at = datetime('now') WHERE id = ?");

function lookupFailuresOn(day) {
  return db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE module = 'fees' AND action = 'lookup_unavailable'
    AND date(created_at, '+5 hours', '+45 minutes') = ?`).get(day).n;
}

function exceptionLines(list) {
  if (list.length === 0) return ['  (none open)'];
  return list.map(e => `  - #${e.id} ${e.type} | ${e.amount_paisa != null ? money(e.amount_paisa) : 'no amount'} | first seen ${e.first_seen_date}${e.escalated_at ? ' | escalated' : ''}`);
}

/**
 * Runs the daily job. Safe to call often: it does nothing outside the window, and only one run per school date is stored.
 * @returns {Promise<{ran: boolean, reason?: string, run_date?: string, summary?: object}>}
 */
export async function runDailyFeeJob({ now = new Date(), force = false } = {}) {
  const today = todayNepal(now);
  const hour = nepalHour(now);
  if (!force && !WINDOW_HOURS.includes(hour)) return { ran: false, reason: 'outside_window', run_date: today };

  const claim = db.prepare('INSERT OR IGNORE INTO fee_job_runs (job, run_date) VALUES (?,?)').run(JOB, today);
  if (claim.changes === 0) return { ran: false, reason: 'already_ran', run_date: today };

  let dispatching = false;
  try {
    const yesterday = shiftDate(today, -1);
    const rec = reconcile({ from: yesterday, to: yesterday });
    recordExceptions(rec.mismatches, today);
    const refunds = autoRefundCredits(now);
    const open = openExceptions();
    const toEscalate = exceptionsDueForEscalation(today);
    const failures = lookupFailuresOn(yesterday);

    dispatching = true;
    const summary = {
      run_date: today, reconciled_date: yesterday,
      payments: rec.totals.payment_count, payments_paisa: rec.totals.payments_paisa, refunds_paisa: rec.totals.refunds_paisa,
      mismatches_found: rec.mismatches.length, open_exceptions: open.length, escalated: toEscalate.length,
      provider_lookup_failures: failures, automatic_refunds: refunds.length,
      settlement_checked: rec.settlement_checked,
    };

    const financeBody = [
      `Fee reconciliation for ${yesterday}.`,
      '',
      `Payments: ${rec.totals.payment_count} (${money(rec.totals.payments_paisa)}). Refunds: ${money(-rec.totals.refunds_paisa)}.`,
      `Mismatches found for this date: ${rec.mismatches.length}. Open exceptions (all dates): ${open.length}.`,
      rec.settlement_checked ? '' : 'Provider settlement file: not imported, so the settlement check was not run.',
      '',
      'Open exceptions:',
      ...exceptionLines(open),
      '',
      'Automatic credit refunds today (record the bank reference when the money is paid out):',
      ...(refunds.length ? refunds.map(r => `  - student #${r.student_id} ${r.name}: ${money(r.amount_paisa)} (${r.reason})`) : ['  (none)']),
    ].join('\n');
    const opsBody = [
      `Fee job summary for ${today} (reconciled ${yesterday}).`,
      `Payments matched: ${rec.mismatches.length === 0 ? 'all' : `${rec.totals.payment_count} recorded, ${rec.mismatches.length} mismatch(es)`}.`,
      `Total collected: ${money(rec.totals.payments_paisa)}. Mismatches: ${rec.mismatches.length}. Open exceptions: ${open.length}. Escalated: ${toEscalate.length}.`,
      `Provider lookup failures on ${yesterday}: ${failures}.`,
      `Automatic credit refunds: ${refunds.length}.`,
    ].join('\n');

    const results = {
      finance: await dispatch(today, 'finance', 'FEES_FINANCE_EMAILS', `NITEX fees: reconciliation for ${yesterday} (${open.length} open)`, financeBody),
      ops: await dispatch(today, 'ops', 'FEES_OPS_EMAILS', `NITEX fees: daily summary ${today}`, opsBody),
    };
    if (toEscalate.length) {
      const body = [
        `${toEscalate.length} reconciliation exception(s) need the Head of Finance: over ${money(escalationThreshold())}, or open for more than 48 hours.`,
        '',
        ...exceptionLines(toEscalate),
      ].join('\n');
      results.head_of_finance = await dispatch(today, 'head_of_finance', 'FEES_HEAD_FINANCE_EMAILS', `ESCALATION: NITEX fee exceptions (${toEscalate.length})`, body);
      for (const e of toEscalate) markEscalated.run(e.id);
    }
    summary.dispatch = results;

    db.prepare('UPDATE fee_job_runs SET summary = ? WHERE job = ? AND run_date = ?').run(JSON.stringify(summary), JOB, today);
    logAudit(null, { module: 'fees', action: 'daily_job_run', description: `Daily fee job for ${today}`,
      actorOverride: { name: 'Daily fee job', role: 'system' }, newValue: { open_exceptions: open.length, escalated: toEscalate.length } });
    return { ran: true, run_date: today, summary };
  } catch (err) {
    // Release the claim so the job can retry, unless emails have already gone out (then a retry would send them twice).
    if (!dispatching) db.prepare('DELETE FROM fee_job_runs WHERE job = ? AND run_date = ?').run(JOB, today);
    throw err;
  }
}

/** Tests only: how many dispatch rows exist for a date. */
export function dispatchRows(runDate) {
  return db.prepare('SELECT audience, recipient, status, error FROM fee_dispatches WHERE run_date = ? ORDER BY id').all(runDate);
}

