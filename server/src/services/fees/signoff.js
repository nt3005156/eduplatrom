// Finance Manager's daily fee audit sign-off. The daily job creates one row per reconciled school date with the figures.
// A person with fees.signoff_daily (the Finance Manager, and the system admin) signs it off or returns it.
import db from '../../db/index.js';
import { logAudit } from '../../utils/audit.js';
import { FeeError } from './ledger.js';

const actorId = req => req?.user?.id ?? null;

export function pendingVerificationCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM payment_verifications WHERE status = 'pending'").get().n;
}

/** Creates the sign-off for one reconciled date. Repeats are ignored (one row per date). */
export function createDailySignoff(row) {
  db.prepare(`INSERT OR IGNORE INTO fee_daily_signoffs
    (reconciled_date, run_date, payments_count, payments_paisa, refunds_paisa, mismatches, open_exceptions,
     pending_verifications, overpayments, automatic_refunds, summary)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.reconciled_date, row.run_date, row.payments_count, row.payments_paisa, row.refunds_paisa, row.mismatches,
    row.open_exceptions, row.pending_verifications, row.overpayments, row.automatic_refunds, JSON.stringify(row.summary || {}));
}

/**
 * Link to the sign-off screen for one reconciled date, for the digest email. Null when PUBLIC_BASE_URL is not a
 * public https address (or localhost), so the email never carries a broken or insecure link.
 */
export function signoffLink(day) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base.startsWith('https://') && !base.startsWith('http://localhost') && !base.startsWith('http://127.0.0.1')) return null;
  return `${base}/admin/fee-signoff?date=${encodeURIComponent(day)}`;
}

export function listSignoffs({ status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM fee_daily_signoffs WHERE status = ? ORDER BY reconciled_date DESC').all(status)
    : db.prepare('SELECT * FROM fee_daily_signoffs ORDER BY reconciled_date DESC LIMIT 200').all();
  return rows.map(r => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null,
    needs_note: r.open_exceptions > 0 || r.pending_verifications > 0 }));
}

/**
 * sign_off or return. A signed-off day cannot change. A returned day can be signed off later.
 * A day with open exceptions or unverified payments needs a note to be signed off, and returning always needs one.
 */
export function decideSignoff(id, { decision, note } = {}, req) {
  if (!['sign_off', 'return'].includes(decision)) throw new FeeError(400, 'decision must be sign_off or return');
  const row = db.prepare('SELECT * FROM fee_daily_signoffs WHERE id = ?').get(Number(id));
  if (!row) throw new FeeError(404, 'Sign-off not found');
  if (row.status === 'signed_off') throw new FeeError(409, `The day ${row.reconciled_date} is already signed off`);
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (cleanNote.length > 500) throw new FeeError(400, 'note must be 500 characters or fewer');
  const outstanding = row.open_exceptions > 0 || row.pending_verifications > 0;
  if (decision === 'return' && cleanNote.length < 3) throw new FeeError(400, 'Write a note of at least 3 characters to return a day');
  if (decision === 'sign_off' && outstanding && cleanNote.length < 3) {
    throw new FeeError(400, `${row.open_exceptions} open exception(s) and ${row.pending_verifications} unverified payment(s) on this day. Write a note of at least 3 characters to sign off anyway.`);
  }
  const status = decision === 'sign_off' ? 'signed_off' : 'returned';
  db.prepare(`UPDATE fee_daily_signoffs SET status = ?, decided_by = ?,
      decided_by_emp_no = (SELECT employee_no FROM users WHERE id = ?), decided_at = datetime('now'), decision_note = ?
    WHERE id = ?`).run(status, actorId(req), actorId(req), cleanNote || null, row.id);
  logAudit(req, { module: 'fees', action: status === 'signed_off' ? 'daily_signed_off' : 'daily_returned',
    description: `Daily fee audit for ${row.reconciled_date}`,
    previousValue: { status: row.status }, newValue: { status, open_exceptions: row.open_exceptions,
      pending_verifications: row.pending_verifications, note: cleanNote || null } });
  return { id: row.id, reconciled_date: row.reconciled_date, status, outstanding };
}
