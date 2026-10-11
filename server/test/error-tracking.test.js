// Phase 0: error tracking. Errors are stored once per fingerprint, redacted, and visible to admins only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-errors-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'errors.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-321';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { captureError, redact, listErrors } = await import('../src/services/errorLog.js');

let server, base;
const PW = 'Errors-Test-Pass-2026';

function addUser(email, role) {
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id)
    VALUES (?,?,?,?,'approved','active',?)`).run(`User ${email}`, email, bcrypt.hashSync(PW, 4), role, roleId);
}

async function sessionCookie(email) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email, password: PW }),
  });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().find(c => c.startsWith('nitex_session=')).split(';')[0];
}

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  addUser('err-admin@test.dev', 'admin');
  addUser('err-student@test.dev', 'student');
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('redact removes emails, JWTs, bearer tokens and password-like values', () => {
  const out = redact('user jane.doe@school.edu.np failed with eyJhbGciOi.eyJpZCI6MX0.sig123abc and Bearer abc.def-ghi password=Hunter2!');
  assert.doesNotMatch(out, /jane\.doe@/);
  assert.doesNotMatch(out, /eyJhbGciOi/);
  assert.doesNotMatch(out, /abc\.def-ghi/);
  assert.doesNotMatch(out, /Hunter2/);
  assert.match(out, /\[email\]/);
});

// The same bug raised from the same place must map to one row. Create both errors in one helper.
const raise = (msg) => new TypeError(msg);
test('the same error from the same place is stored once and its count grows', () => {
  const a = captureError(raise('boom for test'), { route: 'GET /api/test/a' });
  const b = captureError(raise('boom for test'), { route: 'GET /api/test/a' });
  assert.ok(a && a === b, 'same fingerprint');
  const row = db.prepare('SELECT count FROM error_events WHERE fingerprint = ?').get(a);
  assert.equal(row.count, 2);
});

test('a different route makes a separate row', () => {
  const a = captureError(new Error('same text'), { route: 'GET /api/x' });
  const b = captureError(new Error('same text'), { route: 'GET /api/y' });
  assert.notEqual(a, b);
});

test('stored rows never contain a stack trace, request body, or the user email', () => {
  captureError(Object.assign(new Error('failed for jane@school.edu.np'), { stack: 'Error: failed\n    at handler (/srv/app/src/routes/x.js:10:5)\n' }), { route: 'POST /api/x' });
  const rows = listErrors();
  const hit = rows.find(r => r.message.includes('failed for'));
  assert.ok(hit);
  assert.doesNotMatch(hit.message, /jane@/);
  assert.equal(hit.location, 'handler src/routes/x.js:10:5');
  assert.doesNotMatch(hit.location, /\/srv\//, 'absolute host path is removed');
});

test('admins can read the error log; students get 403', async () => {
  const admin = await sessionCookie('err-admin@test.dev');
  const ok = await fetch(base + '/api/ops/errors', { headers: { Cookie: admin, 'X-NITEX-Client': 'web' } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(Array.isArray(body.errors) && body.errors.length > 0);

  const student = await sessionCookie('err-student@test.dev');
  const denied = await fetch(base + '/api/ops/errors', { headers: { Cookie: student, 'X-NITEX-Client': 'web' } });
  assert.equal(denied.status, 403);

  const anon = await fetch(base + '/api/ops/errors', { headers: { 'X-NITEX-Client': 'web' } });
  assert.equal(anon.status, 401);
});

test('old errors are cleared by the retention endpoint; recent ones are kept', async () => {
  db.prepare("INSERT INTO error_events (fingerprint, message, count, last_seen) VALUES ('old-one', 'old', 1, datetime('now','-200 days'))").run();
  const admin = await sessionCookie('err-admin@test.dev');
  const r = await fetch(base + '/api/ops/errors/clear-old', { method: 'POST', headers: { Cookie: admin, 'X-NITEX-Client': 'web' } });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).removed >= 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM error_events WHERE fingerprint = 'old-one'").get().c, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM error_events').get().c > 0);
});
