// Phase 3 controls: cash and bank verification, overpayment as credit, explicit and automatic refunds,
// and the daily reconciliation job (window, once per day, exceptions, dispatch, escalation).
// Dates are fixed for the job: "now" is passed in, so the tests do not depend on the clock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-fees-ctl-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'controls.db');
process.env.UPLOADS_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-ctl';
fs.mkdirSync(process.env.UPLOADS_DIR, { recursive: true });
process.env.KHALTI_SECRET_KEY = 'test-not-a-real-key';
process.env.PUBLIC_BASE_URL = 'https://school.example.test';
// Job recipients and a small escalation threshold (NPR 10 = 1000 paisa). Email mode is "log" (simulated) in tests.
process.env.FEES_FINANCE_EMAILS = 'finance@school.test';
process.env.FEES_OPS_EMAILS = 'ops@school.test';
delete process.env.FEES_HEAD_FINANCE_EMAILS;
process.env.FEES_SUPERVISOR_EMAILS = 'supervisor@school.test';
process.env.FEES_SIGNOFF_EMAILS = 'finance.ops@school.test,head.finance@school.test';
delete process.env.FEES_TIER_SUPERVISOR_PAISA; // defaults: NPR 10,000 and NPR 50,000
delete process.env.FEES_TIER_HEAD_PAISA;
delete process.env.MESSAGING_EMAIL_PROVIDER;
// Concession threshold for this file: NPR 150 (15000 paisa). Above it a concession needs the Finance Manager.
// Lower than the default so the amounts in these tests stay inside the invoice that has NPR 300 already paid.
process.env.FEES_CONCESSION_HIGH_PAISA = '15000';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { setKhaltiClientForTest, GatewayError } = await import('../src/services/fees/khalti.js');
const { runDailyFeeJob, dispatchRows, overpaymentsOn } = await import('../src/services/fees/dailyJob.js');
const { tierFor } = await import('../src/services/fees/money.js');
const { creditBalance, processedBy, concessionTier, receiptView } = await import('../src/services/fees/ledger.js');
const { renderReceiptPdf } = await import('../src/services/fees/receiptPdf.js');
const { queueOverpaymentEmails } = await import('../src/services/fees/notifications.js');
const { processOutbox } = await import('../src/services/messaging/outbox.js');
const { formatNPR } = await import('../src/services/fees/money.js');

const PW = 'Ctl-Test-Pass-2026';
const ID = {};
const T = {};
let server;
let base;
let sessionId;
let headTui;

const kh = { txns: {}, n: 0 };
function fakeClient() {
  return {
    initiate: async payload => {
      kh.n++;
      const pidx = `CTL-${kh.n}`;
      kh.txns[pidx] = { pidx, status: 'Pending', total_amount: payload.amount, transaction_id: null };
      return { pidx, payment_url: `https://test-pay.khalti.test/?pidx=${pidx}`, expires_at: null };
    },
    lookup: async pidx => {
      const t = kh.txns[pidx];
      if (!t) throw new GatewayError('rejected', 'unknown');
      return { ...t };
    },
  };
}

function addUser(key, { role, class_level = null, section = null, roleKey = null, email = null }) {
  const roleId = roleKey ? db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey).id : null;
  const addr = email || `${key.toLowerCase()}@ctl.test`;
  ID[key] = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, approval_status, account_status, role_id)
    VALUES (?,?,?,?,?,?, 'approved', 'active', ?)`).run(key, addr, bcrypt.hashSync(PW, 4), role, class_level, section, roleId).lastInsertRowid);
}

async function login(key) {
  const email = db.prepare('SELECT email FROM users WHERE id = ?').get(ID[key]).email;
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email, password: PW }),
  });
  assert.equal(r.status, 200, `login ${key}`);
  T[key] = (await r.json()).token;
}
async function call(who, method, url, body) {
  const headers = who ? { Authorization: `Bearer ${T[who]}`, 'X-NITEX-Client': 'web', 'Content-Type': 'application/json' } : { 'X-NITEX-Client': 'web' };
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
}

const invoiceOf = (studentKey, period) => db.prepare('SELECT id FROM invoices WHERE student_id = ? AND period = ?').get(ID[studentKey], period).id;
// Cash is recorded by the clerk and finalized by the admin (a second person). Returns the finalize response.
async function cashPay(invoiceId, amount) {
  const sub = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invoiceId, amount_paisa: amount, method: 'cash' });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const dec = await call('admin', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));
  return dec;
}
const balanceOf = async id => (await call('admin', 'GET', `/api/fees/invoices/${id}`)).body.balance_paisa;

before(async () => {
  db.prepare("INSERT INTO roles (key, label, rank, is_system_role, description) VALUES ('fee_clerk','Fee clerk',3,0,'test')").run();
  db.prepare("INSERT INTO roles (key, label, rank, is_system_role, description) VALUES ('fee_manager','Finance manager',2,0,'test')").run();
  const grant = (roleKey, perms) => {
    const rid = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey).id;
    for (const p of perms) db.prepare("INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?,?, 'allow')")
      .run(rid, db.prepare('SELECT id FROM permissions WHERE key = ?').get(p).id);
  };
  grant('fee_clerk', ['fees.view', 'fees.collect', 'fees.manage']);
  grant('fee_manager', ['fees.view', 'fees.collect', 'fees.manage', 'fees.verify_payment']);

  addUser('admin', { role: 'admin', roleKey: 'system_admin' });
  addUser('clerk', { role: 'teacher', roleKey: 'fee_clerk' });
  addUser('manager', { role: 'teacher', roleKey: 'fee_manager' });
  addUser('gOver', { role: 'guardian', roleKey: 'guardian' });
  addUser('sOver', { role: 'student', class_level: 6, section: 'A' });
  addUser('sOld', { role: 'student', class_level: 6, section: 'B' });
  addUser('sClosed', { role: 'student', class_level: 6, section: 'C' });
  addUser('sStale', { role: 'student', class_level: 6, section: 'D' });
  addUser('sRecent', { role: 'student', class_level: 6, section: 'E' });
  db.prepare('INSERT INTO guardian_students (guardian_id, student_id, can_view_fees, can_pay_fees) VALUES (?,?,1,1)').run(ID.gOver, ID.sOver);

  sessionId = Number(db.prepare("INSERT INTO academic_sessions (name, start_date, end_date) VALUES ('2026-2027','2026-04-01','2027-03-31')").run().lastInsertRowid);
  headTui = db.prepare("INSERT INTO fee_heads (code, name, category) VALUES ('TUI','Tuition','tuition')").run().lastInsertRowid;

  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  setKhaltiClientForTest(fakeClient());
  for (const k of Object.keys(ID)) await login(k);

  const put = await call('admin', 'PUT', '/api/fees/structures', {
    session_id: sessionId, class_level: 6, period: 'Term 1',
    items: [{ fee_head_id: headTui, amount_paisa: 100000, due_date: '2026-09-15' }],
  });
  assert.equal(put.status, 200);
  const gen = await call('clerk', 'POST', '/api/fees/invoices/generate', { session_id: sessionId, class_level: 6, period: 'Term 1' });
  assert.equal(gen.status, 201);
});

after(() => {
  setKhaltiClientForTest(null);
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- cash and bank: recorded by one person, verified by another ----------

test('a bank payment is pending and posts nothing until verified; reference is unique', async () => {
  const inv = invoiceOf('sOld', 'Term 1');
  const before = await balanceOf(inv);
  const sub = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 20000, method: 'bank', reference: 'DEP-1' });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.status, 'pending_verification');
  assert.equal(sub.body.payment_id, undefined, 'no payment id yet');
  assert.equal(sub.body.method, 'bank');
  assert.equal(await balanceOf(inv), before, 'balance unchanged while pending');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE reference = 'DEP-1'").get().n, 0);
  const dup = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 100, method: 'bank', reference: 'DEP-1' });
  assert.equal(dup.status, 409);
});

test('the person who recorded a payment cannot verify it, and the clerk cannot verify at all', async () => {
  const sub = await call('manager', 'POST', '/api/fees/payments', { invoice_id: invoiceOf('sOld', 'Term 1'), amount_paisa: 5000, method: 'bank', reference: 'DEP-M1' });
  assert.equal(sub.status, 201);
  const self = await call('manager', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(self.status, 403);
  const clerkTry = await call('clerk', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(clerkTry.status, 403, 'clerk has no fees.verify_payment');
});

test('a verified bank payment posts the payment and a receipt; a rejected one posts nothing and cannot be decided twice', async () => {
  const inv = invoiceOf('sOld', 'Term 1');
  const before = await balanceOf(inv);
  const list = await call('manager', 'GET', '/api/fees/verifications?status=pending');
  const pending = list.body.verifications.find(d => d.reference === 'DEP-1');
  assert.ok(pending);
  const ok = await call('manager', 'POST', `/api/fees/verifications/${pending.id}/decision`, { decision: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.receipt_no >= 1);
  assert.equal(await balanceOf(inv), before - 20000);

  const rej = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 3000, method: 'bank', reference: 'DEP-R1' });
  const rejDeposit = rej.body.verification_id;
  const decided = await call('admin', 'POST', `/api/fees/verifications/${rejDeposit}/decision`, { decision: 'reject', note: 'Slip does not match the bank' });
  assert.equal(decided.body.status, 'rejected');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE reference = 'DEP-R1'").get().n, 0);
  const again = await call('admin', 'POST', `/api/fees/verifications/${rejDeposit}/decision`, { decision: 'approve' });
  assert.equal(again.status, 409);
});

test('a cash payment waits for a second person; the clerk cannot finalize it; no receipt until then', async () => {
  const inv = invoiceOf('sOld', 'Term 1');
  const before = await balanceOf(inv);
  const sub = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 7000, method: 'cash' });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.status, 'pending_verification');
  assert.equal(sub.body.draft_receipt, `DRAFT-${sub.body.verification_id}`);
  assert.equal(await balanceOf(inv), before, 'balance unchanged until a second person finalizes the cash');
  const self = await call('clerk', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(self.status, 403);
  const fin = await call('manager', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.equal(await balanceOf(inv), before - 7000);
  assert.equal(fin.body.recorded_by !== undefined, true);
  const audit = db.prepare("SELECT new_value FROM audit_logs WHERE action = 'payment_verified' ORDER BY id DESC LIMIT 1").get();
  assert.ok(audit, 'finalizing is audited');
  const payload = JSON.parse(audit.new_value);
  assert.equal(payload.receipt_no, fin.body.receipt_no);
  assert.equal(payload.verified_by !== payload.recorded_by, true, 'the audit names both people, and they differ');
});

// ---------- overpayment becomes credit ----------

test('an overpaid online payment becomes credit, and the credit is applied to the next invoice generated', async () => {
  const t1 = invoiceOf('sOver', 'Term 1');
  const start = await call('gOver', 'POST', `/api/guardian/fees/invoices/${t1}/pay-online`, {});
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const pidx = start.body.payment_url.split('pidx=')[1];
  // Cash arrives while the online payment is open. The balance drops to 60000.
  const cash = await cashPay(t1, 40000);
  assert.equal(cash.body.receipt_no >= 1, true);
  kh.txns[pidx].status = 'Completed';
  kh.txns[pidx].transaction_id = 'TXN-OVER-1';
  const r = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}`);
  assert.equal(r.body.outcome, 'paid');
  assert.equal(r.body.credit_added_paisa, 40000, 'the 40000 above the 60000 balance is credit');
  assert.equal(await balanceOf(t1), 0);
  assert.equal(creditBalance(ID.sOver), 40000);

  const structure = await call('admin', 'PUT', '/api/fees/structures', {
    session_id: sessionId, class_level: 6, period: 'Term 2',
    items: [{ fee_head_id: headTui, amount_paisa: 100000, due_date: '2026-12-15' }],
  });
  assert.equal(structure.status, 200);
  const gen = await call('clerk', 'POST', '/api/fees/invoices/generate', { session_id: sessionId, class_level: 6, period: 'Term 2' });
  assert.equal(gen.status, 201);
  assert.equal(gen.body.credit_applied_paisa, 40000);
  const t2 = invoiceOf('sOver', 'Term 2');
  const detail = (await call('admin', 'GET', `/api/fees/invoices/${t2}`)).body;
  assert.equal(detail.credit_applied_paisa, 40000);
  assert.equal(detail.balance_paisa, 60000);
  assert.equal(creditBalance(ID.sOver), 0);
});

test('credit is not applied to an existing invoice unless someone asks for it', async () => {
  const t1 = invoiceOf('sOver', 'Term 1');
  const sumBefore = db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE invoice_id = ? AND kind = 'apply'").get(t1).n;
  assert.equal(sumBefore, 0);
  const none = await call('clerk', 'POST', `/api/fees/invoices/${t1}/apply-credit`, {});
  assert.equal(none.status, 409, 'nothing to apply: the invoice is paid and there is no credit');
});

test('an explicit refund of credit needs admin, a bank reference, and a cap at the credit balance', async () => {
  const t2 = invoiceOf('sOver', 'Term 2');
  const start = await call('gOver', 'POST', `/api/guardian/fees/invoices/${t2}/pay-online`, {});
  assert.equal(start.status, 201);
  const pidx = start.body.payment_url.split('pidx=')[1];
  await cashPay(t2, 10000);
  kh.txns[pidx].status = 'Completed';
  kh.txns[pidx].transaction_id = 'TXN-OVER-2';
  const r = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}`);
  assert.equal(r.body.credit_added_paisa, 10000);
  assert.equal(creditBalance(ID.sOver), 10000);

  const byClerk = await call('clerk', 'POST', `/api/fees/students/${ID.sOver}/credit/refund`, { reason: 'Family asked', reference: 'NEFT-0' });
  assert.equal(byClerk.status, 403);
  const noRef = await call('admin', 'POST', `/api/fees/students/${ID.sOver}/credit/refund`, { reason: 'Family asked', amount_paisa: 4000 });
  assert.equal(noRef.status, 400);
  const tooMuch = await call('admin', 'POST', `/api/fees/students/${ID.sOver}/credit/refund`, { reason: 'Family asked', amount_paisa: 15000, reference: 'NEFT-1' });
  assert.equal(tooMuch.status, 409);
  const part = await call('admin', 'POST', `/api/fees/students/${ID.sOver}/credit/refund`, { reason: 'Family asked', amount_paisa: 4000, reference: 'NEFT-2' });
  assert.equal(part.status, 201);
  assert.equal(part.body.balance_after_paisa, 6000);
  const rest = await call('admin', 'POST', `/api/fees/students/${ID.sOver}/credit/refund`, { reason: 'Family asked', reference: 'NEFT-3' });
  assert.equal(rest.body.amount_paisa, 6000);
  assert.equal(creditBalance(ID.sOver), 0);
  const none = await call('admin', 'POST', `/api/fees/students/${ID.sOver}/credit/refund`, { reason: 'Again', reference: 'NEFT-4' });
  assert.equal(none.status, 409);
  const statement = await call('admin', 'GET', `/api/fees/students/${ID.sOver}/credit`);
  assert.equal(statement.body.balance_paisa, 0);
  assert.ok(statement.body.entries.some(e => e.kind === 'refund' && e.reference === 'NEFT-2'));
});

// Credit rows are inserted directly here, to set their dates. The ledger is append-only, so these are inserts only.
function seedCredit(studentKey, amount, createdAt) {
  db.prepare(`INSERT INTO credit_ledger (student_id, kind, amount_paisa, reason, created_at) VALUES (?, 'credit', ?, 'test seed', ?)`)
    .run(ID[studentKey], amount, createdAt);
}

// ---------- daily job ----------
// Timeline (Nepal time). Each run covers the school date before its own date.
//   Day 1: run 2026-10-12 01:00, reconciles 2026-10-11
//   Day 2: run 2026-10-13 01:00, reconciles 2026-10-12
//   Day 4: run 2026-10-15 01:00, reconciles 2026-10-14 (48 hours after day 2)
const DAY1 = new Date('2026-10-11T19:15:00Z');
const DAY1_AFTERNOON = new Date('2026-10-12T07:15:00Z'); // 13:00 Nepal on 2026-10-12
const DAY2 = new Date('2026-10-12T19:15:00Z');
const DAY4 = new Date('2026-10-14T19:15:00Z');

test('automatic refunds: a closed account is refunded; credit unused for 90 days is refunded; recent credit is not', async () => {
  seedCredit('sClosed', 5000, '2026-10-10 00:00:00');
  db.prepare("UPDATE users SET account_status = 'archived' WHERE id = ?").run(ID.sClosed);
  seedCredit('sStale', 7000, '2026-01-01 00:00:00');
  seedCredit('sRecent', 3000, '2026-10-10 00:00:00');

  const outside = await runDailyFeeJob({ now: DAY1_AFTERNOON });
  assert.equal(outside.ran, false);
  assert.equal(outside.reason, 'outside_window');
  assert.equal(creditBalance(ID.sClosed), 5000, 'nothing ran outside the window');

  const first = await runDailyFeeJob({ now: DAY1 });
  assert.equal(first.ran, true);
  assert.equal(first.run_date, '2026-10-12');
  assert.equal(creditBalance(ID.sClosed), 0);
  assert.equal(creditBalance(ID.sStale), 0, 'unused for over 90 days: refunded');
  assert.equal(creditBalance(ID.sRecent), 3000, 'recent credit is left alone');
  const stale = db.prepare("SELECT amount_paisa, reason, reference FROM credit_ledger WHERE student_id = ? AND kind = 'refund'").all(ID.sStale);
  assert.equal(stale.length, 1);
  assert.match(stale[0].reason, /Automatic: credit unused for 90 days/);
  assert.equal(stale[0].reference, null, 'automatic refunds carry no bank reference until finance records the payout');
  assert.match(db.prepare("SELECT reason FROM credit_ledger WHERE student_id = ? AND kind = 'refund'").get(ID.sClosed).reason, /account closed/);
});

test('the daily job runs once per school date, even when called again or forced', async () => {
  const again = await runDailyFeeJob({ now: DAY1 });
  assert.equal(again.reason, 'already_ran');
  const forced = await runDailyFeeJob({ now: DAY1_AFTERNOON, force: true });
  assert.equal(forced.reason, 'already_ran', 'a manual run on the same school date does not repeat the job');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fee_job_runs WHERE run_date = '2026-10-12'").get().n, 1);
});

test('mismatches escalate by tier: medium to the Finance Supervisor, high to the Head of Finance, low stays with operations', async () => {
  const inv = invoiceOf('sRecent', 'Term 1');
  // Payments on 2026-10-12 (Nepal) with no receipt. These are the amounts in paisa.
  const orphan = db.prepare("INSERT INTO payments (invoice_id, student_id, kind, amount_paisa, method, reference, created_at) VALUES (?,?, 'payment', ?, 'cash', ?, '2026-10-12 10:00:00')");
  orphan.run(inv, ID.sRecent, 50000, 'ORPH-LOW');      // NPR 500: low tier
  orphan.run(inv, ID.sRecent, 2000000, 'ORPH-MID');    // NPR 20,000: medium tier
  orphan.run(inv, ID.sRecent, 6000000, 'ORPH-HIGH');   // NPR 60,000: high tier
  // Earlier tests post overpayments with the real clock, so some may fall on this school date too. Count them first.
  const baseline = overpaymentsOn('2026-10-12');
  const baselineEscalated = baseline.filter(o => tierFor(o.amount_paisa) !== 'low').length;
  // An overpayment on the same day, NPR 25,000: medium tier, so the Finance Supervisor sees it too.
  db.prepare("INSERT INTO credit_ledger (student_id, kind, amount_paisa, invoice_id, reason, created_at) VALUES (?, 'credit', 2500000, ?, 'Overpayment', '2026-10-12 12:00:00')")
    .run(ID.sRecent, inv);

  const r = await runDailyFeeJob({ now: DAY2 });
  assert.equal(r.ran, true);
  assert.equal(r.run_date, '2026-10-13');
  assert.equal(r.summary.mismatches_found, 3);
  assert.equal(r.summary.overpayments, baseline.length + 1);
  assert.equal(r.summary.escalated_supervisor, 1);
  assert.equal(r.summary.escalated_head_of_finance, 1);
  assert.equal(r.summary.overpayments_escalated, baselineEscalated + 1);

  const ex = amount => db.prepare("SELECT * FROM reconciliation_exceptions WHERE type = 'payment_without_receipt' AND amount_paisa = ?").get(amount);
  const low = ex(50000), mid = ex(2000000), high = ex(6000000);
  assert.equal(low.status, 'open');
  assert.equal(low.escalation_level, null, 'low tier: not escalated');
  assert.equal(low.escalated_at, null);
  assert.equal(mid.escalation_level, 'supervisor');
  assert.ok(mid.escalated_at);
  assert.equal(high.escalation_level, 'head_of_finance');

  const rows = dispatchRows('2026-10-13');
  assert.ok(rows.some(x => x.audience === 'finance' && x.recipient === 'finance@school.test' && x.status === 'simulated'), 'finance got the itemized report');
  assert.ok(rows.some(x => x.audience === 'ops' && x.recipient === 'ops@school.test' && x.status === 'simulated'), 'ops got the summary');
  const sup = rows.filter(x => x.audience === 'supervisor');
  assert.equal(sup.length, 1);
  assert.equal(sup[0].recipient, 'supervisor@school.test');
  assert.equal(sup[0].status, 'simulated', 'supervisor address is configured, so it is sent');
  const head = rows.filter(x => x.audience === 'head_of_finance');
  assert.equal(head.length, 1, 'one escalation email to the Head of Finance');
  assert.equal(head[0].status, 'held', 'no Head of Finance address is configured, so it is held, not dropped');
  assert.match(head[0].error, /FEES_HEAD_FINANCE_EMAILS/);

  const finance = db.prepare("SELECT body FROM fee_dispatches WHERE run_date = '2026-10-13' AND audience = 'finance' LIMIT 1").get().body;
  assert.match(finance, /NPR 60,000\.00/, 'amounts are shown in NPR with Nepali grouping');
  assert.match(finance, /NPR 500\.00/);
  const supBody = db.prepare("SELECT body FROM fee_dispatches WHERE run_date = '2026-10-13' AND audience = 'supervisor' LIMIT 1").get().body;
  assert.match(supBody, /NPR 25,000\.00/, 'the overpayment is in the supervisor escalation');
  assert.match(supBody, /NPR 20,000\.00/);
  assert.doesNotMatch(supBody, /NPR 60,000\.00/, 'high-tier items go to the Head of Finance, not the supervisor');
});

test('an open exception goes up a level after 48 hours, and the low-tier one reaches the Head of Finance', async () => {
  const r = await runDailyFeeJob({ now: DAY4 });
  assert.equal(r.ran, true);
  assert.equal(r.run_date, '2026-10-15');
  const ex = amount => db.prepare("SELECT * FROM reconciliation_exceptions WHERE type = 'payment_without_receipt' AND amount_paisa = ?").get(amount);
  assert.equal(ex(50000).status, 'open', 'nothing auto-closes an exception');
  assert.equal(ex(50000).escalation_level, 'head_of_finance', 'low tier, open 48 hours: Head of Finance');
  assert.equal(ex(2000000).escalation_level, 'head_of_finance', 'medium tier, open 48 hours: raised from the supervisor');
  assert.equal(ex(6000000).escalation_level, 'head_of_finance');
  const rows = dispatchRows('2026-10-15');
  assert.equal(rows.filter(x => x.audience === 'head_of_finance').length, 1, 'one escalation email for the two newly raised items');
  assert.equal(rows.filter(x => x.audience === 'supervisor').length, 0, 'nothing new for the supervisor');
  const summary = JSON.parse(db.prepare("SELECT summary FROM fee_job_runs WHERE job = 'daily' AND run_date = '2026-10-15'").get().summary);
  assert.equal(summary.escalated_head_of_finance, 2);
  assert.equal(summary.escalated_supervisor, 0);
});

test('an exception is closed by a person with a note; the close is audited and cannot be repeated', async () => {
  const low = db.prepare("SELECT id FROM reconciliation_exceptions WHERE type = 'payment_without_receipt' AND amount_paisa = 50000").get();
  const tooShort = await call('clerk', 'POST', `/api/fees/reconciliation/exceptions/${low.id}/resolve`, { note: 'x' });
  assert.equal(tooShort.status, 400);
  const ok = await call('clerk', 'POST', `/api/fees/reconciliation/exceptions/${low.id}/resolve`, { note: 'Receipt issued late, cash in drawer' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const open = await call('admin', 'GET', '/api/fees/reconciliation/exceptions?status=open');
  assert.ok(!open.body.exceptions.some(e => e.id === low.id), 'resolved items leave the open list');
  const again = await call('admin', 'POST', `/api/fees/reconciliation/exceptions/${low.id}/resolve`, { note: 'Second try' });
  assert.equal(again.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE module = 'fees' AND action = 'reconciliation_resolved'").get().n, 1);
});

// ---------- staff numbers, roles, receipts, guardian notices ----------

test('staff numbers: admin sets them; they are unique and stored uppercase; students cannot have one; clerks cannot set them', async () => {
  const stu = await call('admin', 'PUT', `/api/fees/staff/${ID.sOld}/employee-no`, { employee_no: 'STU-1' });
  assert.equal(stu.status, 400, 'students have no staff number');
  const bad = await call('admin', 'PUT', `/api/fees/staff/${ID.clerk}/employee-no`, { employee_no: 'bad id!' });
  assert.equal(bad.status, 400);
  const ok = await call('admin', 'PUT', `/api/fees/staff/${ID.clerk}/employee-no`, { employee_no: 'csh-002' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.employee_no, 'CSH-002');
  addUser('officer', { role: 'teacher', roleKey: 'finance_officer' });
  await login('officer');
  const dup = await call('admin', 'PUT', `/api/fees/staff/${ID.officer}/employee-no`, { employee_no: 'CSH-002' });
  assert.equal(dup.status, 409, 'a staff number is used once');
  const fin = await call('admin', 'PUT', `/api/fees/staff/${ID.officer}/employee-no`, { employee_no: 'FIN-014' });
  assert.equal(fin.status, 200);
  const clerkTry = await call('clerk', 'PUT', `/api/fees/staff/${ID.officer}/employee-no`, { employee_no: 'X-1' });
  assert.equal(clerkTry.status, 403, 'only the admin sets staff numbers');
});

test('the Finance Officer verifies but cannot record; the receipt shows who processed it and who verified it', async () => {
  const inv = invoiceOf('sOld', 'Term 1');
  const sub = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 3000, method: 'cash' });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const officerRecords = await call('officer', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 100, method: 'cash' });
  assert.equal(officerRecords.status, 403, 'the officer cannot record money');
  const queue = await call('officer', 'GET', '/api/fees/verifications?status=pending');
  assert.equal(queue.status, 200, 'the officer can see the queue');
  const self = await call('clerk', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(self.status, 403);
  const dec = await call('officer', 'POST', `/api/fees/verifications/${sub.body.verification_id}/decision`, { decision: 'approve' });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));

  const rc = await call('admin', 'GET', `/api/fees/receipts/${dec.body.receipt_no}`);
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.equal(rc.body.processed_by, 'CSH-002 / clerk');
  assert.equal(rc.body.verified_by, 'FIN-014 / officer');
  assert.equal(rc.body.amount_paisa, 3000);
  const detail = await call('admin', 'GET', `/api/fees/invoices/${inv}`);
  const row = detail.body.payments.find(p => p.id === dec.body.payment_id);
  assert.equal(row.processed_by, 'CSH-002 / clerk');
  assert.equal(row.verified_by, 'FIN-014 / officer');

  const v = db.prepare('SELECT recorded_by_emp_no, decided_by_emp_no FROM payment_verifications WHERE id = ?').get(sub.body.verification_id);
  assert.deepEqual({ ...v }, { recorded_by_emp_no: 'CSH-002', decided_by_emp_no: 'FIN-014' });
  assert.equal(db.prepare('SELECT recorded_by_emp_no FROM payments WHERE id = ?').get(dec.body.payment_id).recorded_by_emp_no, 'CSH-002');
  const audit = db.prepare("SELECT employee_no FROM audit_logs WHERE action = 'payment_verified' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.employee_no, 'FIN-014', 'the audit trail carries the verifier staff number');
  assert.equal((await call('admin', 'GET', '/api/fees/receipts/999999')).status, 404);
  assert.equal(processedBy(null, 'Ram'), 'Ram (no staff number)', 'an account without a staff number is still named');
});

test('an overpayment creates an in-app notice for the guardian, which can be marked seen; the invoice shows the credit balance', async () => {
  const alerts = await call('gOver', 'GET', '/api/guardian/fees/alerts');
  assert.equal(alerts.status, 200, JSON.stringify(alerts.body));
  const child = alerts.body.children.find(c => c.student_id === ID.sOver);
  assert.ok(child, 'the linked child is listed');
  assert.ok(child.notices.length >= 1, 'the overpayment notice is waiting');
  const n = child.notices[0];
  assert.match(n.message, /An overpayment of NPR 400\.00 was credited/);
  assert.doesNotMatch(n.message, /https?:/, 'version 1 has no link');
  const seen = await call('gOver', 'POST', `/api/guardian/fees/notices/${n.id}/seen`, {});
  assert.equal(seen.status, 200);
  assert.equal(seen.body.changed, true);
  const again = await call('gOver', 'POST', `/api/guardian/fees/notices/${n.id}/seen`, {});
  assert.equal(again.body.changed, false, 'marking seen twice changes nothing');
  const after = await call('gOver', 'GET', '/api/guardian/fees/alerts');
  assert.equal(after.body.children.find(c => c.student_id === ID.sOver).notices.some(x => x.id === n.id), false);
  assert.equal((await call('clerk', 'POST', `/api/guardian/fees/notices/${n.id}/seen`, {})).status, 403, 'staff cannot use the guardian route');
  const det = await call('admin', 'GET', `/api/fees/invoices/${invoiceOf('sOver', 'Term 2')}`);
  assert.equal(det.body.credit_balance_paisa, 0, 'the credit was applied to Term 2');
});

// ---------- concession tiers ----------

test('concessions: a standard one is approved by the Finance Officer; a high-value one only by the Finance Manager', async () => {
  addUser('fmgr', { role: 'teacher', roleKey: 'finance_manager' });
  await login('fmgr');
  const body = (amount, reason) => ({ student_id: ID.sOld, session_id: sessionId, period: 'Term 1', fee_head_id: headTui, amount_paisa: amount, reason });

  assert.equal(concessionTier(15000), 'standard', 'exactly at the threshold is standard');
  assert.equal(concessionTier(15001), 'high', 'above the threshold is high');

  const std = await call('manager', 'POST', '/api/fees/concessions', body(10000, 'Sibling discount'));
  assert.equal(std.status, 201, JSON.stringify(std.body));
  assert.equal((await call('clerk', 'POST', `/api/fees/concessions/${std.body.id}/decision`, { decision: 'approve' })).status, 403, 'a clerk cannot approve');
  const stdOk = await call('officer', 'POST', `/api/fees/concessions/${std.body.id}/decision`, { decision: 'approve' });
  assert.equal(stdOk.status, 200, JSON.stringify(stdOk.body));
  assert.equal(stdOk.body.status, 'approved');

  const high = await call('manager', 'POST', '/api/fees/concessions', body(40000, 'Part scholarship'));
  assert.equal(high.status, 201);
  const queue = await call('officer', 'GET', '/api/fees/concessions?status=requested&tier=high');
  assert.equal(queue.status, 200);
  assert.ok(queue.body.concessions.some(c => c.id === high.body.id && c.tier === 'high'), 'the high-value request is in the high-tier queue');
  const offHigh = await call('officer', 'POST', `/api/fees/concessions/${high.body.id}/decision`, { decision: 'approve' });
  assert.equal(offHigh.status, 403, 'the Finance Officer cannot approve a high-value concession');
  assert.match(offHigh.body.error, /Finance Manager/);
  // The system admin is the fallback approver for high-value concessions (decided 2026-10-12), but never their own request.
  const selfAdmin = await call('admin', 'POST', '/api/fees/concessions', body(40000, 'Admin-requested high-value'));
  const ownHigh = await call('admin', 'POST', `/api/fees/concessions/${selfAdmin.body.id}/decision`, { decision: 'approve' });
  assert.equal(ownHigh.status, 403, 'the admin cannot approve the admin\'s own high-value request');
  assert.match(ownHigh.body.error, /cannot approve it/);
  const rejectOk = await call('officer', 'POST', `/api/fees/concessions/${high.body.id}/decision`, { decision: 'reject' });
  assert.equal(rejectOk.status, 200, 'anyone with the approval permission may reject a high-value request');
  const again = await call('fmgr', 'POST', `/api/fees/concessions/${high.body.id}/decision`, { decision: 'approve' });
  assert.equal(again.status, 409, 'a rejected request cannot be approved later');

  // Fallback: the system admin approves a high-value request from someone else, and the audit entry says so.
  const hiFb = await call('manager', 'POST', '/api/fees/concessions', body(16000, 'Fallback case'));
  const fb = await call('admin', 'POST', `/api/fees/concessions/${hiFb.body.id}/decision`, { decision: 'approve' });
  assert.equal(fb.status, 200, JSON.stringify(fb.body));
  const fbAudit = db.prepare("SELECT new_value FROM audit_logs WHERE action = 'concession_approved' ORDER BY id DESC LIMIT 1").get();
  assert.equal(JSON.parse(fbAudit.new_value).fallback_approver, true, 'the audit entry marks the admin fallback');
  const high2 = await call('manager', 'POST', '/api/fees/concessions', body(16000, 'Part scholarship (second)'));
  const fm = await call('fmgr', 'POST', `/api/fees/concessions/${high2.body.id}/decision`, { decision: 'approve' });
  assert.equal(fm.status, 200, JSON.stringify(fm.body));
  assert.equal(fm.body.status, 'approved');
  const row = db.prepare('SELECT status, decided_by FROM concessions WHERE id = ?').get(high2.body.id);
  assert.deepEqual({ ...row }, { status: 'approved', decided_by: ID.fmgr });
  const audit = db.prepare("SELECT new_value FROM audit_logs WHERE action = 'concession_approved' ORDER BY id DESC LIMIT 1").get();
  assert.equal(JSON.parse(audit.new_value).tier, 'high', 'the audit entry records the tier');
});

// ---------- overpayment email through the outbox ----------

test('overpayment email: queued as a mandatory fee notice, and sent even to an opted-out guardian; attendance opt-outs still hold', async () => {
  db.prepare('UPDATE messaging_config SET alerts_enabled = 1, email_enabled = 1 WHERE id = 1').run();
  const mine = db.prepare("SELECT * FROM message_outbox WHERE event_kind = 'fee_notice' AND user_id = ?").get(ID.gOver);
  assert.ok(mine, 'the overpayment queued an email for the guardian with fee access');
  assert.equal(mine.channel, 'email');
  assert.equal(mine.recipient, 'gover@ctl.test');
  assert.equal(mine.template_id, 'fees.overpayment.v1');
  assert.equal(mine.status, 'queued');
  assert.match(mine.body, /An overpayment of NPR 400\.00 was detected and credited/);
  assert.doesNotMatch(mine.body, /https?:\/\//, 'no link in version 1');

  db.prepare("INSERT OR IGNORE INTO message_optouts (recipient, channel) VALUES ('gover@ctl.test', 'email')").run();
  db.prepare(`INSERT INTO message_outbox (channel, recipient, user_id, student_id, template_id, subject, body, dedupe_key, event_kind, event_date, event_status, status)
    VALUES ('email', 'gover@ctl.test', ?, ?, 'attendance.absent.v1', 's', 'b', 'ctl-att-optout', 'attendance', '2026-10-01', 'absent', 'queued')`).run(ID.gOver, ID.sOver);

  await processOutbox({ limit: 500 });
  assert.equal(db.prepare('SELECT status FROM message_outbox WHERE id = ?').get(mine.id).status, 'simulated',
    'the mandatory notice goes out (log mode) despite the opt-out');
  assert.equal(db.prepare("SELECT status FROM message_outbox WHERE dedupe_key = 'ctl-att-optout'").get().status, 'skipped_optout',
    'an attendance alert to the same address is still blocked by the opt-out');
});

test('fee notice queueing: no valid address is recorded as no contact, and a repeat for the same notice does not duplicate', () => {
  addUser('gNoMail', { role: 'guardian', roleKey: 'guardian', email: 'not-an-address' });
  db.prepare('INSERT INTO guardian_students (guardian_id, student_id, can_view_fees, can_pay_fees) VALUES (?,?,1,0)').run(ID.gNoMail, ID.sRecent);
  const first = queueOverpaymentEmails({ noticeId: 987001, studentId: ID.sRecent, amount_paisa: 1000 });
  assert.equal(first.skipped_no_contact, 1);
  assert.equal(first.queued, 0);
  const second = queueOverpaymentEmails({ noticeId: 987001, studentId: ID.sRecent, amount_paisa: 1000 });
  assert.equal(second.duplicate, 1);
  assert.equal(second.queued, 0);
  const row = db.prepare('SELECT status, recipient FROM message_outbox WHERE dedupe_key = ?').get(`email|none:${ID.gNoMail}|fee_notice|987001`);
  assert.deepEqual({ ...row }, { status: 'skipped_no_contact', recipient: null });
});

test('mandatory is an explicit per-row flag: an opted-out fee notice without it is blocked, and only fee notices may be mandatory', async () => {
  const { enqueue } = await import('../src/services/messaging/outbox.js');
  const base = { channel: 'email', recipient: 'gover@ctl.test', template_id: 'fees.overpayment.v1', subject: 's', body: 'b',
    user_id: ID.gOver, student_id: ID.sOver, event_kind: 'fee_notice' };
  enqueue({ ...base, dedupe_key: 'ctl-flag-off', mandatory: false });
  enqueue({ ...base, dedupe_key: 'ctl-flag-on', mandatory: true });
  assert.throws(() => enqueue({ ...base, event_kind: 'notice', dedupe_key: 'ctl-flag-bad', mandatory: true }),
    /only fee_notice messages can be mandatory/);
  await processOutbox({ limit: 500 });
  assert.equal(db.prepare("SELECT status FROM message_outbox WHERE dedupe_key = 'ctl-flag-off'").get().status, 'skipped_optout');
  assert.equal(db.prepare("SELECT status FROM message_outbox WHERE dedupe_key = 'ctl-flag-on'").get().status, 'simulated');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM message_outbox WHERE dedupe_key = 'ctl-flag-bad'").get().n, 0);
});

// ---------- receipt PDF ----------

// pdfkit writes each text run as hex glyph codes inside [...] TJ. Decode them so the test can read the words.
function pdfText(buf) {
  const src = buf.toString('latin1');
  const runs = [];
  for (const m of src.matchAll(/\[((?:<[0-9a-fA-F]*>|-?[\d.]+|\s)*)\]\s*TJ/g)) {
    runs.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map(h => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return runs.join('\n');
}

test('receipt PDF: staff download it; the linked guardian can; another guardian and the student cannot', async () => {
  const mine = db.prepare(`SELECT r.receipt_no FROM receipts r JOIN payments p ON p.id = r.payment_id
    WHERE p.recorded_by_emp_no = 'CSH-002' AND p.student_id = ? ORDER BY r.receipt_no LIMIT 1`).get(ID.sOld);
  assert.ok(mine, 'a cash receipt recorded by CSH-002 exists');
  const get = (who, url) => fetch(base + url, { headers: { Authorization: `Bearer ${T[who]}` } });

  const staff = await get('admin', `/api/fees/receipts/${mine.receipt_no}/pdf`);
  assert.equal(staff.status, 200);
  assert.match(staff.headers.get('content-type'), /application\/pdf/);
  assert.match(staff.headers.get('content-disposition'), new RegExp(`receipt-${mine.receipt_no}\\.pdf`));
  const bytes = Buffer.from(await staff.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');

  const text = pdfText(await renderReceiptPdf(receiptView(mine.receipt_no), { compress: false }));
  for (const want of ['Fee receipt', 'Invoice breakdown', 'Balance due', 'CSH-002 / clerk', 'FIN-014 / officer', 'This payment']) {
    assert.ok(text.includes(want), `the receipt shows "${want}"`);
  }

  addUser('gOther', { role: 'guardian', roleKey: 'guardian' });
  await login('gOther');
  const child = db.prepare(`SELECT r.receipt_no FROM receipts r JOIN payments p ON p.id = r.payment_id
    WHERE p.student_id = ? ORDER BY r.receipt_no LIMIT 1`).get(ID.sOver);
  assert.ok(child, 'the child has a receipt');
  assert.equal((await get('gOver', `/api/guardian/fees/receipts/${child.receipt_no}/pdf`)).status, 200, 'the linked guardian can download');
  assert.equal((await get('gOther', `/api/guardian/fees/receipts/${child.receipt_no}/pdf`)).status, 404, 'an unlinked guardian gets 404');
  assert.equal((await get('sOver', `/api/guardian/fees/receipts/${child.receipt_no}/pdf`)).status, 403, 'a student cannot use the guardian route');
  assert.equal((await get('gOver', `/api/fees/receipts/${child.receipt_no}/pdf`)).status, 403, 'a guardian cannot use the staff route');
  assert.equal((await get('admin', '/api/fees/receipts/999999/pdf')).status, 404);
});

// ---------- daily fee audit sign-off ----------

test('daily fee audit: the job creates the sign-off; the Finance Manager signs off; open items need a note; a returned day can be signed later', async () => {
  const run = await runDailyFeeJob({ now: new Date('2027-01-15T06:00:00Z'), force: true });
  assert.equal(run.ran, true);
  const so = db.prepare("SELECT * FROM fee_daily_signoffs WHERE reconciled_date = '2027-01-14'").get();
  assert.ok(so, 'a sign-off row exists for the reconciled day');
  assert.equal(so.status, 'pending');

  // The digest goes to the two configured addresses, carries the totals, and links to the sign-off screen.
  const digest = dispatchRows('2027-01-15').filter(d => d.audience === 'signoff');
  assert.deepEqual(digest.map(d => d.recipient).sort(), ['finance.ops@school.test', 'head.finance@school.test']);
  assert.ok(digest.every(d => d.status === 'simulated'), 'log mode: recorded as simulated, not sent');
  const digestBody = db.prepare("SELECT body FROM fee_dispatches WHERE run_date = '2027-01-15' AND audience = 'signoff' LIMIT 1").get().body;
  assert.match(digestBody, /Total collected: NPR /);
  assert.match(digestBody, /Concessions approved that day: NPR /);
  assert.match(digestBody, /Mismatched transactions: \d+/);
  assert.ok(digestBody.includes('https://school.example.test/admin/fee-signoff?date=2027-01-14'), 'deep link to the sign-off screen');

  const list = await call('officer', 'GET', '/api/fees/signoffs?status=pending');
  assert.equal(list.status, 200, 'the Finance Officer can see the sign-off list');
  assert.ok(list.body.signoffs.some(x => x.id === so.id));
  assert.equal((await call('officer', 'POST', `/api/fees/signoffs/${so.id}/decision`, { decision: 'sign_off' })).status, 403,
    'the Finance Officer cannot sign off the daily audit');
  assert.equal((await call('clerk', 'POST', `/api/fees/signoffs/${so.id}/decision`, { decision: 'sign_off' })).status, 403);

  const outstanding = so.open_exceptions > 0 || so.pending_verifications > 0;
  const first = await call('fmgr', 'POST', `/api/fees/signoffs/${so.id}/decision`, { decision: 'sign_off' });
  if (outstanding) {
    assert.equal(first.status, 400, 'open items need a note before sign-off');
    assert.match(first.body.error, /open exception|unverified payment/);
  } else {
    assert.equal(first.status, 200, JSON.stringify(first.body));
  }
  const signed = outstanding
    ? await call('fmgr', 'POST', `/api/fees/signoffs/${so.id}/decision`, { decision: 'sign_off', note: 'Reviewed the open items with the bursar' })
    : first;
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.status, 'signed_off');
  assert.equal((await call('fmgr', 'POST', `/api/fees/signoffs/${so.id}/decision`, { decision: 'sign_off', note: 'again' })).status, 409,
    'a signed-off day cannot change');

  await runDailyFeeJob({ now: new Date('2027-01-16T06:00:00Z'), force: true });
  const next = db.prepare("SELECT * FROM fee_daily_signoffs WHERE reconciled_date = '2027-01-15'").get();
  assert.equal((await call('fmgr', 'POST', `/api/fees/signoffs/${next.id}/decision`, { decision: 'return' })).status, 400,
    'returning a day needs a note');
  const ret = await call('fmgr', 'POST', `/api/fees/signoffs/${next.id}/decision`, { decision: 'return', note: 'Missing bank slip for one deposit' });
  assert.equal(ret.status, 200);
  assert.equal(ret.body.status, 'returned');
  const later = await call('fmgr', 'POST', `/api/fees/signoffs/${next.id}/decision`, { decision: 'sign_off', note: 'Slip received and matched' });
  assert.equal(later.status, 200, 'a returned day can be signed off later');
  assert.equal(later.body.status, 'signed_off');
});

