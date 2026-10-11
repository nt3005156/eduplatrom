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
delete process.env.FEES_TIER_SUPERVISOR_PAISA; // defaults: NPR 10,000 and NPR 50,000
delete process.env.FEES_TIER_HEAD_PAISA;
delete process.env.MESSAGING_EMAIL_PROVIDER;

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { setKhaltiClientForTest, GatewayError } = await import('../src/services/fees/khalti.js');
const { runDailyFeeJob, dispatchRows, overpaymentsOn } = await import('../src/services/fees/dailyJob.js');
const { tierFor } = await import('../src/services/fees/money.js');
const { creditBalance, processedBy } = await import('../src/services/fees/ledger.js');
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

