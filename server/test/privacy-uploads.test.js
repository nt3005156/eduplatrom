// Authenticated file access, public branding folder, account status enforcement,
// data export, and erasure (anonymization).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(here, '../src/uploads');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-priv-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'priv.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const bcrypt = (await import('bcryptjs')).default;

let server, base;
const tokens = {};
const created = [];
const PRIVATE = 'private-test-file.txt';
const PUBLIC_DIR = path.join(UPLOADS, 'public');
const LEGACY = 'brand-legacy-test.txt';

async function api(method, url, { token, body, cookie } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json, headers: res.headers };
}

before(async () => {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, PRIVATE), 'student essay');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'logo-test.txt'), 'public logo');
  fs.writeFileSync(path.join(UPLOADS, LEGACY), 'old logo');
  created.push(path.join(UPLOADS, PRIVATE), path.join(PUBLIC_DIR, 'logo-test.txt'), path.join(UPLOADS, LEGACY));

  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const [key, email, pw] of [['admin', 'admin@nitex.com', 'Admin@123'], ['teacher', 'teacher@nitex.com', 'Teacher@123'], ['student', 'student@nitex.com', 'Student@123']]) {
    const r = await api('POST', '/api/auth/login', { body: { email, password: pw } });
    assert.equal(r.status, 200);
    tokens[key] = r.json.token;
    if (key === 'student') tokens.studentCookie = r.headers.getSetCookie().find(c => c.startsWith('nitex_file=')) || '';
  }
  // A second student to exercise export/erasure without touching the demo student.
  const info = db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, approval_status, account_status)
    VALUES ('Erase Me', 'erase@test.com', ?, 'student', 9, 'A', 'approved', 'active')`).run(bcrypt.hashSync('Pass@12345', 4));
  tokens.eraseId = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO notifications (user_id, type, title) VALUES (?, 'general', 'hello')`).run(tokens.eraseId);
  const r = await api('POST', '/api/auth/login', { body: { email: 'erase@test.com', password: 'Pass@12345' } });
  tokens.erase = r.json.token;
});

after(() => {
  server?.close();
  try { db.close(); } catch {}
  for (const f of created) { try { fs.unlinkSync(f); } catch {} }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('private uploads are refused without sign-in', async () => {
  const r = await api('GET', `/uploads/${PRIVATE}`);
  assert.equal(r.status, 401);
  assert.ok(!r.text.includes('student essay'));
});

test('a signed-in user can open a private upload (Bearer header)', async () => {
  const r = await api('GET', `/uploads/${PRIVATE}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.equal(r.text, 'student essay');
});

test('login sets an HttpOnly cookie scoped to /uploads, so plain browser links work', async () => {
  assert.match(tokens.studentCookie, /^nitex_file=.+; Path=\/uploads; HttpOnly; SameSite=Lax/);
  const cookie = tokens.studentCookie.split(';')[0];
  const r = await api('GET', `/uploads/${PRIVATE}`, { cookie });
  assert.equal(r.status, 200);
});

test('public branding folder and legacy logos stay reachable without sign-in', async () => {
  assert.equal((await api('GET', '/uploads/public/logo-test.txt')).status, 200);
  assert.equal((await api('GET', `/uploads/${LEGACY}`)).status, 200);
});

test('path traversal cannot escape the uploads folder', async () => {
  const anon = await api('GET', '/uploads/..%2F..%2Fdb%2Findex.js');
  assert.notEqual(anon.status, 200);
  const authed = await api('GET', '/uploads/..%2F..%2Fdb%2Findex.js', { token: tokens.admin });
  assert.notEqual(authed.status, 200);
  assert.ok(!authed.text.includes('import Database'));
});

test('a disabled or archived account loses access immediately, even with a valid token', async () => {
  const teacherId = db.prepare("SELECT id FROM users WHERE email = 'teacher@nitex.com'").get().id;
  assert.equal((await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.teacher })).status, 200);
  db.prepare("UPDATE users SET account_status = 'disabled' WHERE id = ?").run(teacherId);
  try {
    const r = await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.teacher });
    assert.equal(r.status, 401);
    assert.match(r.json.error, /not active/);
  } finally {
    db.prepare("UPDATE users SET account_status = 'active' WHERE id = ?").run(teacherId);
  }
});

test('students export only their own data; admins can export anyone', async () => {
  const own = await api('GET', '/api/privacy/me/export', { token: tokens.student });
  assert.equal(own.status, 200);
  assert.equal(own.json.profile.email, 'student@nitex.com');
  assert.ok(!JSON.stringify(own.json).includes('password_hash'), 'export must never include password hashes');

  const other = await api('GET', `/api/privacy/users/${tokens.eraseId}/export`, { token: tokens.student });
  assert.equal(other.status, 403);

  const adminView = await api('GET', `/api/privacy/users/${tokens.eraseId}/export`, { token: tokens.admin });
  assert.equal(adminView.status, 200);
  assert.equal(adminView.json.profile.id, tokens.eraseId);
  assert.ok(Array.isArray(adminView.json.attendance));
});

test('erasure requires confirmation, removes identity and notifications, and locks the account', async () => {
  const noConfirm = await api('POST', `/api/privacy/users/${tokens.eraseId}/anonymize`, { token: tokens.admin, body: {} });
  assert.equal(noConfirm.status, 400);

  const selfErase = await api('POST', `/api/privacy/users/${(await api('GET', '/api/auth/me', { token: tokens.admin })).json.user.id}/anonymize`, { token: tokens.admin, body: { confirm: 'ANONYMIZE' } });
  assert.equal(selfErase.status, 400);

  const ok = await api('POST', `/api/privacy/users/${tokens.eraseId}/anonymize`, { token: tokens.admin, body: { confirm: 'ANONYMIZE' } });
  assert.equal(ok.status, 200, ok.text);

  const row = db.prepare('SELECT name, email, account_status FROM users WHERE id = ?').get(tokens.eraseId);
  assert.equal(row.email, `anonymized-${tokens.eraseId}@deleted.invalid`);
  assert.ok(!row.name.includes('Erase'));
  assert.equal(row.account_status, 'archived');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(tokens.eraseId).c, 0);

  const after = await api('GET', '/api/privacy/me/export', { token: tokens.erase });
  assert.equal(after.status, 401, 'the erased person must not keep access with their old token');
});

test('every privacy action is written to the audit log', async () => {
  const n = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE module = 'privacy'").get().c;
  assert.ok(n >= 3, `expected privacy audit entries, found ${n}`);
});
