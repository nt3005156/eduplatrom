// Phase 1: guardian accounts, child links, portal access, setup links, fencing and audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-guardians-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'guardians.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.PUBLIC_URL = 'https://school.example.test';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');

let server, base;
const ADMIN_PW = 'Admin-Pass-Phase1-2026';
const STUDENT_PW = 'Student-Pass-Phase1-2026';
const GUARDIAN_PW = 'Parent-Pass-Phase1-2026';
const ids = {};

async function call(method, url, { token, cookie, client = true, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  if (client) h['X-NITEX-Client'] = 'web';
  const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(email, password) {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  return { status: r.status, token: r.json?.token, user: r.json?.user, headers: r.headers, json: r.json };
}

function tokenFromSetupUrl(url) {
  return new URL(url).searchParams.get('token');
}

before(async () => {
  const roleId = key => db.prepare('SELECT id FROM roles WHERE key = ?').get(key).id;
  const mk = (name, email, pw, role, extra = {}) => Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id,
      class_level, section, roll_no, admission_no) VALUES (?,?,?,?,'approved','active',?,?,?,?,?)`)
    .run(name, email, bcrypt.hashSync(pw, 4), role, extra.role_id ?? null, extra.class_level ?? null, extra.section ?? null,
      extra.roll_no ?? null, extra.admission_no ?? null).lastInsertRowid);
  ids.admin = mk('Principal', 'principal@school.test', ADMIN_PW, 'admin', { role_id: roleId('system_admin') });
  ids.asha = mk('Asha Sharma', 'asha@school.test', STUDENT_PW, 'student', { class_level: 7, section: 'A', roll_no: '12', admission_no: 'ADM-1' });
  ids.bikash = mk('Bikash Sharma', 'bikash@school.test', STUDENT_PW, 'student', { class_level: 9, section: 'B', roll_no: '4', admission_no: 'ADM-2' });
  ids.subjectId = Number(db.prepare("INSERT INTO subjects (name, class_level) VALUES ('Science', 7)").run().lastInsertRowid);

  // Attendance for Asha (last few days) and Bikash (must stay invisible to Asha's parent).
  const today = new Date().toISOString().slice(0, 10);
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const att = db.prepare(`INSERT INTO attendance_records (student_id, class_level, section, subject_id, date, status, marked_by) VALUES (?,?,?,?,?,?,?)`);
  att.run(ids.asha, 7, 'A', null, today, 'present', ids.admin);
  att.run(ids.asha, 7, 'A', null, day(1), 'absent', ids.admin);
  att.run(ids.asha, 7, 'A', ids.subjectId, day(1), 'late', ids.admin);
  att.run(ids.bikash, 9, 'B', null, today, 'absent', ids.admin);

  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('admin creates a guardian, links a child, and gets a one-time setup link', async () => {
  const s = await login('principal@school.test', ADMIN_PW);
  assert.equal(s.status, 200);
  ids.adminToken = s.token;
  const r = await call('POST', '/api/guardians', {
    token: s.token,
    body: { name: 'Ram Sharma', email: 'Ram.Sharma@Example.com', phone: '98 1234 5678',
      student_links: [{ student_id: ids.asha, relationship: 'father', is_primary: true }] },
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.guardian.email, 'ram.sharma@example.com', 'email is stored lower-case');
  assert.equal(r.json.guardian.phone, '+9779812345678', 'Nepal mobile stored in E.164 form');
  assert.equal(r.json.links.length, 1);
  assert.match(r.json.setup_url, /^https:\/\/school\.example\.test\/setup\?token=/);
  ids.guardian = r.json.guardian.id;
  ids.setupToken = tokenFromSetupUrl(r.json.setup_url);
  // The stored password is random: no sign-in is possible until the guardian sets one.
  assert.equal((await login('ram.sharma@example.com', 'anything-at-all-123')).status, 401);
});

test('the setup link is checked, then sets the guardian password once', async () => {
  const check = await call('GET', `/api/auth/setup/${ids.setupToken}`, { client: false });
  assert.equal(check.status, 200);
  assert.equal(check.json.name, 'Ram Sharma');
  assert.equal(check.json.role, 'guardian');

  const weak = await call('POST', '/api/auth/setup', { client: false, body: { token: ids.setupToken, password: 'short-1' } });
  assert.equal(weak.status, 400, 'short password refused');
  assert.equal((await call('GET', `/api/auth/setup/${ids.setupToken}`, { client: false })).status, 200, 'a refused password does not spend the link');

  const ok = await call('POST', '/api/auth/setup', { client: false, body: { token: ids.setupToken, password: GUARDIAN_PW } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await call('GET', `/api/auth/setup/${ids.setupToken}`, { client: false })).status, 404, 'link cannot be used twice');
  assert.equal((await call('POST', '/api/auth/setup', { client: false, body: { token: ids.setupToken, password: 'Another-Good-Pass-2026' } })).status, 404);
});

test('guardian signs in on the web (cookie, no file cookie) and lands on the portal', async () => {
  const s = await login('ram.sharma@example.com', GUARDIAN_PW);
  assert.equal(s.status, 200);
  assert.equal(s.user.role, 'guardian');
  const cookies = s.headers.getSetCookie();
  assert.ok(cookies.some(c => c.startsWith('nitex_session=') && /HttpOnly/.test(c)));
  assert.ok(!cookies.some(c => c.startsWith('nitex_file=')), 'guardians get no file cookie');
  ids.gToken = s.token;
});

test('guardian sees only linked children, with their attendance', async () => {
  const list = await call('GET', '/api/guardian/children', { token: ids.gToken });
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.children.map(c => c.student_id), [ids.asha]);
  assert.equal(list.json.children[0].relationship, 'father');

  const att = await call('GET', `/api/guardian/children/${ids.asha}/attendance`, { token: ids.gToken });
  assert.equal(att.status, 200, att.text);
  assert.equal(att.json.daily.total, 2);
  assert.equal(att.json.daily.present, 1);
  assert.equal(att.json.daily.absent, 1);
  assert.equal(att.json.subjects[0].subject_name, 'Science');
});

test('guardian gets 403 for a child who is not linked, with no data in the body', async () => {
  for (const url of [`/api/guardian/children/${ids.bikash}`, `/api/guardian/children/${ids.bikash}/attendance`]) {
    const r = await call('GET', url, { token: ids.gToken });
    assert.equal(r.status, 403, url);
    assert.ok(!/Bikash|Sharma"|absent/.test(r.text), 'no child data leaks in the refusal');
  }
});

test('guardian is fenced out of every route outside the portal (allowlist)', async () => {
  const blocked = [
    ['GET', '/api/users/pending'],
    ['GET', '/api/attendance/summary?class_level=7'],
    ['GET', '/api/attendance/roster?class_level=7&section=A'],
    ['GET', '/api/attendance/me'],
    ['GET', '/api/dashboard/admin'],
    ['GET', '/api/dashboard/student'],
    ['GET', '/api/announcements'],
    ['GET', `/api/assignments/1`],
    ['GET', `/api/quizzes/1`],
    ['GET', '/api/audit'],
    ['GET', `/api/privacy/users/${ids.asha}/export`],
    ['GET', '/api/students/whatever'],
  ];
  for (const [method, url] of blocked) {
    const r = await call(method, url, { token: ids.gToken });
    assert.ok([401, 403, 404].includes(r.status) && r.status !== 200, `${method} ${url} returned ${r.status}`);
    assert.notEqual(r.status, 500, `${method} ${url} crashed`);
  }
  const outside = await call('GET', '/api/announcements', { token: ids.gToken });
  assert.equal(outside.status, 403);
  assert.match(outside.json.error, /guardian portal/);
});

test('guardian cannot write anything outside the portal, and cannot read school files', async () => {
  const w1 = await call('POST', '/api/attendance', { token: ids.gToken, body: { class_level: 7, section: 'A', date: new Date().toISOString().slice(0, 10), records: [] } });
  assert.equal(w1.status, 403);
  const w2 = await call('POST', '/api/announcements', { token: ids.gToken, body: { title: 'x', body: 'y' } });
  assert.equal(w2.status, 403);
  const f = await call('GET', '/uploads/anything.pdf', { token: ids.gToken });
  assert.equal(f.status, 403, 'file access denied to guardians');
  const admin = await call('GET', '/api/guardians', { token: ids.gToken });
  assert.equal(admin.status, 403, 'guardians cannot list guardians');
});

test('guardian portal announcements come from linked classes only', async () => {
  db.prepare("INSERT INTO announcements (class_level, title, body, created_by) VALUES (7, 'Class 7 trip', 'Friday', ?)").run(ids.admin);
  db.prepare("INSERT INTO announcements (class_level, title, body, created_by) VALUES (9, 'Class 9 exam', 'Monday', ?)").run(ids.admin);
  db.prepare("INSERT INTO announcements (class_level, title, body, created_by) VALUES (NULL, 'School closed', 'Holiday', ?)").run(ids.admin);
  const r = await call('GET', '/api/guardian/announcements', { token: ids.gToken });
  assert.equal(r.status, 200);
  const titles = r.json.announcements.map(a => a.title).sort();
  assert.deepEqual(titles, ['Class 7 trip', 'School closed']);
});

test('admin can change access flags, and a restriction hides the child at once', async () => {
  const r = await call('PATCH', `/api/guardians/${ids.guardian}/students/${ids.asha}`, { token: ids.adminToken, body: { restricted: true } });
  assert.equal(r.status, 200, r.text);
  const list = await call('GET', '/api/guardian/children', { token: ids.gToken });
  assert.deepEqual(list.json.children, [], 'restricted child is hidden from the list');
  const one = await call('GET', `/api/guardian/children/${ids.asha}/attendance`, { token: ids.gToken });
  assert.equal(one.status, 403, 'restricted child is refused on the next request');
  await call('PATCH', `/api/guardians/${ids.guardian}/students/${ids.asha}`, { token: ids.adminToken, body: { restricted: false } });
  assert.equal((await call('GET', `/api/guardian/children/${ids.asha}/attendance`, { token: ids.gToken })).status, 200);
});

test('turning off attendance for a child removes it from the portal reads', async () => {
  await call('PATCH', `/api/guardians/${ids.guardian}/students/${ids.asha}`, { token: ids.adminToken, body: { can_view_attendance: false } });
  const att = await call('GET', `/api/guardian/children/${ids.asha}/attendance`, { token: ids.gToken });
  assert.equal(att.status, 403);
  await call('PATCH', `/api/guardians/${ids.guardian}/students/${ids.asha}`, { token: ids.adminToken, body: { can_view_attendance: true } });
});

test('unlinking takes effect on the next request', async () => {
  const before = await call('GET', `/api/guardian/children/${ids.asha}`, { token: ids.gToken });
  assert.equal(before.status, 200);
  const r = await call('DELETE', `/api/guardians/${ids.guardian}/students/${ids.asha}`, { token: ids.adminToken });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.links, []);
  const after = await call('GET', `/api/guardian/children/${ids.asha}`, { token: ids.gToken });
  assert.equal(after.status, 403, 'access ends with the link');
  // Relink so later tests have a linked child again.
  await call('POST', `/api/guardians/${ids.guardian}/students`, { token: ids.adminToken, body: { student_id: ids.asha, relationship: 'father' } });
});

test('admin-only write rules: a student cannot manage guardians', async () => {
  const s = await login('asha@school.test', STUDENT_PW);
  const r = await call('POST', '/api/guardians', { token: s.token, body: { name: 'Nope', email: 'nope@x.test', student_links: [] } });
  assert.equal(r.status, 403);
  const list = await call('GET', '/api/guardians', { token: s.token });
  assert.equal(list.status, 403);
});

test('validation: bad email, phone, relationship and duplicate email are refused', async () => {
  const base = { name: 'Test Parent' };
  assert.equal((await call('POST', '/api/guardians', { token: ids.adminToken, body: { ...base, email: 'not-an-email' } })).status, 400);
  assert.equal((await call('POST', '/api/guardians', { token: ids.adminToken, body: { ...base, email: 'ok@x.test', phone: '12345' } })).status, 400);
  const bad = await call('POST', '/api/guardians', { token: ids.adminToken, body: { ...base, email: 'ok2@x.test', student_links: [{ student_id: ids.asha, relationship: 'uncle' }] } });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/guardians', { token: ids.adminToken, body: { ...base, email: 'ram.sharma@example.com' } })).status, 409);
  assert.equal((await call('POST', '/api/guardians', { token: ids.adminToken, body: { ...base, email: 'ok3@x.test', student_links: [{ student_id: 999999 }] } })).status, 404);
});

test('a new setup link voids the previous one', async () => {
  const first = await call('POST', `/api/guardians/${ids.guardian}/setup-link`, { token: ids.adminToken });
  const second = await call('POST', `/api/guardians/${ids.guardian}/setup-link`, { token: ids.adminToken });
  assert.equal(first.status, 200);
  assert.equal((await call('GET', `/api/auth/setup/${tokenFromSetupUrl(first.json.setup_url)}`, { client: false })).status, 404);
  assert.equal((await call('GET', `/api/auth/setup/${tokenFromSetupUrl(second.json.setup_url)}`, { client: false })).status, 200);
});

test('an expired setup link is refused', async () => {
  const r = await call('POST', `/api/guardians/${ids.guardian}/setup-link`, { token: ids.adminToken });
  const t = tokenFromSetupUrl(r.json.setup_url);
  db.prepare("UPDATE account_setup_tokens SET expires_at = datetime('now', '-1 day') WHERE used_at IS NULL AND user_id = ?").run(ids.guardian);
  const check = await call('GET', `/api/auth/setup/${t}`, { client: false });
  assert.equal(check.status, 404);
  assert.match(check.json.error, /expired/);
});

test('every link change is audited, and no setup token is written to the log', async () => {
  const rows = db.prepare("SELECT action, description, new_value, previous_value FROM audit_logs WHERE module = 'guardians'").all();
  const actions = new Set(rows.map(r => r.action));
  for (const a of ['created', 'updated', 'unlinked', 'linked']) assert.ok(actions.has(a), `missing audit action ${a}`);
  const everything = JSON.stringify(db.prepare('SELECT * FROM audit_logs').all());
  assert.ok(!everything.includes('setup_url'), 'setup URL must not be logged');
  assert.ok(!everything.includes(ids.setupToken), 'raw token must not be logged');
});

test('raw setup tokens are never stored; only hashes are', () => {
  const rows = db.prepare('SELECT token_hash FROM account_setup_tokens').all();
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.equal(r.token_hash.length, 64, 'SHA-256 hex');
  assert.ok(!rows.some(r => r.token_hash === ids.setupToken));
});

test('privacy: export shows guardian links both ways; erasure removes them', async () => {
  const exp = await call('GET', `/api/privacy/users/${ids.guardian}/export`, { token: ids.adminToken });
  assert.equal(exp.status, 200);
  assert.ok(exp.json.guardian_links.some(l => l.direction === 'child' && l.person === 'Asha Sharma'));
  const stuExp = await call('GET', `/api/privacy/users/${ids.asha}/export`, { token: ids.adminToken });
  assert.ok(stuExp.json.guardian_links.some(l => l.direction === 'guardian' && l.person === 'Ram Sharma'));

  const anon = await call('POST', `/api/privacy/users/${ids.guardian}/anonymize`, { token: ids.adminToken, body: { confirm: 'ANONYMIZE' } });
  assert.equal(anon.status, 200, anon.text);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM guardian_students WHERE guardian_id = ? OR student_id = ?').get(ids.guardian, ids.guardian).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM account_setup_tokens WHERE user_id = ?').get(ids.guardian).c, 0);
  assert.equal((await login('ram.sharma@example.com', GUARDIAN_PW)).status, 401, 'anonymized guardian cannot sign in');
  assert.ok(db.prepare('SELECT id FROM users WHERE id = ?').get(ids.asha), 'the child record is untouched');
});

test('a student profile edit is validated, audited and changes only the named fields', async () => {
  const ok = await call('PATCH', `/api/users/${ids.asha}/profile`, { token: ids.adminToken,
    body: { blood_group: 'o+', dob_ad: '2014-03-02', dob_bs: '2070-11-17', phone: '9801234567', admission_no: 'ADM-1' } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json.changed.sort(), ['blood_group', 'dob_ad', 'dob_bs', 'phone'].sort());
  assert.equal(ok.json.student.blood_group, 'O+');
  assert.equal(ok.json.student.phone, '+9779801234567');
  assert.equal(ok.json.student.class_level, 7, 'unlisted fields are untouched');
  assert.equal((await call('PATCH', `/api/users/${ids.asha}/profile`, { token: ids.adminToken, body: { blood_group: 'Z+' } })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${ids.asha}/profile`, { token: ids.adminToken, body: { dob_ad: '2099-01-01' } })).status, 400);
  assert.equal((await call('PATCH', `/api/users/${ids.bikash}/profile`, { token: ids.adminToken, body: { admission_no: 'ADM-1' } })).status, 409);
  const audited = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE description LIKE 'Updated profile of Asha%'").get().c;
  assert.equal(audited, 1, 'one audit entry for the successful edit only');
});
