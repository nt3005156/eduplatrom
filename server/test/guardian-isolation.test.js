// Phase 1 isolation: one family must never see another family's child, archived
// children stay hidden, a guardian holds no staff scope, and guardian access is
// fail-closed even when the data is wrong. Runs against the real HTTP app with its own database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-isolation-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'isolation.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-456';
process.env.PUBLIC_URL = 'https://school.example.test';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { resolveScope, UNRESTRICTED_ROLE_KEYS, scopeWhereClause, isWithinScope } = await import('../src/services/scope.js');

const PW = 'Family-Pass-Isolation-2026';
const ids = {};
const tok = {};
let server, base;

async function call(method, url, { token, body } = {}) {
  const h = { 'X-NITEX-Client': 'web' };
  if (body) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

before(async () => {
  const roleId = key => db.prepare('SELECT id FROM roles WHERE key = ?').get(key).id;
  const mk = (name, email, role, extra = {}) => Number(db.prepare(`INSERT INTO users
      (name, email, password_hash, role, approval_status, account_status, role_id, class_level, section, roll_no, admission_no)
      VALUES (?,?,?,?,'approved',?,?,?,?,?,?)`)
    .run(name, email, bcrypt.hashSync(PW, 4), role, extra.account_status || 'active', extra.role_id ?? null,
      extra.class_level ?? null, extra.section ?? null, extra.roll_no ?? null, extra.admission_no ?? null).lastInsertRowid);

  const guardianRole = roleId('guardian');
  ids.admin = mk('Principal', 'principal@iso.test', 'admin', { role_id: roleId('system_admin') });
  ids.asha = mk('Asha Sharma', 'asha@iso.test', 'student', { class_level: 7, section: 'A', roll_no: '12', admission_no: 'ISO-1' });
  ids.bikash = mk('Bikash Gurung', 'bikash@iso.test', 'student', { class_level: 9, section: 'B', roll_no: '4', admission_no: 'ISO-2' });
  ids.chandra = mk('Chandra Tamang', 'chandra@iso.test', 'student', { class_level: 8, section: 'C', roll_no: '2', admission_no: 'ISO-3', account_status: 'archived' });
  ids.famA = mk('Family A', 'a@family.test', 'guardian', { role_id: guardianRole });
  ids.famB = mk('Family B', 'b@family.test', 'guardian', { role_id: guardianRole });
  ids.famC = mk('Family C', 'c@family.test', 'guardian', { role_id: guardianRole });
  ids.legacyGuardian = mk('Legacy Guardian', 'legacy@family.test', 'guardian', {});
  ids.subject = Number(db.prepare("INSERT INTO subjects (name, class_level) VALUES ('Maths', 7)").run().lastInsertRowid);

  const link = db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, relationship, can_view_attendance, created_by)
    VALUES (?,?,?,?,?)`);
  link.run(ids.famA, ids.asha, 'father', 1, ids.admin);
  link.run(ids.famA, ids.chandra, 'father', 1, ids.admin);      // linked, but the child is archived
  link.run(ids.famB, ids.bikash, 'mother', 0, ids.admin);       // attendance switched off
  link.run(ids.famB, ids.asha, 'mother', 1, ids.admin);         // shared child: Asha has two parents linked

  const att = db.prepare(`INSERT INTO attendance_records (student_id, class_level, section, subject_id, date, status, marked_by)
    VALUES (?,?,?,?,?,?,?)`);
  const today = new Date().toISOString().slice(0, 10);
  att.run(ids.asha, 7, 'A', null, today, 'present', ids.admin);
  att.run(ids.bikash, 9, 'B', null, today, 'absent', ids.admin);
  att.run(ids.chandra, 8, 'C', null, today, 'absent', ids.admin);

  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const [key, email] of [['famA', 'a@family.test'], ['famB', 'b@family.test'], ['famC', 'c@family.test'], ['legacyGuardian', 'legacy@family.test']]) {
    const r = await call('POST', '/api/auth/login', { body: { email, password: PW } });
    assert.equal(r.status, 200, `${email} signs in: ${r.text}`);
    tok[key] = r.json.token;
  }

});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a family sees only its own children, never another family\'s', async () => {
  const a = await call('GET', '/api/guardian/children', { token: tok.famA });
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.children.map(c => c.name), ['Asha Sharma'], 'the archived child is hidden too');

  const b = await call('GET', '/api/guardian/children', { token: tok.famB });
  assert.deepEqual(b.json.children.map(c => c.name).sort(), ['Asha Sharma', 'Bikash Gurung'].sort());

  const c = await call('GET', '/api/guardian/children', { token: tok.famC });
  assert.deepEqual(c.json.children, [], 'a family with no links sees an empty list, not an error');
});

test('a guardian cannot open another family\'s child, and the body reveals nothing', async () => {
  const r = await call('GET', `/api/guardian/children/${ids.bikash}`, { token: tok.famA });
  assert.equal(r.status, 403);
  assert.ok(!r.text.includes('Bikash'), 'no name or data in the refusal');

  const att = await call('GET', `/api/guardian/children/${ids.bikash}/attendance`, { token: tok.famA });
  assert.equal(att.status, 403);
  assert.ok(!att.text.includes('absent'));
});

test('an archived child is refused even when the link row still exists', async () => {
  const detail = await call('GET', `/api/guardian/children/${ids.chandra}`, { token: tok.famA });
  assert.equal(detail.status, 403);
  const att = await call('GET', `/api/guardian/children/${ids.chandra}/attendance`, { token: tok.famA });
  assert.equal(att.status, 403);
});

test('switched-off attendance: the child is listed, but attendance is refused and not summarised', async () => {
  const list = await call('GET', '/api/guardian/children', { token: tok.famB });
  const bik = list.json.children.find(c => c.name === 'Bikash Gurung');
  assert.equal(bik.can_view_attendance, false);
  assert.equal(bik.attendance_last_30_days, null);
  const r = await call('GET', `/api/guardian/children/${ids.bikash}/attendance`, { token: tok.famB });
  assert.equal(r.status, 403);
});

test('a shared child shows the same records to each linked parent, and unlinking one does not cut the other', async () => {
  const ra = await call('GET', `/api/guardian/children/${ids.asha}/attendance`, { token: tok.famA });
  const rb = await call('GET', `/api/guardian/children/${ids.asha}/attendance`, { token: tok.famB });
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  assert.deepEqual(ra.json.daily, rb.json.daily);

  db.prepare('DELETE FROM guardian_students WHERE guardian_id = ? AND student_id = ?').run(ids.famB, ids.asha);
  const after1 = await call('GET', `/api/guardian/children/${ids.asha}`, { token: tok.famB });
  assert.equal(after1.status, 403, 'family B lost Asha on the next request');
  const still = await call('GET', `/api/guardian/children/${ids.asha}`, { token: tok.famA });
  assert.equal(still.status, 200, 'family A keeps Asha');
});

test('a guardian is refused on every staff-only read (no whole-school data)', async () => {
  for (const url of ['/api/users/pending', '/api/attendance/roster?class_level=7&section=A', '/api/attendance/summary?class_level=7', '/api/assignments', '/api/dashboard/admin', '/api/dashboard/admin/details/materials', '/api/audit', '/api/guardians']) {
    const r = await call('GET', url, { token: tok.famA });
    assert.equal(r.status, 403, `${url} returned ${r.status}`);
  }
});

test('a guardian is never unrestricted in the staff scope model', () => {
  assert.equal(UNRESTRICTED_ROLE_KEYS.has('guardian'), false, 'guardian is not in UNRESTRICTED_ROLE_KEYS');
  const scope = resolveScope({ id: ids.famA });
  assert.equal(scope.unrestricted, false);
  assert.deepEqual(scope.subjectAssignments, []);
  assert.deepEqual(scope.classSections, []);
  assert.equal(isWithinScope(scope, { classLevel: 7, section: 'A', subjectId: ids.subject }), false);
  assert.equal(scopeWhereClause(scope, { classLevel: 'c', section: 's', subjectId: 'j' }).sql, '1=0');
});

test('a guardian with a legacy role value and no role row still gets no staff scope', () => {
  const scope = resolveScope({ id: ids.legacyGuardian, role: 'guardian' });
  assert.equal(scope.unrestricted, false);
  assert.deepEqual(scope.classSections, []);
  assert.deepEqual(scope.subjectAssignments, []);
});

test('bad data cannot grant a guardian staff access: a stray teacher assignment is ignored', () => {
  db.prepare(`INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id, is_class_teacher)
              VALUES (?,?,?,?,1)`).run(ids.famC, 7, 'A', ids.subject);
  const scope = resolveScope({ id: ids.famC });
  assert.equal(scope.unrestricted, false);
  assert.deepEqual(scope.classSections, [], 'guardian scope is empty even with a teacher row');
  assert.deepEqual(scope.subjectAssignments, []);
});
