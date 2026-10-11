// Fee ledger: fee structures, invoices, concessions, payments, receipts, refunds, and reports.
//
// Rules this file enforces (each one has a test in test/fees.test.js):
//   - Money is integer paisa. Anything that is not a positive safe integer is refused.
//   - Payments are append-only (triggers in schema.sql). A refund is a negative row linked to the payment.
//   - A receipt number is taken inside the same transaction as its payment, so numbers have no gaps.
//   - A concession needs a second person to approve it, and it cannot push an invoice below what was paid.
//   - Every money action writes an audit row.
//   - "Today" and aging use the school's date (Asia/Kathmandu), not the server's UTC date.
import db from '../../db/index.js';
import { logAudit } from '../../utils/audit.js';
import { isIsoDate } from '../../utils/validate.js';

export class FeeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const FEE_CATEGORIES = ['tuition', 'exam', 'transport', 'hostel', 'library', 'admission', 'uniform', 'other'];
export const OFFLINE_METHODS = ['cash', 'bank'];
export const BUCKETS = ['not_due', '0-30', '31-60', '61-90', '90+'];

// SQL expression: the school's calendar date for a UTC timestamp column.
const NP_DATE = col => `date(${col}, '+5 hours', '+45 minutes')`;

/**
 * Runs fn in a transaction that takes the write lock at the start (BEGIN IMMEDIATE).
 * Money and receipt numbering need this: a deferred transaction could let two writers
 * read the same MAX(receipt_no) if the database were ever shared by more than one process.
 */
export function writeTx(fn) {
  const tx = db.transaction(fn);
  return () => tx.immediate();
}

export function assertPaisa(value, field = 'amount_paisa') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FeeError(400, `${field} must be a positive whole number of paisa (1 NPR = 100 paisa)`);
  }
}

export function todayNepal(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Positive when `to` is later. */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function bucketFor(daysPastDue) {
  if (daysPastDue < 0) return 'not_due';
  if (daysPastDue <= 30) return '0-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

function cleanText(value, { field, min = 1, max = 200, required = true } = {}) {
  const s = String(value ?? '').trim();
  if (!s) {
    if (required) throw new FeeError(400, `${field} is required`);
    return null;
  }
  if (s.length < min || s.length > max) throw new FeeError(400, `${field} must be ${min} to ${max} characters`);
  return s;
}

function parseClassLevel(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 12) throw new FeeError(400, 'class_level must be a whole number from 0 to 12');
  return n;
}

function requireSession(sessionId) {
  const row = db.prepare('SELECT id, name FROM academic_sessions WHERE id = ?').get(Number(sessionId));
  if (!row) throw new FeeError(404, 'Academic session not found');
  return row;
}

function requireStudent(studentId) {
  const row = db.prepare("SELECT id, name, class_level, section FROM users WHERE id = ? AND role = 'student'").get(Number(studentId));
  if (!row) throw new FeeError(404, 'Student not found');
  return row;
}

function actorId(req) {
  return req?.user?.id ?? null;
}

// ---------- fee heads and structures ----------

export function createFeeHead(input, req) {
  const code = cleanText(input.code, { field: 'code', min: 2, max: 20 }).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new FeeError(400, 'code may contain only letters, digits, - and _');
  const name = cleanText(input.name, { field: 'name', max: 100 });
  const category = input.category || 'tuition';
  if (!FEE_CATEGORIES.includes(category)) throw new FeeError(400, `category must be one of: ${FEE_CATEGORIES.join(', ')}`);
  try {
    const r = db.prepare('INSERT INTO fee_heads (code, name, category) VALUES (?,?,?)').run(code, name, category);
    logAudit(req, { module: 'fees', action: 'fee_head_created', description: `Fee head ${code}`, newValue: { code, name, category } });
    return { id: Number(r.lastInsertRowid), code, name, category, active: 1 };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new FeeError(409, 'A fee head with this code already exists');
    throw err;
  }
}

export function listFeeHeads() {
  return db.prepare('SELECT * FROM fee_heads ORDER BY code').all();
}

export function listStructures({ session_id, class_level }) {
  return db.prepare(`
    SELECT fs.id, fs.session_id, fs.class_level, fs.period, fs.fee_head_id, fh.code AS fee_head_code, fh.name AS fee_head_name,
           fs.amount_paisa, fs.due_date
    FROM fee_structures fs JOIN fee_heads fh ON fh.id = fs.fee_head_id
    WHERE fs.session_id = ? AND fs.class_level = ?
    ORDER BY fs.period, fh.code`).all(Number(session_id), parseClassLevel(class_level));
}

/** Replaces the amount and due date for each listed head. Heads not in the list are left as they are. */
export function saveFeeStructure(input, req) {
  requireSession(input.session_id);
  const class_level = parseClassLevel(input.class_level);
  const period = cleanText(input.period, { field: 'period', max: 40 });
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 30) {
    throw new FeeError(400, 'items must be a list of 1 to 30 fee lines');
  }
  const seen = new Set();
  const lines = input.items.map(it => {
    const fee_head_id = Number(it.fee_head_id);
    if (seen.has(fee_head_id)) throw new FeeError(400, 'Each fee head may appear only once per period');
    seen.add(fee_head_id);
    const head = db.prepare('SELECT id, active FROM fee_heads WHERE id = ?').get(fee_head_id);
    if (!head || !head.active) throw new FeeError(400, `Fee head ${it.fee_head_id} does not exist or is inactive`);
    assertPaisa(it.amount_paisa);
    if (!isIsoDate(it.due_date)) throw new FeeError(400, 'due_date must be YYYY-MM-DD');
    return { fee_head_id, amount_paisa: it.amount_paisa, due_date: it.due_date };
  });
  const upsert = db.prepare(`
    INSERT INTO fee_structures (session_id, class_level, period, fee_head_id, amount_paisa, due_date) VALUES (?,?,?,?,?,?)
    ON CONFLICT(session_id, class_level, period, fee_head_id) DO UPDATE SET amount_paisa = excluded.amount_paisa, due_date = excluded.due_date`);
  writeTx(() => {
    for (const l of lines) upsert.run(Number(input.session_id), class_level, period, l.fee_head_id, l.amount_paisa, l.due_date);
  })();
  logAudit(req, { module: 'fees', action: 'structure_saved', description: `Class ${class_level}, ${period}`, newValue: { session_id: Number(input.session_id), class_level, period, lines: lines.length } });
  return listStructures({ session_id: input.session_id, class_level });
}

// ---------- invoices ----------

const selInvoiceByStudent = db.prepare('SELECT id FROM invoices WHERE student_id = ? AND session_id = ? AND period = ?');
const insInvoice = db.prepare(`INSERT INTO invoices (invoice_no, student_id, session_id, period, class_level, section, due_date, created_by)
  VALUES (?,?,?,?,?,?,?,?)`);
const setInvoiceNo = db.prepare('UPDATE invoices SET invoice_no = ? WHERE id = ?');
const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, fee_head_id, description, gross_paisa, net_paisa) VALUES (?,?,?,?,?)');
const selItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id');
const approvedFor = db.prepare(`SELECT COALESCE(SUM(amount_paisa), 0) AS s FROM concessions
  WHERE student_id = ? AND session_id = ? AND period = ? AND fee_head_id = ? AND status = 'approved'`);
const updItem = db.prepare('UPDATE invoice_items SET concession_paisa = ?, net_paisa = ? WHERE id = ?');
const updInvTotals = db.prepare('UPDATE invoices SET gross_paisa = ?, concession_paisa = ?, net_paisa = ? WHERE id = ?');
// Settled amount on an invoice = payments received, minus the part that became credit (an overpayment),
// minus credit applied to the invoice. Both kinds of credit row are stored with a negative sign, so they are
// subtracted together: 'credit' rows are positive (excess) and 'apply' rows are negative (applied).
const paidFor = db.prepare(`SELECT (SELECT COALESCE(SUM(amount_paisa), 0) FROM payments WHERE invoice_id = ?)
  - (SELECT COALESCE(SUM(amount_paisa), 0) FROM credit_ledger WHERE invoice_id = ? AND kind IN ('credit', 'apply')) AS s`);

export function paidTotal(invoiceId) {
  return paidFor.get(invoiceId, invoiceId).s;
}

/**
 * Recomputes concessions and totals for one invoice from the approved concessions.
 * Throws 409 if the result would be less than what has already been paid. The caller's transaction rolls back.
 */
export function recomputeInvoice(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  let gross = 0, conc = 0, net = 0;
  for (const item of selItems.all(invoiceId)) {
    const approved = approvedFor.get(inv.student_id, inv.session_id, inv.period, item.fee_head_id).s;
    const c = Math.min(item.gross_paisa, approved);
    updItem.run(c, item.gross_paisa - c, item.id);
    gross += item.gross_paisa;
    conc += c;
    net += item.gross_paisa - c;
  }
  const paid = paidTotal(invoiceId);
  if (net < paid) {
    throw new FeeError(409, `This change would reduce invoice ${inv.invoice_no} below the ${paid} paisa already paid`);
  }
  updInvTotals.run(gross, conc, net, invoiceId);
  return { gross, concession: conc, net, paid };
}

/**
 * Creates one invoice per active student in the class (and section, if given) for the session and period.
 * Existing invoices are left alone, so running it again is safe.
 */
export function generateInvoices(input, req) {
  requireSession(input.session_id);
  const class_level = parseClassLevel(input.class_level);
  const period = cleanText(input.period, { field: 'period', max: 40 });
  const section = input.section ? cleanText(input.section, { field: 'section', max: 10 }) : null;
  const lines = db.prepare(`
    SELECT fs.fee_head_id, fs.amount_paisa, fs.due_date, fh.code, fh.name
    FROM fee_structures fs JOIN fee_heads fh ON fh.id = fs.fee_head_id
    WHERE fs.session_id = ? AND fs.class_level = ? AND fs.period = ? AND fh.active = 1 ORDER BY fh.code`)
    .all(Number(input.session_id), class_level, period);
  if (lines.length === 0) throw new FeeError(409, 'No fee structure exists for this class and period');
  const dueDate = lines.map(l => l.due_date).sort()[0];
  const students = db.prepare(`
    SELECT id, name, class_level, section FROM users
    WHERE role = 'student' AND class_level = ? AND (? IS NULL OR section = ?) AND account_status NOT IN ('archived', 'disabled')
    ORDER BY name, id`).all(class_level, section, section);

  const result = { created: [], existing: [] };
  let creditApplied = 0;
  writeTx(() => {
    for (const s of students) {
      const existing = selInvoiceByStudent.get(s.id, Number(input.session_id), period);
      if (existing) {
        result.existing.push(existing.id);
        continue;
      }
      const placeholder = `TMP-${s.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const r = insInvoice.run(placeholder, s.id, Number(input.session_id), period, s.class_level, s.section, dueDate, actorId(req));
      const invoiceId = Number(r.lastInsertRowid);
      setInvoiceNo.run(`INV-${String(invoiceId).padStart(6, '0')}`, invoiceId);
      for (const l of lines) insItem.run(invoiceId, l.fee_head_id, `${l.name} (${period})`, l.amount_paisa, l.amount_paisa);
      recomputeInvoice(invoiceId);
      // Credit on the account is applied to new invoices automatically.
      creditApplied += applyCreditTo(db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId), actorId(req));
      result.created.push(invoiceId);
    }
  })();
  logAudit(req, {
    module: 'fees', action: 'invoices_generated', description: `Class ${class_level}${section ? ' ' + section : ''}, ${period}`,
    newValue: { created: result.created.length, existing: result.existing.length, session_id: Number(input.session_id) },
  });
  return { ...result, skipped_existing: result.existing.length, fee_lines: lines.length, students: students.length, credit_applied_paisa: creditApplied };
}

export function invoiceStatus({ net, paid, due_date }, today) {
  if (net === 0) return 'waived';
  if (paid >= net) return 'paid';
  if (paid > 0) return 'part_paid';
  return daysBetween(due_date, today) > 0 ? 'overdue' : 'unpaid';
}

function withTotals(row, today) {
  const balance = row.net_paisa - row.paid_paisa;
  return {
    ...row,
    balance_paisa: balance,
    status: invoiceStatus({ net: row.net_paisa, paid: row.paid_paisa, due_date: row.due_date }, today),
    days_past_due: Math.max(0, daysBetween(row.due_date, today)),
  };
}

const INVOICE_SELECT = `
  SELECT i.*, u.name AS student_name, u.roll_no,
    ((SELECT COALESCE(SUM(p.amount_paisa), 0) FROM payments p WHERE p.invoice_id = i.id)
      - (SELECT COALESCE(SUM(c.amount_paisa), 0) FROM credit_ledger c WHERE c.invoice_id = i.id AND c.kind IN ('credit', 'apply'))) AS paid_paisa
  FROM invoices i JOIN users u ON u.id = i.student_id`;

export function listInvoices({ session_id, class_level, section, student_id, status } = {}, today = todayNepal()) {
  const where = [];
  const params = [];
  if (session_id) { where.push('i.session_id = ?'); params.push(Number(session_id)); }
  if (class_level !== undefined && class_level !== '') { where.push('i.class_level = ?'); params.push(parseClassLevel(class_level)); }
  if (section) { where.push('i.section = ?'); params.push(String(section)); }
  if (student_id) { where.push('i.student_id = ?'); params.push(Number(student_id)); }
  const sql = INVOICE_SELECT + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY i.class_level, i.section, u.name, i.id';
  let rows = db.prepare(sql).all(...params).map(r => withTotals(r, today));
  if (status) rows = rows.filter(r => r.status === status);
  return rows;
}

export function invoiceDetail(invoiceId, today = todayNepal()) {
  const row = db.prepare(INVOICE_SELECT + ' WHERE i.id = ?').get(Number(invoiceId));
  if (!row) return null;
  const inv = withTotals(row, today);
  inv.items = selItems.all(inv.id);
  inv.credit_applied_paisa = -db.prepare("SELECT COALESCE(SUM(amount_paisa), 0) AS s FROM credit_ledger WHERE invoice_id = ? AND kind = 'apply'").get(inv.id).s;
  inv.payments = db.prepare(`
    SELECT p.id, p.kind, p.amount_paisa, p.method, p.reference, p.refund_of_id, p.created_at, r.receipt_no
    FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id WHERE p.invoice_id = ? ORDER BY p.id`).all(inv.id);
  inv.online_attempts = db.prepare(`
    SELECT id, amount_paisa, status, provider_status, created_at, updated_at FROM gateway_transactions
    WHERE invoice_id = ? ORDER BY id`).all(inv.id);
  return inv;
}

// ---------- concessions ----------

export function requestConcession(input, req) {
  const student = requireStudent(input.student_id);
  const session = requireSession(input.session_id);
  const period = cleanText(input.period, { field: 'period', max: 40 });
  const fee_head_id = Number(input.fee_head_id);
  const onStructure = db.prepare(`
    SELECT 1 FROM fee_structures WHERE session_id = ? AND class_level = ? AND period = ? AND fee_head_id = ?`)
    .get(session.id, student.class_level, period, fee_head_id);
  if (!onStructure) throw new FeeError(400, "That fee head is not charged to this student's class for this period");
  assertPaisa(input.amount_paisa);
  const reason = cleanText(input.reason, { field: 'reason', min: 3, max: 500 });
  const r = db.prepare(`INSERT INTO concessions (student_id, session_id, period, fee_head_id, amount_paisa, reason, status, requested_by)
    VALUES (?,?,?,?,?,?, 'requested', ?)`).run(student.id, session.id, period, fee_head_id, input.amount_paisa, reason, actorId(req));
  logAudit(req, { module: 'fees', action: 'concession_requested', description: `Concession for student ${student.id}`, newValue: { id: Number(r.lastInsertRowid), amount_paisa: input.amount_paisa, period } });
  return Number(r.lastInsertRowid);
}

export function listConcessions({ status, student_id } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (student_id) { where.push('c.student_id = ?'); params.push(Number(student_id)); }
  return db.prepare(`
    SELECT c.*, u.name AS student_name, fh.code AS fee_head_code FROM concessions c
    JOIN users u ON u.id = c.student_id JOIN fee_heads fh ON fh.id = c.fee_head_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC`).all(...params);
}

/** Approve or reject. The requester cannot approve their own request. Approval updates open invoices for that period. */
export function decideConcession(id, decision, req) {
  if (!['approve', 'reject'].includes(decision)) throw new FeeError(400, 'decision must be approve or reject');
  const row = db.prepare('SELECT * FROM concessions WHERE id = ?').get(Number(id));
  if (!row) throw new FeeError(404, 'Concession not found');
  if (row.status !== 'requested') throw new FeeError(409, `Concession is already ${row.status}`);
  if (row.requested_by === actorId(req)) throw new FeeError(403, 'The person who requested a concession cannot approve it');
  const applied = [];
  writeTx(() => {
    const status = decision === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE concessions SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(status, actorId(req), row.id);
    if (status === 'approved') {
      const open = db.prepare(`SELECT id FROM invoices WHERE student_id = ? AND session_id = ? AND period = ?`)
        .all(row.student_id, row.session_id, row.period);
      for (const inv of open) {
        recomputeInvoice(inv.id);
        applied.push(inv.id);
      }
    }
  })();
  logAudit(req, { module: 'fees', action: decision === 'approve' ? 'concession_approved' : 'concession_rejected', description: `Concession ${row.id}`,
    previousValue: { status: row.status }, newValue: { status: decision === 'approve' ? 'approved' : 'rejected', invoices_updated: applied.length } });
  return { id: row.id, status: decision === 'approve' ? 'approved' : 'rejected', invoices_updated: applied };
}

// ---------- payments and receipts ----------

const insPayment = db.prepare(`INSERT INTO payments (invoice_id, student_id, kind, amount_paisa, method, reference, refund_of_id, recorded_by)
  VALUES (?,?,?,?,?,?,?,?)`);
const insReceipt = db.prepare('INSERT INTO receipts (receipt_no, payment_id) VALUES (?,?)');
const nextReceiptNo = db.prepare('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS n FROM receipts');

/** Writes a payment and its receipt. Must run inside a transaction. */
export function writePaymentWithReceipt(invoice, { amount, method, reference = null, recordedBy = null }) {
  const p = insPayment.run(invoice.id, invoice.student_id, 'payment', amount, method, reference, null, recordedBy);
  const receipt_no = nextReceiptNo.get().n;
  insReceipt.run(receipt_no, p.lastInsertRowid);
  return { payment_id: Number(p.lastInsertRowid), receipt_no };
}

export function balanceOf(invoiceId) {
  const inv = db.prepare('SELECT net_paisa FROM invoices WHERE id = ?').get(invoiceId);
  return inv ? inv.net_paisa - paidTotal(invoiceId) : null;
}

const insCredit = db.prepare(`INSERT INTO credit_ledger (student_id, kind, amount_paisa, invoice_id, source_payment_id, reference, reason, recorded_by)
  VALUES (?,?,?,?,?,?,?,?)`);
const insVerification = db.prepare('INSERT INTO payment_verifications (method, invoice_id, student_id, amount_paisa, reference, recorded_by) VALUES (?,?,?,?,?,?)');

export function creditBalance(studentId) {
  return db.prepare('SELECT COALESCE(SUM(amount_paisa), 0) AS s FROM credit_ledger WHERE student_id = ?').get(Number(studentId)).s;
}

/**
 * Writes a payment for an invoice. Any amount above the balance becomes credit on the student's account.
 * Must run inside writeTx.
 */
export function postPayment(inv, { amount, method, reference = null, recordedBy = null }) {
  const balanceBefore = Math.max(0, inv.net_paisa - paidTotal(inv.id));
  const written = writePaymentWithReceipt(inv, { amount, method, reference, recordedBy });
  const excess = amount - balanceBefore;
  if (excess > 0) insCredit.run(inv.student_id, 'credit', excess, inv.id, written.payment_id, reference, 'Overpayment', recordedBy);
  return { ...written, credit_added_paisa: Math.max(0, excess) };
}

/** Applies credit to one invoice, up to its balance. Must run inside writeTx. Returns paisa applied. */
function applyCreditTo(inv, recordedBy) {
  const balance = Math.max(0, inv.net_paisa - paidTotal(inv.id));
  const take = Math.min(balance, Math.max(0, creditBalance(inv.student_id)));
  if (take > 0) insCredit.run(inv.student_id, 'apply', -take, inv.id, null, null, 'Applied to invoice', recordedBy);
  return take;
}

export function applyCreditToInvoice(invoiceId, req) {
  return writeTx(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(invoiceId));
    if (!inv) throw new FeeError(404, 'Invoice not found');
    const applied = applyCreditTo(inv, actorId(req));
    if (applied === 0) throw new FeeError(409, 'There is no credit to apply, or the invoice has no balance');
    logAudit(req, { module: 'fees', action: 'credit_applied', description: `Credit applied to ${inv.invoice_no}`, newValue: { amount_paisa: applied } });
    return { applied_paisa: applied, balance_paisa: Math.max(0, inv.net_paisa - paidTotal(inv.id)), credit_left_paisa: creditBalance(inv.student_id) };
  })();
}

/**
 * Cash and bank money are both recorded first and posted only after a second person verifies them.
 * The counter staff member records it and gets a draft number (DRAFT-n). The second person counts the cash, or checks
 * the bank slip, and approves. Approval posts the payment and issues the gap-free receipt number.
 */
export function recordOfflinePayment(input, req) {
  if (!OFFLINE_METHODS.includes(input.method)) throw new FeeError(400, 'method must be cash or bank');
  assertPaisa(input.amount_paisa);
  const reference = input.method === 'bank'
    ? cleanText(input.reference, { field: 'reference (deposit slip or transaction number)', max: 100 })
    : (input.reference ? cleanText(input.reference, { field: 'reference', max: 100, required: false }) : null);
  return writeTx(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(input.invoice_id));
    if (!inv) throw new FeeError(404, 'Invoice not found');
    const balance = inv.net_paisa - paidTotal(inv.id);
    if (balance <= 0) throw new FeeError(409, 'Invoice has no balance to pay');
    if (input.amount_paisa > balance) throw new FeeError(409, `Amount is more than the balance of ${balance} paisa`);
    let r;
    try {
      r = insVerification.run(input.method, inv.id, inv.student_id, input.amount_paisa, reference, actorId(req));
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new FeeError(409, 'This deposit reference was already recorded');
      throw err;
    }
    const id = Number(r.lastInsertRowid);
    logAudit(req, { module: 'fees', action: 'payment_submitted', description: `${input.method} payment on ${inv.invoice_no} waiting for a second person`,
      newValue: { verification_id: id, method: input.method, amount_paisa: input.amount_paisa } });
    return { verification_id: id, status: 'pending_verification', method: input.method, draft_receipt: `DRAFT-${id}`, invoice_no: inv.invoice_no };
  })();
}

export function listVerifications({ status, method } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('d.status = ?'); args.push(status); }
  if (method) { where.push('d.method = ?'); args.push(method); }
  return db.prepare(`
    SELECT d.*, u.name AS student_name, i.invoice_no, rec.name AS recorded_by_name, dec.name AS decided_by_name
    FROM payment_verifications d
    JOIN users u ON u.id = d.student_id JOIN invoices i ON i.id = d.invoice_id
    LEFT JOIN users rec ON rec.id = d.recorded_by LEFT JOIN users dec ON dec.id = d.decided_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.id DESC`).all(...args);
}

/**
 * A second person finalizes a cash receipt or verifies a bank deposit. The person who recorded it cannot.
 * Approval posts the payment and issues the receipt number. Rejection posts nothing.
 * Both names are kept on the verification row (recorded_by and decided_by), which is the trail for the receipt.
 */
export function decideVerification(id, input, req) {
  if (!['approve', 'reject'].includes(input.decision)) throw new FeeError(400, 'decision must be approve or reject');
  const note = input.note ? cleanText(input.note, { field: 'note', max: 300, required: false }) : null;
  return writeTx(() => {
    const d = db.prepare('SELECT * FROM payment_verifications WHERE id = ?').get(Number(id));
    if (!d) throw new FeeError(404, 'Payment not found in the verification queue');
    if (d.status !== 'pending') throw new FeeError(409, `Payment is already ${d.status}`);
    if (d.recorded_by === actorId(req)) throw new FeeError(403, 'The person who recorded a payment cannot verify it');
    if (input.decision === 'reject') {
      db.prepare("UPDATE payment_verifications SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?")
        .run(actorId(req), note, d.id);
      logAudit(req, { module: 'fees', action: 'payment_rejected', description: `${d.method} payment ${d.id} rejected`, newValue: { verification_id: d.id, note } });
      return { id: d.id, status: 'rejected' };
    }
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(d.invoice_id);
    const written = postPayment(inv, { amount: d.amount_paisa, method: d.method, reference: d.reference, recordedBy: d.recorded_by });
    db.prepare(`UPDATE payment_verifications SET status = 'posted', decided_by = ?, decided_at = datetime('now'), decision_note = ?, payment_id = ? WHERE id = ?`)
      .run(actorId(req), note, written.payment_id, d.id);
    logAudit(req, { module: 'fees', action: 'payment_verified', description: `${d.method} payment ${d.id} verified and posted on ${inv.invoice_no}`,
      newValue: { verification_id: d.id, payment_id: written.payment_id, receipt_no: written.receipt_no, amount_paisa: d.amount_paisa,
        recorded_by: d.recorded_by, verified_by: actorId(req), credit_added_paisa: written.credit_added_paisa } });
    return { id: d.id, status: 'posted', payment_id: written.payment_id, receipt_no: written.receipt_no, credit_added_paisa: written.credit_added_paisa,
      recorded_by: d.recorded_by, verified_by: actorId(req) };
  })();
}

export function creditStatement(studentId) {
  requireStudent(studentId);
  const entries = db.prepare('SELECT id, kind, amount_paisa, invoice_id, source_payment_id, reference, reason, created_at FROM credit_ledger WHERE student_id = ? ORDER BY id').all(Number(studentId));
  return { student_id: Number(studentId), balance_paisa: entries.reduce((s, e) => s + e.amount_paisa, 0), entries };
}

/** Explicit refund of credit to the family, on request. Admin only (fees.refund). The bank reference is required. */
export function refundCredit(studentId, input, req) {
  const reason = cleanText(input.reason, { field: 'reason', min: 3, max: 300 });
  const reference = cleanText(input.reference, { field: 'reference (bank transfer or cheque)', max: 100 });
  return writeTx(() => {
    requireStudent(studentId);
    const available = creditBalance(studentId);
    if (available <= 0) throw new FeeError(409, 'There is no credit to refund');
    const amount = input.amount_paisa === undefined ? available : input.amount_paisa;
    assertPaisa(amount);
    if (amount > available) throw new FeeError(409, `Only ${available} paisa of credit is available`);
    insCredit.run(Number(studentId), 'refund', -amount, null, null, reference, reason, actorId(req));
    logAudit(req, { module: 'fees', action: 'credit_refunded', description: `Credit refund for student ${studentId}`,
      newValue: { amount_paisa: amount, reference } });
    return { amount_paisa: amount, balance_after_paisa: available - amount };
  })();
}

export const CREDIT_AUTO_REFUND_DAYS = Math.max(1, Number(process.env.FEES_CREDIT_AUTO_REFUND_DAYS) || 90);

/**
 * Automatic refunds, run by the daily job. Two rules:
 *   - the student's account is archived or disabled: refund the whole credit balance;
 *   - the credit has not moved (no credit or application) for CREDIT_AUTO_REFUND_DAYS: refund the balance.
 * The refund is recorded with no bank reference. Finance must record the payout reference before the money leaves.
 */
export function autoRefundCredits(now = new Date()) {
  const cutoff = new Date(now.getTime() - CREDIT_AUTO_REFUND_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const candidates = db.prepare(`
    SELECT u.id, u.name, u.account_status,
      (SELECT COALESCE(SUM(c.amount_paisa), 0) FROM credit_ledger c WHERE c.student_id = u.id) AS balance,
      (SELECT MAX(c.created_at) FROM credit_ledger c WHERE c.student_id = u.id) AS last_activity
    FROM users u WHERE u.role = 'student' AND u.id IN (SELECT student_id FROM credit_ledger)`).all();
  const refunded = [];
  writeTx(() => {
    for (const c of candidates) {
      if (c.balance <= 0) continue;
      let reason = null;
      if (c.account_status !== 'active') reason = 'account closed';
      else if (c.last_activity && c.last_activity <= cutoff) reason = `credit unused for ${CREDIT_AUTO_REFUND_DAYS} days`;
      if (!reason) continue;
      insCredit.run(c.id, 'refund', -c.balance, null, null, null, `Automatic: ${reason}`, null);
      logAudit(null, { module: 'fees', action: 'credit_auto_refunded', description: `Automatic refund for student ${c.id}: ${reason}`,
        actorOverride: { name: 'Daily fee job', role: 'system' }, newValue: { amount_paisa: c.balance, reason } });
      refunded.push({ student_id: c.id, name: c.name, amount_paisa: c.balance, reason });
    }
  })();
  return refunded;
}

/**
 * Reverses all or part of a payment. Writes a negative row linked to the original payment.
 * The original payment and its receipt are kept. Refunds through Khalti must also be made in the Khalti dashboard.
 */
export function refundPayment(paymentId, input, req) {
  const reason = cleanText(input.reason, { field: 'reason', min: 3, max: 300 });
  return writeTx(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(paymentId));
    if (!p) throw new FeeError(404, 'Payment not found');
    if (p.kind !== 'payment') throw new FeeError(400, 'Only a payment can be refunded');
    const refunded = -db.prepare("SELECT COALESCE(SUM(amount_paisa), 0) AS s FROM payments WHERE refund_of_id = ?").get(p.id).s;
    const remaining = p.amount_paisa - refunded;
    if (remaining <= 0) throw new FeeError(409, 'This payment is already fully refunded');
    const amount = input.amount_paisa === undefined ? remaining : input.amount_paisa;
    assertPaisa(amount);
    if (amount > remaining) throw new FeeError(409, `Only ${remaining} paisa can still be refunded`);
    const r = insPayment.run(p.invoice_id, p.student_id, 'refund', -amount, p.method, reason, p.id, actorId(req));
    logAudit(req, { module: 'fees', action: 'payment_refunded', description: `Refund of payment ${p.id}`,
      previousValue: { payment_id: p.id, refundable_paisa: remaining },
      newValue: { refund_id: Number(r.lastInsertRowid), amount_paisa: amount, reason, method: p.method } });
    return {
      refund_id: Number(r.lastInsertRowid),
      amount_paisa: amount,
      refundable_left_paisa: remaining - amount,
      gateway_refund_required: p.method === 'khalti',
    };
  })();
}

// ---------- reports ----------

/** Outstanding balances with aging. Days past due = report date minus due date. Due dates later than the report date are "not_due". */
export function duesReport({ session_id, class_level, section } = {}, asOf = todayNepal()) {
  const rows = listInvoices({ session_id, class_level, section }, asOf)
    .filter(r => r.balance_paisa > 0 && r.status !== 'waived')
    .map(r => ({ ...r, days_past_due: daysBetween(r.due_date, asOf), bucket: bucketFor(daysBetween(r.due_date, asOf)) }))
    .sort((a, b) => b.days_past_due - a.days_past_due);
  const buckets = Object.fromEntries(BUCKETS.map(b => [b, { count: 0, amount_paisa: 0 }]));
  for (const r of rows) {
    buckets[r.bucket].count++;
    buckets[r.bucket].amount_paisa += r.balance_paisa;
  }
  const total = rows.reduce((s, r) => s + r.balance_paisa, 0);
  return { as_of: asOf, session_id: session_id ? Number(session_id) : null, total_outstanding_paisa: total, invoices: rows.length, buckets, rows };
}

/** Collection rate per class. Paid is capped at the net amount for each invoice. Overpayments are shown separately. */
export function collectionReport({ session_id } = {}, asOf = todayNepal()) {
  const invoices = listInvoices({ session_id }, asOf);
  const byClass = new Map();
  for (const inv of invoices) {
    if (!byClass.has(inv.class_level)) byClass.set(inv.class_level, { class_level: inv.class_level, invoices: 0, net_paisa: 0, collected_paisa: 0, overpaid_paisa: 0 });
    const c = byClass.get(inv.class_level);
    c.invoices++;
    c.net_paisa += inv.net_paisa;
    c.collected_paisa += Math.min(inv.paid_paisa, inv.net_paisa);
    c.overpaid_paisa += Math.max(0, inv.paid_paisa - inv.net_paisa);
  }
  const classes = [...byClass.values()]
    .sort((a, b) => a.class_level - b.class_level)
    .map(c => ({ ...c, collection_rate_pct: c.net_paisa > 0 ? Math.round((c.collected_paisa / c.net_paisa) * 1000) / 10 : null }));
  const net = classes.reduce((s, c) => s + c.net_paisa, 0);
  const collected = classes.reduce((s, c) => s + c.collected_paisa, 0);
  return {
    as_of: asOf, session_id: session_id ? Number(session_id) : null,
    total: { net_paisa: net, collected_paisa: collected, collection_rate_pct: net > 0 ? Math.round((collected / net) * 1000) / 10 : null },
    classes,
  };
}

/**
 * Reconciliation for a date range (school dates).
 * Checks our own records (gateway attempts, payments, receipts). If `settlements` is given, it also checks
 * the provider's settlement list: [{ provider_transaction_id, amount_paisa }].
 * Returns every mismatch. An empty list means the range reconciles.
 */
export function reconcile({ from, to, settlements } = {}) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new FeeError(400, 'from and to must be YYYY-MM-DD with from on or before to');
  const payments = db.prepare(`
    SELECT p.*, r.receipt_no FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
    WHERE ${NP_DATE('p.created_at')} BETWEEN ? AND ? ORDER BY p.id`).all(from, to);
  const gateways = db.prepare('SELECT * FROM gateway_transactions').all();
  const gwByPayment = new Map(gateways.filter(g => g.payment_id).map(g => [g.payment_id, g]));
  const mismatches = [];

  for (const p of payments) {
    if (p.kind === 'payment' && !p.receipt_no) mismatches.push({ type: 'payment_without_receipt', payment_id: p.id, amount_paisa: p.amount_paisa });
    if (p.kind === 'payment' && p.method === 'khalti') {
      const g = gwByPayment.get(p.id);
      if (!g) mismatches.push({ type: 'payment_without_gateway_record', payment_id: p.id, amount_paisa: p.amount_paisa });
      else if (g.amount_paisa !== p.amount_paisa) mismatches.push({ type: 'gateway_amount_mismatch', payment_id: p.id, gateway_id: g.id, payment_paisa: p.amount_paisa, gateway_paisa: g.amount_paisa });
    }
  }
  for (const g of gateways.filter(g => g.status === 'completed' && !g.payment_id)) {
    mismatches.push({ type: 'completed_without_payment', gateway_id: g.id, amount_paisa: g.amount_paisa });
  }

  const khaltiByRef = new Map(payments.filter(p => p.kind === 'payment' && p.method === 'khalti').map(p => [p.reference, p]));
  if (Array.isArray(settlements)) {
    const seen = new Set();
    for (const s of settlements) {
      const id = String(s.provider_transaction_id || '');
      seen.add(id);
      const p = khaltiByRef.get(id);
      if (!p) mismatches.push({ type: 'settlement_without_payment', provider_transaction_id: id, amount_paisa: s.amount_paisa });
      else if (p.amount_paisa !== s.amount_paisa) mismatches.push({ type: 'settlement_amount_mismatch', provider_transaction_id: id, payment_paisa: p.amount_paisa, settlement_paisa: s.amount_paisa });
    }
    for (const [ref, p] of khaltiByRef) {
      if (!seen.has(ref)) mismatches.push({ type: 'payment_missing_from_settlement', payment_id: p.id, provider_transaction_id: ref, amount_paisa: p.amount_paisa });
    }
  }

  const sum = (rows, pred) => rows.filter(pred).reduce((s, r) => s + r.amount_paisa, 0);
  const totals = {
    payments_paisa: sum(payments, p => p.kind === 'payment'),
    refunds_paisa: sum(payments, p => p.kind === 'refund'),
    net_paisa: sum(payments, () => true),
    by_method: Object.fromEntries(['cash', 'bank', 'khalti'].map(m => [m, sum(payments, p => p.method === m)])),
    payment_count: payments.filter(p => p.kind === 'payment').length,
    refund_count: payments.filter(p => p.kind === 'refund').length,
  };
  return {
    from, to,
    ok: mismatches.length === 0,
    settlement_checked: Array.isArray(settlements),
    totals,
    mismatches,
  };
}
