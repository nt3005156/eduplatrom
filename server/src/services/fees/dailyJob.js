// Daily fee job. Runs once per school date, between 00:00 and 02:00 Asia/Kathmandu.
//
// What one run does:
//   1. Reconciles yesterday's payments (and every completed Khalti attempt) against the ledger.
//   2. Stores each mismatch as an exception. An exception stays open until someone resolves it.
//   3. Applies the automatic credit refunds (closed account, or credit unused for 90 days).
//   4. Escalates by tier (amounts in NPR):
//        below NPR 10,000          low: no escalation (front desk and finance operations handle it)
//        NPR 10,000 to 50,000      medium: Finance Supervisor / Manager
//        above NPR 50,000          high: Head of Finance
//      An exception open for more than 48 hours goes to the Head of Finance, whatever its amount.
//      Overpayments are escalated by the same tiers. They are not stored as exceptions, so they are escalated on the day they occur.
//   5. Sends reports. Finance gets the full itemized list, Ops gets a summary, and escalations go to the right level.
//      Every send is recorded with its real outcome: sent, simulated, held (no provider or no recipients), or failed.
//
// Recipients come from env (comma-separated emails):
//   FEES_FINANCE_EMAILS, FEES_OPS_EMAILS, FEES_SUPERVISOR_EMAILS, FEES_HEAD_FINANCE_EMAILS
// Tiers: FEES_TIER_SUPERVISOR_PAISA (default 1,000,000 = NPR 10,000) and FEES_TIER_HEAD_PAISA (default 5,000,000 = NPR 50,000).
// FEES_DAILY_JOB=off disables the schedule. A manual run is still possible through the API.
import db from '../../db/index.js';
import { logAudit } from '../../utils/audit.js';
import { reconcile, todayNepal, autoRefundCredits } from './ledger.js';
import { escalationTiers, tierFor, formatNPR } from './money.js';
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

const LEVEL_LABEL = {
  supervisor: 'Finance Supervisor / Manager',
  head_of_finance: 'Head of Finance',
};
const RANK = level => (level === 'head_of_finance' ? 2 : level === 'supervisor' ? 1 : 0);

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
  escalated_at = NULL, escalation_level = NULL, resolved_by = NULL, resolved_at = NULL, resolution_note = NULL WHERE id = ?`);

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

/**
 * The level an open exception should be at today, or null. Levels only go up, so an exception that already went to
 * the supervisor goes to the Head of Finance later, when it is 48 hours old.
 */
export function targetLevelFor(ex, today, tiers = escalationTiers()) {
  if (ex.first_seen_date <= shiftDate(today, -2)) return 'head_of_finance';
  const tier = tierFor(ex.amount_paisa, tiers);
  if (tier === 'head_of_finance') return 'head_of_finance';
  if (tier === 'supervisor') return 'supervisor';
  return null;
}

function exceptionsToEscalate(today, tiers) {
  return openExceptions()
    .map(ex => ({ ex, target: targetLevelFor(ex, today, tiers) }))
    .filter(({ ex, target }) => target && RANK(target) > RANK(ex.escalation_level));
}

const markEscalated = db.prepare("UPDATE reconciliation_exceptions SET escalated_at = datetime('now'), escalation_level = ? WHERE id = ?");

/** Overpayments (credit created by an excess payment) on one school date. */
export function overpaymentsOn(day) {
  return db.prepare(`SELECT c.id, c.student_id, c.amount_paisa, u.name AS student_name, i.invoice_no
    FROM credit_ledger c JOIN users u ON u.id = c.student_id LEFT JOIN invoices i ON i.id = c.invoice_id
    WHERE c.kind = 'credit' AND c.reason = 'Overpayment' AND date(c.created_at, '+5 hours', '+45 minutes') = ?
    ORDER BY c.id`).all(day);
}

function lookupFailuresOn(day) {
  return db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE module = 'fees' AND action = 'lookup_unavailable'
    AND date(created_at, '+5 hours', '+45 minutes') = ?`).get(day).n;
}

function exceptionLines(list) {
  if (list.length === 0) return ['  (none open)'];
  return list.map(e => `  - #${e.id} ${e.type} | ${e.amount_paisa != null ? formatNPR(e.amount_paisa) : 'no amount'} | first seen ${e.first_seen_date}${e.escalation_level ? ` | escalated to ${LEVEL_LABEL[e.escalation_level]}` : ''}`);
}

function overpaymentLines(list) {
  if (list.length === 0) return ['  (none)'];
  return list.map(o => `  - ${o.student_name} (student #${o.student_id}) on ${o.invoice_no ?? 'an invoice'}: ${formatNPR(o.amount_paisa)}`);
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
    const tiers = escalationTiers();
    const yesterday = shiftDate(today, -1);
    const rec = reconcile({ from: yesterday, to: yesterday });
    recordExceptions(rec.mismatches, today);
    const refunds = autoRefundCredits(now);
    const open = openExceptions();
    const dueEx = exceptionsToEscalate(today, tiers);
    const overpayments = overpaymentsOn(yesterday).map(o => ({ ...o, tier: tierFor(o.amount_paisa, tiers) }));
    const failures = lookupFailuresOn(yesterday);

    // Who gets each escalation. Exceptions and overpayments are grouped by the level they now belong to.
    const level = { supervisor: [], head_of_finance: [] };
    const overpaymentLevel = { supervisor: [], head_of_finance: [] };
    for (const { ex, target } of dueEx) level[target].push(ex);
    for (const o of overpayments) if (o.tier !== 'low') overpaymentLevel[o.tier].push(o);

    dispatching = true;
    const summary = {
      run_date: today, reconciled_date: yesterday,
      tiers_paisa: tiers,
      payments: rec.totals.payment_count, payments_paisa: rec.totals.payments_paisa, refunds_paisa: rec.totals.refunds_paisa,
      mismatches_found: rec.mismatches.length, open_exceptions: open.length,
      escalated_supervisor: level.supervisor.length, escalated_head_of_finance: level.head_of_finance.length,
      overpayments: overpayments.length, overpayments_escalated: overpaymentLevel.supervisor.length + overpaymentLevel.head_of_finance.length,
      provider_lookup_failures: failures, automatic_refunds: refunds.length,
      settlement_checked: rec.settlement_checked,
    };

    const financeBody = [
      `Fee reconciliation for ${yesterday}. All amounts are in NPR.`,
      '',
      `Payments: ${rec.totals.payment_count} (${formatNPR(rec.totals.payments_paisa)}). Refunds: ${formatNPR(-rec.totals.refunds_paisa)}.`,
      `Mismatches found for this date: ${rec.mismatches.length}. Open exceptions (all dates): ${open.length}.`,
      rec.settlement_checked ? '' : 'Provider settlement file: not imported, so the settlement check was not run.',
      '',
      'Open exceptions:',
      ...exceptionLines(open),
      '',
      `Overpayments on ${yesterday} (credited to the student account):`,
      ...overpaymentLines(overpayments),
      '',
      'Automatic credit refunds today (record the bank reference when the money is paid out):',
      ...(refunds.length ? refunds.map(r => `  - student #${r.student_id} ${r.name}: ${formatNPR(r.amount_paisa)} (${r.reason})`) : ['  (none)']),
    ].join('\n');
    const opsBody = [
      `Fee job summary for ${today} (reconciled ${yesterday}).`,
      `Payments matched: ${rec.mismatches.length === 0 ? 'all' : `${rec.totals.payment_count} recorded, ${rec.mismatches.length} mismatch(es)`}.`,
      `Total collected: ${formatNPR(rec.totals.payments_paisa)}. Mismatches: ${rec.mismatches.length}. Open exceptions: ${open.length}.`,
      `Escalated today: ${level.supervisor.length} to the Finance Supervisor, ${level.head_of_finance.length} to the Head of Finance.`,
      `Provider lookup failures on ${yesterday}: ${failures}.`,
      `Automatic credit refunds: ${refunds.length}.`,
    ].join('\n');

    const results = {
      finance: await dispatch(today, 'finance', 'FEES_FINANCE_EMAILS', `NITEX fees: reconciliation for ${yesterday} (${open.length} open)`, financeBody),
      ops: await dispatch(today, 'ops', 'FEES_OPS_EMAILS', `NITEX fees: daily summary ${today}`, opsBody),
    };

    for (const lvl of ['supervisor', 'head_of_finance']) {
      const exList = level[lvl];
      const ovList = overpaymentLevel[lvl];
      if (exList.length === 0 && ovList.length === 0) continue;
      const count = exList.length + ovList.length;
      const audience = lvl;
      const env = lvl === 'supervisor' ? 'FEES_SUPERVISOR_EMAILS' : 'FEES_HEAD_FINANCE_EMAILS';
      const reason = lvl === 'supervisor'
        ? `between ${formatNPR(tiers.supervisor)} and ${formatNPR(tiers.head)}`
        : `above ${formatNPR(tiers.head)}, or open for more than 48 hours`;
      const body = [
        `${count} item(s) need the ${LEVEL_LABEL[lvl]}: ${reason}. All amounts are in NPR.`,
        '',
        'Reconciliation exceptions:',
        ...(exList.length ? exceptionLines(exList) : ['  (none)']),
        '',
        'Overpayments:',
        ...(ovList.length ? overpaymentLines(ovList) : ['  (none)']),
      ].join('\n');
      results[audience] = await dispatch(today, audience, env, `ESCALATION (${LEVEL_LABEL[lvl]}): NITEX fees, ${count} item(s)`, body);
      for (const e of exList) markEscalated.run(lvl, e.id);
    }
    summary.dispatch = results;

    db.prepare('UPDATE fee_job_runs SET summary = ? WHERE job = ? AND run_date = ?').run(JSON.stringify(summary), JOB, today);
    logAudit(null, { module: 'fees', action: 'daily_job_run', description: `Daily fee job for ${today}`,
      actorOverride: { name: 'Daily fee job', role: 'system' }, newValue: { open_exceptions: open.length, escalated_supervisor: level.supervisor.length, escalated_head_of_finance: level.head_of_finance.length } });
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
