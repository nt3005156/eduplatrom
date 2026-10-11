// Phase 3 acceptance tests: fees, invoices, receipts, Khalti verification, concessions, refunds, reconciliation.
// Khalti is replaced by a fake client. Nothing here calls the real Khalti API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-fees-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'fees.db');
process.env.UPLOADS_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-fees';
fs.mkdirSync(process.env.UPLOADS_DIR, { recursive: true });
// Khalti is configured for the success paths. The fake client answers every call.
process.env.KHALTI_SECRET_KEY = 'test-not-a-real-key';
process.env.PUBLIC_BASE_URL = 'https://school.example.test';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { setKhaltiClientForTest, GatewayError } = await import('../src/services/fees/khalti.js');
const { bucketFor, daysBetween, todayNepal, reconcile } = await import('../src/services/fees/ledger.js');

const PW = 'Fees-Test-Pass-2026';
const ID = {};
const T = {};
const AS_OF = '2026-10-11';
let server;
let base;

// Khalti fake. The test decides what each lookup returns.
const kh = { initiate: 0, lookup: 0, down: false, txns: {} };
function fakeClient() {
  return {
    initiate: async payload => {
      kh.initiate++;
      const pidx = `PIDX-${kh.initiate}-${Math.random().toString(36).slice(2, 7)}`;
      kh.txns[pidx] = { pidx, status: 'Pending', total_amount: payload.amount, transaction_id: null, purchase_order_id: payload.purchase_order_id };
      return { pidx, payment_url: `https://test-pay.khalti.test/?pidx=${pidx}`, expires_at: '2026-10-11T12:00:00Z' };
    },
    lookup: async pidx => {
      kh.lookup++;
      if (kh.down) throw new GatewayError('unavailable', 'down');
      const t = kh.txns[pidx];
      if (!t) throw new GatewayError('rejected', 'unknown pidx');
      return { ...t };
    },
  };
}
function settle(pidx, patch) {
  Object.assign(kh.txns[pidx], patch);
}

function addUser(key, { role, class_level = null, section = null, roleKey = null }) {
  const roleId = roleKey ? db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey).id : null;
  ID[key] = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, approval_status, account_status, role_id)
    VALUES (?,?,?,?,?,?, 'approved', 'active', ?)`).run(key, `${key.toLowerCase()}@fees.test`, bcrypt.hashSync(PW, 4), role, class_level, section, roleId).lastInsertRowid);
}

async function login(key) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email: `${key.toLowerCase()}@fees.test`, password: PW }),
  });
  assert.equal(r.status, 200, `login ${key}`);
  T[key] = (await r.json()).token;
}
const auth = who => ({ Authorization: `Bearer ${T[who]}`, 'X-NITEX-Client': 'web', 'Content-Type': 'application/json' });
async function call(who, method, url, body) {
  const r = await fetch(base + url, { method, headers: who ? auth(who) : { 'X-NITEX-Client': 'web' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
}

let sessionId, headTui, headExm, invKid, invKid2, invOther;

before(async () => {
  kh.down = false;
  db.prepare("INSERT INTO roles (key, label, rank, is_system_role, description) VALUES ('fee_clerk', 'Fee clerk', 3, 0, 'Test role')").run();
  const clerkRole = db.prepare("SELECT id FROM roles WHERE key = 'fee_clerk'").get().id;
  const perm = db.prepare('SELECT id FROM permissions WHERE key = ?');
  for (const key of ['fees.view', 'fees.collect', 'fees.manage']) {
    db.prepare("INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?,?, 'allow')").run(clerkRole, perm.get(key).id);
  }
  addUser('admin', { role: 'admin', roleKey: 'system_admin' });
  addUser('clerk', { role: 'teacher', roleKey: 'fee_clerk' });
  addUser('kid', { role: 'student', class_level: 8, section: 'A' });
  addUser('kid2', { role: 'student', class_level: 8, section: 'B' });
  addUser('kidAlt', { role: 'student', class_level: 9, section: 'A' });
  addUser('payingGuardian', { role: 'guardian', roleKey: 'guardian' });
  addUser('viewOnlyGuardian', { role: 'guardian', roleKey: 'guardian' });
  addUser('restrictedGuardian', { role: 'guardian', roleKey: 'guardian' });
  addUser('requester', { role: 'teacher', roleKey: 'fee_clerk' });
  sessionId = Number(db.prepare("INSERT INTO academic_sessions (name, start_date, end_date) VALUES ('2026-2027','2026-04-01','2027-03-31')").run().lastInsertRowid);
  db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, can_view_fees, can_pay_fees) VALUES (?,?,1,1)`).run(ID.payingGuardian, ID.kid);
  db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, can_view_fees, can_pay_fees) VALUES (?,?,1,1)`).run(ID.payingGuardian, ID.kid2);
  db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, can_view_fees, can_pay_fees) VALUES (?,?,1,0)`).run(ID.viewOnlyGuardian, ID.kid2);
  db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, can_view_fees, can_pay_fees, restricted) VALUES (?,?,1,1,1)`).run(ID.restrictedGuardian, ID.kid);

  headTui = db.prepare("INSERT INTO fee_heads (code, name, category) VALUES ('TUI', 'Tuition', 'tuition')").run().lastInsertRowid;
  headExm = db.prepare("INSERT INTO fee_heads (code, name, category) VALUES ('EXM', 'Exam', 'exam')").run().lastInsertRowid;

  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  setKhaltiClientForTest(fakeClient());
  for (const k of Object.keys(ID)) await login(k);
});

after(() => {
  setKhaltiClientForTest(null);
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- setup through the API ----------

test('fee structure is saved with integer paisa and validation rejects floats', async () => {
  const bad = await call('admin', 'PUT', '/api/fees/structures', {
    session_id: sessionId, class_level: 8, period: 'Term 1',
    items: [{ fee_head_id: headTui, amount_paisa: 1500000.5, due_date: '2026-09-15' }],
  });
  assert.equal(bad.status, 400);
  const dup = await call('admin', 'PUT', '/api/fees/structures', {
    session_id: sessionId, class_level: 8, period: 'Term 1',
    items: [{ fee_head_id: headTui, amount_paisa: 100, due_date: '2026-09-15' }, { fee_head_id: headTui, amount_paisa: 100, due_date: '2026-09-15' }],
  });
  assert.equal(dup.status, 400);
  const ok = await call('admin', 'PUT', '/api/fees/structures', {
    session_id: sessionId, class_level: 8, period: 'Term 1',
    items: [
      { fee_head_id: headTui, amount_paisa: 1500000, due_date: '2026-09-15' },
      { fee_head_id: headExm, amount_paisa: 50000, due_date: '2026-09-15' },
    ],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lines.length, 2);
});

test('invoices are generated per student, totals come from items, and a second run creates nothing', async () => {
  const gen = await call('clerk', 'POST', '/api/fees/invoices/generate', { session_id: sessionId, class_level: 8, period: 'Term 1' });
  assert.equal(gen.status, 201);
  assert.equal(gen.body.created.length, 2);
  invKid = db.prepare("SELECT id FROM invoices WHERE student_id = ? AND period = 'Term 1'").get(ID.kid).id;
  invKid2 = db.prepare("SELECT id FROM invoices WHERE student_id = ? AND period = 'Term 1'").get(ID.kid2).id;
  const inv = await call('admin', 'GET', `/api/fees/invoices/${invKid}`);
  assert.equal(inv.body.gross_paisa, 1550000);
  assert.equal(inv.body.net_paisa, 1550000);
  assert.match(inv.body.invoice_no, /^INV-\d{6}$/);
  const again = await call('clerk', 'POST', '/api/fees/invoices/generate', { session_id: sessionId, class_level: 8, period: 'Term 1' });
  assert.equal(again.body.created.length, 0);
  assert.equal(again.body.skipped_existing, 2);
});

test('the same student and period cannot get two invoices, even when generation runs twice', () => {
  const n = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE student_id = ? AND period = 'Term 1'").get(ID.kid).n;
  assert.equal(n, 1);
});

// ---------- Khalti: the acceptance tests ----------

test('duplicate Khalti returns create exactly one payment and one receipt', async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE method = 'khalti'").get().n;
  const start = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid}/pay-online`, {});
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const last = Object.values(kh.txns).pop();
  settle(last.pidx, { status: 'Completed', transaction_id: 'TXN-DUP-1' });
  const [a, b, c] = await Promise.all([
    call(null, 'GET', `/api/fees/khalti/return?pidx=${last.pidx}&status=Completed`),
    call(null, 'GET', `/api/fees/khalti/return?pidx=${last.pidx}&status=Completed`),
    call(null, 'GET', `/api/fees/khalti/return?pidx=${last.pidx}`),
  ]);
  const outcomes = [a, b, c].map(r => r.body.outcome);
  assert.deepEqual(outcomes, ['paid', 'paid', 'paid']);
  assert.equal([a, b, c].filter(r => r.body.payment_id).length, 3);
  assert.equal(new Set([a, b, c].map(r => r.body.payment_id)).size, 1, 'all three point at the same payment');
  const again = await call(null, 'GET', `/api/fees/khalti/return?pidx=${last.pidx}`);
  assert.equal(again.body.outcome, 'paid');
  const after = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE method = 'khalti'").get().n;
  assert.equal(after - before, 1, 'one payment row');
  const receipts = db.prepare('SELECT COUNT(*) AS n FROM receipts r JOIN payments p ON p.id = r.payment_id WHERE p.method = ?').get('khalti').n;
  assert.equal(receipts, 1);
  const inv = await call('admin', 'GET', `/api/fees/invoices/${invKid}`);
  assert.equal(inv.body.balance_paisa, 0);
  assert.equal(inv.body.status, 'paid');
});

test('amount mismatch between Khalti and the invoice is rejected and nothing is recorded', async () => {
  const start = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, { amount_paisa: 100000 });
  assert.equal(start.status, 201);
  const t = kh.txns[start.body.payment_url.split('pidx=')[1]];
  settle(t.pidx, { status: 'Completed', transaction_id: 'TXN-MIS-1', total_amount: 99900 });
  const r = await call(null, 'GET', `/api/fees/khalti/return?pidx=${t.pidx}`);
  assert.equal(r.body.outcome, 'amount_mismatch');
  const n = db.prepare('SELECT COUNT(*) AS n FROM payments WHERE reference = ?').get('TXN-MIS-1').n;
  assert.equal(n, 0);
  const gw = db.prepare('SELECT status, failure_reason FROM gateway_transactions WHERE pidx = ?').get(t.pidx);
  assert.equal(gw.status, 'failed');
  assert.equal(gw.failure_reason, 'amount_mismatch');
});

test('provider status overrides a forged success in the return link', async () => {
  const start = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, {});
  assert.equal(start.status, 201);
  const pidx = start.body.payment_url.split('pidx=')[1];
  settle(pidx, { status: 'Pending', transaction_id: null });
  // The browser says "Completed" with a transaction id. The lookup says Pending. The lookup wins.
  const forged = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}&status=Completed&transaction_id=FORGED-1`);
  assert.equal(forged.body.outcome, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE reference = ?').get('FORGED-1').n, 0);
  assert.equal(db.prepare('SELECT status FROM gateway_transactions WHERE pidx = ?').get(pidx).status, 'initiated');
});

test('a user who cancels at Khalti leaves the attempt canceled and writes no payment', async () => {
  const start = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, {});
  const pidx = start.body.payment_url.split('pidx=')[1];
  settle(pidx, { status: 'User canceled' });
  const r = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}`);
  assert.equal(r.body.outcome, 'canceled');
  assert.equal(db.prepare('SELECT status FROM gateway_transactions WHERE pidx = ?').get(pidx).status, 'canceled');
});

test('if the lookup is unreachable nothing is recorded, and a later return can still succeed', async () => {
  const start = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, { amount_paisa: 100000 });
  const pidx = start.body.payment_url.split('pidx=')[1];
  settle(pidx, { status: 'Completed', transaction_id: 'TXN-LATER-1' });
  kh.down = true;
  const down = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}`);
  assert.equal(down.body.outcome, 'unverified');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE reference = ?').get('TXN-LATER-1').n, 0);
  kh.down = false;
  const up = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}`);
  assert.equal(up.body.outcome, 'paid');
});

test('a second attempt that reuses a provider transaction id is refused as a duplicate', async () => {
  const start = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, { amount_paisa: 1000 });
  const pidx = start.body.payment_url.split('pidx=')[1];
  settle(pidx, { status: 'Completed', transaction_id: 'TXN-LATER-1' });
  const r = await call(null, 'GET', `/api/fees/khalti/return?pidx=${pidx}`);
  assert.equal(r.body.outcome, 'duplicate_transaction');
});

test('an unknown pidx is refused and no payment is created', async () => {
  const r = await call(null, 'GET', '/api/fees/khalti/return?pidx=NOT-A-REAL-PIDX');
  assert.equal(r.body.outcome, 'unknown_payment');
});

test('online payment is refused with 503 when no Khalti key is set, and nothing is started', async () => {
  const saved = process.env.KHALTI_SECRET_KEY;
  const attemptsBefore = db.prepare('SELECT COUNT(*) AS n FROM gateway_transactions').get().n;
  delete process.env.KHALTI_SECRET_KEY;
  try {
    const r = await call('payingGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, {});
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'not_configured');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gateway_transactions').get().n, attemptsBefore);
  } finally {
    process.env.KHALTI_SECRET_KEY = saved;
  }
});

// ---------- guardian access ----------

test('a guardian who can view but not pay cannot start an online payment', async () => {
  const r = await call('viewOnlyGuardian', 'POST', `/api/guardian/fees/invoices/${invKid2}/pay-online`, {});
  assert.equal(r.status, 404);
  const view = await call('viewOnlyGuardian', 'GET', `/api/guardian/fees/invoices/${invKid2}`);
  assert.equal(view.status, 200);
});

test('a restricted guardian sees no fees for the child, even with the flags on', async () => {
  const list = await call('restrictedGuardian', 'GET', '/api/guardian/fees/invoices');
  assert.equal(list.status, 200);
  assert.equal(list.body.invoices.length, 0);
  const one = await call('restrictedGuardian', 'GET', `/api/guardian/fees/invoices/${invKid}`);
  assert.equal(one.status, 404);
});

test('a guardian cannot reach the staff fee routes (guardian allowlist)', async () => {
  const r = await call('payingGuardian', 'GET', '/api/fees/invoices');
  assert.equal(r.status, 403);
});

test('a student sees their own invoice and not anyone else\'s', async () => {
  const own = await call('kid', 'GET', `/api/fees/invoices/${invKid}`);
  assert.equal(own.status, 200);
  const other = await call('kid', 'GET', `/api/fees/invoices/${invKid2}`);
  assert.equal(other.status, 403);
  const list = await call('kid', 'GET', '/api/fees/invoices');
  assert.equal(list.status, 403);
});

// ---------- cash, bank, validation ----------

test('cash and bank payments validate amounts and require a reference for bank deposits', async () => {
  const floatAmt = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: 100.5, method: 'cash' });
  assert.equal(floatAmt.status, 400);
  const str = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: '100', method: 'cash' });
  assert.equal(str.status, 400);
  const neg = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: -100, method: 'cash' });
  assert.equal(neg.status, 400);
  const noRef = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: 100, method: 'bank' });
  assert.equal(noRef.status, 400);
  const badMethod = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: 100, method: 'khalti' });
  assert.equal(badMethod.status, 400);
  const over = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: 99999999, method: 'cash' });
  assert.equal(over.status, 409);
});

test('a cash payment writes the payment and its receipt together', async () => {
  const r = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: 100000, method: 'cash' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.receipt_no >= 1);
  const row = db.prepare('SELECT r.receipt_no FROM receipts r WHERE r.payment_id = ?').get(r.body.payment_id);
  assert.equal(row.receipt_no, r.body.receipt_no);
});

// ---------- append-only ledger ----------

test('payments cannot be updated or deleted at the database level', () => {
  const p = db.prepare('SELECT id FROM payments LIMIT 1').get();
  assert.throws(() => db.prepare('UPDATE payments SET amount_paisa = 1 WHERE id = ?').run(p.id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM payments WHERE id = ?').run(p.id), /append-only/);
});

// ---------- concessions ----------

test('a concession does nothing until a different person approves it', async () => {
  const before = (await call('admin', 'GET', `/api/fees/invoices/${invKid2}`)).body.net_paisa;
  const req = await call('requester', 'POST', '/api/fees/concessions', {
    student_id: ID.kid2, session_id: sessionId, period: 'Term 1', fee_head_id: headExm, amount_paisa: 50000, reason: 'Sibling scholarship approved by principal',
  });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  const mid = (await call('admin', 'GET', `/api/fees/invoices/${invKid2}`)).body.net_paisa;
  assert.equal(mid, before, 'a requested concession changes nothing');
  const self = await call('requester', 'POST', `/api/fees/concessions/${req.body.id}/decision`, { decision: 'approve' });
  assert.equal(self.status, 403, 'the requester cannot approve their own request');
  const approved = await call('admin', 'POST', `/api/fees/concessions/${req.body.id}/decision`, { decision: 'approve' });
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body.invoices_updated, [invKid2]);
  const after = (await call('admin', 'GET', `/api/fees/invoices/${invKid2}`)).body;
  assert.equal(after.net_paisa, before - 50000);
  assert.equal(after.concession_paisa, 50000);
});

test('the clerk cannot approve a concession even when it is someone else’s', async () => {
  const req = await call('admin', 'POST', '/api/fees/concessions', {
    student_id: ID.kid2, session_id: sessionId, period: 'Term 1', fee_head_id: headTui, amount_paisa: 1000, reason: 'Hardship case reviewed',
  });
  assert.equal(req.status, 201);
  const r = await call('clerk', 'POST', `/api/fees/concessions/${req.body.id}/decision`, { decision: 'approve' });
  assert.equal(r.status, 403);
});

test('a concession cannot push an invoice below what was already paid, and it stays unapproved', async () => {
  const req = await call('requester', 'POST', '/api/fees/concessions', {
    student_id: ID.kid2, session_id: sessionId, period: 'Term 1', fee_head_id: headTui, amount_paisa: 1500000, reason: 'Full tuition waiver requested',
  });
  assert.equal(req.status, 201);
  const r = await call('admin', 'POST', `/api/fees/concessions/${req.body.id}/decision`, { decision: 'approve' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  const row = db.prepare('SELECT status FROM concessions WHERE id = ?').get(req.body.id);
  assert.equal(row.status, 'requested', 'rolled back: still requested');
});

test('a concession must match a fee charged to the student’s class for that period', async () => {
  const r = await call('requester', 'POST', '/api/fees/concessions', {
    student_id: ID.kidAlt, session_id: sessionId, period: 'Term 1', fee_head_id: headTui, amount_paisa: 1000, reason: 'Not charged to this class',
  });
  assert.equal(r.status, 400);
});

// ---------- refunds ----------

test('a refund reverses cleanly, can be partial, is capped, and is audited', async () => {
  const pay = await call('clerk', 'POST', '/api/fees/payments', { invoice_id: invKid2, amount_paisa: 20000, method: 'bank', reference: 'SLIP-REF-9' });
  assert.equal(pay.status, 201);
  const before = (await call('admin', 'GET', `/api/fees/invoices/${invKid2}`)).body.balance_paisa;
  const clerkRefund = await call('clerk', 'POST', `/api/fees/payments/${pay.body.payment_id}/refund`, { amount_paisa: 5000, reason: 'Entered twice' });
  assert.equal(clerkRefund.status, 403, 'refund is admin only');
  const part = await call('admin', 'POST', `/api/fees/payments/${pay.body.payment_id}/refund`, { amount_paisa: 5000, reason: 'Entered twice' });
  assert.equal(part.status, 201);
  assert.equal(part.body.refundable_left_paisa, 15000);
  const mid = (await call('admin', 'GET', `/api/fees/invoices/${invKid2}`)).body.balance_paisa;
  assert.equal(mid, before + 5000, 'balance goes back up by the refund');
  const over = await call('admin', 'POST', `/api/fees/payments/${pay.body.payment_id}/refund`, { amount_paisa: 15001, reason: 'Too much' });
  assert.equal(over.status, 409);
  const rest = await call('admin', 'POST', `/api/fees/payments/${pay.body.payment_id}/refund`, { reason: 'Rest of the deposit reversed' });
  assert.equal(rest.status, 201);
  assert.equal(rest.body.refundable_left_paisa, 0);
  const none = await call('admin', 'POST', `/api/fees/payments/${pay.body.payment_id}/refund`, { reason: 'Again' });
  assert.equal(none.status, 409);
  const sum = db.prepare('SELECT SUM(amount_paisa) AS s FROM payments WHERE invoice_id = ? AND (id = ? OR refund_of_id = ?)').get(invKid2, pay.body.payment_id, pay.body.payment_id).s;
  assert.equal(sum, 0, 'the payment and its refunds net to zero');
  const audit = db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE module = 'fees' AND action = 'payment_refunded'").get().n;
  assert.ok(audit >= 2, 'each refund is audited');
});

test('a Khalti payment refund tells the admin to refund in the Khalti dashboard too', async () => {
  const p = db.prepare("SELECT id FROM payments WHERE method = 'khalti' AND kind = 'payment' LIMIT 1").get();
  const r = await call('admin', 'POST', `/api/fees/payments/${p.id}/refund`, { amount_paisa: 1000, reason: 'Test refund flag' });
  assert.equal(r.status, 201);
  assert.equal(r.body.gateway_refund_required, true);
});

// ---------- receipts ----------

test('receipt numbers have no gaps under concurrent payments', async () => {
  const inv = invKid2;
  const bal = (await call('admin', 'GET', `/api/fees/invoices/${inv}`)).body.balance_paisa;
  assert.ok(bal > 1200, 'kid2 still has a balance to take 12 small payments');
  // Several payments on one invoice, sent at once.
  const results = await Promise.all(Array.from({ length: 12 }, () => call('clerk', 'POST', '/api/fees/payments', { invoice_id: inv, amount_paisa: 100, method: 'cash' })));
  const ok = results.filter(r => r.status === 201);
  assert.equal(ok.length, 12, JSON.stringify(results.map(r => r.status)));
  const nums = db.prepare('SELECT receipt_no FROM receipts ORDER BY receipt_no').all().map(r => r.receipt_no);
  assert.deepEqual(nums, Array.from({ length: nums.length }, (_, i) => i + 1), 'receipt numbers run 1..N with no gaps or duplicates');
});

// ---------- reports ----------

test('bucket boundaries put days past due in the right aging bucket', () => {
  assert.equal(bucketFor(-1), 'not_due');
  assert.equal(bucketFor(0), '0-30');
  assert.equal(bucketFor(30), '0-30');
  assert.equal(bucketFor(31), '31-60');
  assert.equal(bucketFor(60), '31-60');
  assert.equal(bucketFor(61), '61-90');
  assert.equal(bucketFor(90), '61-90');
  assert.equal(bucketFor(91), '90+');
  assert.equal(daysBetween('2026-09-15', AS_OF), 26);
});

test('dues report ages open balances on the school date', async () => {
  const structure = await call('admin', 'PUT', '/api/fees/structures', {
    session_id: sessionId, class_level: 8, period: 'Term 0 (old)',
    items: [{ fee_head_id: headExm, amount_paisa: 20000, due_date: '2026-06-01' }],
  });
  assert.equal(structure.status, 200);
  const gen = await call('clerk', 'POST', '/api/fees/invoices/generate', { session_id: sessionId, class_level: 8, period: 'Term 0 (old)' });
  assert.equal(gen.status, 201);
  const dues = await call('clerk', 'GET', `/api/fees/reports/dues?session_id=${sessionId}&class_level=8&as_of=${AS_OF}`);
  assert.equal(dues.status, 200);
  const old = dues.body.rows.filter(r => r.period === 'Term 0 (old)');
  assert.ok(old.length >= 1);
  assert.ok(old.every(r => r.bucket === '90+'), 'due 2026-06-01 is more than 90 days before 2026-10-11');
  assert.ok(dues.body.rows.some(r => r.period === 'Term 1' && r.bucket === '0-30'), 'due 2026-09-15 is in the 0-30 bucket');
  const sumBuckets = Object.values(dues.body.buckets).reduce((s, b) => s + b.amount_paisa, 0);
  assert.equal(sumBuckets, dues.body.total_outstanding_paisa);
});

test('collection report gives a rate per class and never counts overpayment as collected', async () => {
  const r = await call('clerk', 'GET', `/api/fees/reports/collection?session_id=${sessionId}&as_of=${AS_OF}`);
  assert.equal(r.status, 200);
  const c8 = r.body.classes.find(c => c.class_level === 8);
  assert.ok(c8);
  assert.ok(c8.collection_rate_pct >= 0 && c8.collection_rate_pct <= 100);
  assert.ok(c8.collected_paisa <= c8.net_paisa);
});

// ---------- reconciliation ----------

test('reconciliation flags a settlement that disagrees with our record, and a missing settlement', async () => {
  const today = todayNepal();
  const khaltiRows = db.prepare("SELECT p.id, p.reference, p.amount_paisa FROM payments p WHERE method = 'khalti' AND kind = 'payment'").all();
  const first = khaltiRows[0];
  const wrong = await call('admin', 'POST', '/api/fees/reconcile', {
    from: today, to: today,
    settlements: [{ provider_transaction_id: first.reference, amount_paisa: first.amount_paisa + 1 }],
  });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.ok, false);
  assert.ok(wrong.body.mismatches.some(m => m.type === 'settlement_amount_mismatch'));
  assert.ok(wrong.body.mismatches.some(m => m.type === 'payment_missing_from_settlement'));
});

test('a settlement that matches our records to the paisa reconciles with no mismatches', async () => {
  const today = todayNepal();
  const rows = db.prepare("SELECT reference, amount_paisa FROM payments WHERE method = 'khalti' AND kind = 'payment'").all();
  const settlements = rows.map(r => ({ provider_transaction_id: r.reference, amount_paisa: r.amount_paisa }));
  const r = await call('admin', 'POST', '/api/fees/reconcile', { from: today, to: today, settlements });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.mismatches, [], JSON.stringify(r.body.mismatches));
  assert.equal(r.body.ok, true);
  // Khalti net for the day = payments minus the refund made earlier, to the paisa.
  const netKhalti = db.prepare("SELECT COALESCE(SUM(amount_paisa), 0) AS s FROM payments WHERE method = 'khalti'").get().s;
  assert.equal(r.body.totals.by_method.khalti, netKhalti);
});

test('a payment with no receipt is reported by reconciliation', async () => {
  // Writes straight to the table, as a bug or a tampered row would. The reconciliation must catch it.
  const inv = db.prepare('SELECT id, student_id FROM invoices LIMIT 1').get();
  db.prepare("INSERT INTO payments (invoice_id, student_id, kind, amount_paisa, method, reference) VALUES (?,?, 'payment', 500, 'cash', 'ORPHAN')").run(inv.id, inv.student_id);
  const r = reconcile({ from: todayNepal(), to: todayNepal() });
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some(m => m.type === 'payment_without_receipt'));
});
