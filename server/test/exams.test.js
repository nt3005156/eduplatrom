// Phase 4 exams over HTTP: subject-teacher marks scope, publish and unpublish, guardian visibility
// (published marks only, link flags, restricted links), custom scales, and audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-exams-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'exams.db');
process.env.UPLOADS_DIR = path.join(tmpDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-exams';
fs.mkdirSync(process.env.UPLOADS_DIR, { recursive: true });
process.env.KHALTI_SECRET_KEY = 'test-not-a-real-key';
process.env.PUBLIC_BASE_URL = 'https://school.example.test';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');

const PW = 'Exam-Test-Pass-2026';
const ID = {};
const T = {};
let server;
let base;
let sessionId;
let mathId;
let sciId;
let math8Id;
let seeScaleId;
let customScaleId;
let termId;
let examB; // Math, class 7 section B, SEE split
let examAll; // Math, class 7 all sections (for the section-scope test)
let examSci; // Science, class 7 section B, custom scale (for the draft-hidden test)

function addUser(key, { role, class_level = null, section = null, roleKey = null, roll_no = null, account_status = 'active' }) {
  const roleId = roleKey ? db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey).id : null;
  ID[key] = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, roll_no, approval_status, account_status, role_id)
    VALUES (?,?,?,?,?,?,?, 'approved', ?, ?)`)
    .run(key, `${key.toLowerCase()}@exams.test`, bcrypt.hashSync(PW, 4), role, class_level, section, roll_no, account_status, roleId).lastInsertRowid);
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

const splitMarks = (theory, internal) => ({ theory, internal });

before(async () => {
  addUser('admin', { role: 'admin', roleKey: 'system_admin' });
  addUser('coord', { role: 'teacher', roleKey: 'exam_coordinator' });
  addUser('mathT', { role: 'teacher', roleKey: 'subject_teacher' });
  addUser('sciT', { role: 'teacher', roleKey: 'subject_teacher' });
  addUser('s1', { role: 'student', class_level: 7, section: 'B', roll_no: 1 });
  addUser('s2', { role: 'student', class_level: 7, section: 'B', roll_no: 2 });
  addUser('s3', { role: 'student', class_level: 7, section: 'B', roll_no: 3 });
  addUser('s4', { role: 'student', class_level: 7, section: 'A', roll_no: 1 });
  addUser('g1', { role: 'guardian', roleKey: 'guardian' }); // linked to s1 (results visible by default)
  addUser('g2', { role: 'guardian', roleKey: 'guardian' }); // linked to s2, results turned off by admin in a test
  addUser('g3', { role: 'guardian', roleKey: 'guardian' }); // linked to s3 but restricted
  addUser('g4', { role: 'guardian', roleKey: 'guardian' }); // linked to s4 (other section)

  sessionId = Number(db.prepare("INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES ('2026-2027','2026-04-01','2027-03-31',1)").run().lastInsertRowid);
  mathId = Number(db.prepare("INSERT INTO subjects (class_level, name) VALUES (7, 'Mathematics')").run().lastInsertRowid);
  sciId = Number(db.prepare("INSERT INTO subjects (class_level, name) VALUES (7, 'Science')").run().lastInsertRowid);
  math8Id = Number(db.prepare("INSERT INTO subjects (class_level, name) VALUES (8, 'Mathematics')").run().lastInsertRowid);
  db.prepare("INSERT OR IGNORE INTO sections (class_level, name) VALUES (7, 'A'), (7, 'B')").run(); // seeded already; idempotent

  const asg = db.prepare('INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id, is_class_teacher) VALUES (?,?,?,?,0)');
  asg.run(ID.mathT, 7, 'B', mathId);   // Maths teacher: class 7 section B only
  asg.run(ID.sciT, 7, 'B', sciId);     // Science teacher: class 7 section B only

  db.prepare('INSERT INTO guardian_students (guardian_id, student_id, relationship, is_primary, can_view_attendance, can_view_fees, restricted) VALUES (?,?,?,?,1,0,0)')
    .run(ID.g1, ID.s1, 'father', 1);
  db.prepare('INSERT INTO guardian_students (guardian_id, student_id, relationship, is_primary, can_view_attendance, can_view_fees, restricted) VALUES (?,?,?,?,1,0,0)')
    .run(ID.g2, ID.s2, 'mother', 1);
  db.prepare('INSERT INTO guardian_students (guardian_id, student_id, relationship, is_primary, can_view_attendance, can_view_fees, restricted) VALUES (?,?,?,?,1,0,1)')
    .run(ID.g3, ID.s3, 'father', 1);
  db.prepare('INSERT INTO guardian_students (guardian_id, student_id, relationship, is_primary, can_view_attendance, can_view_fees, restricted) VALUES (?,?,?,?,1,0,0)')
    .run(ID.g4, ID.s4, 'father', 1);

  seeScaleId = db.prepare("SELECT id FROM grading_scales WHERE name = 'SEE letter grades (NEB, 4.0 scale)'").get().id;

  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of Object.keys(ID)) await login(k);
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- setup through the API ----------

test('only exam_coordinator (and admin) may create terms and exams', async () => {
  const denied = await call('mathT', 'POST', '/api/exams/terms', { session_id: sessionId, name: 'First Terminal' });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /exams\.manage/);

  const term = await call('coord', 'POST', '/api/exams/terms', { session_id: sessionId, name: 'First Terminal' });
  assert.equal(term.status, 201, JSON.stringify(term.body));
  termId = term.body.term.id;
  const dup = await call('coord', 'POST', '/api/exams/terms', { session_id: sessionId, name: 'First Terminal' });
  assert.equal(dup.status, 409);
});

test('exam creation validates subject-class match, split config, section, and duplicates', async () => {
  const base_ = { term_id: termId, class_level: 7, section: 'B', subject_id: mathId, exam_date: '2026-11-10', full_marks: 100, theory_full: 75, internal_full: 25, grading_scale_id: seeScaleId };
  const wrongClass = await call('coord', 'POST', '/api/exams', { ...base_, subject_id: math8Id });
  assert.equal(wrongClass.status, 400);
  assert.match(wrongClass.body.error, /not taught in this class/);

  const badSplit = await call('coord', 'POST', '/api/exams', { ...base_, theory_full: 70 });
  assert.equal(badSplit.status, 400);

  const badSection = await call('coord', 'POST', '/api/exams', { ...base_, section: 'Z' });
  assert.equal(badSection.status, 400);

  const badDate = await call('coord', 'POST', '/api/exams', { ...base_, exam_date: '10/11/2026' });
  assert.equal(badDate.status, 400);

  const ok = await call('coord', 'POST', '/api/exams', base_);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  examB = ok.body.exam.id;
  const dup = await call('coord', 'POST', '/api/exams', base_);
  assert.equal(dup.status, 409);

  const all = await call('coord', 'POST', '/api/exams', { ...base_, section: null, theory_full: null, internal_full: null, full_marks: 100 });
  assert.equal(all.status, 201, JSON.stringify(all.body));
  examAll = all.body.exam.id;
});

test('a custom scale must cover 0 to 100 and is then usable by an exam', async () => {
  const denied = await call('mathT', 'POST', '/api/exams/grading-scales', { name: 'Test scale', bands: [{ min_percent: 0, grade: 'F', grade_point: 0, is_pass: 0 }] });
  assert.equal(denied.status, 403);

  const noZero = await call('coord', 'POST', '/api/exams/grading-scales', { name: 'Bad scale', bands: [{ min_percent: 50, grade: 'P', grade_point: 1, is_pass: 1 }] });
  assert.equal(noZero.status, 400);
  assert.match(noZero.body.error, /band starting at 0/);

  const created = await call('coord', 'POST', '/api/exams/grading-scales', {
    name: 'School scale (test)',
    bands: [
      { min_percent: 0, grade: 'F', grade_point: 0, is_pass: 0 },
      { min_percent: 60, grade: 'C', grade_point: 2, is_pass: 1 },
      { min_percent: 80, grade: 'A', grade_point: 4, is_pass: 1 },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  customScaleId = created.body.scale.id;
  assert.deepEqual(created.body.scale.bands.map(b => b.grade), ['A', 'C', 'F']);

  const scales = await call('mathT', 'GET', '/api/exams/grading-scales');
  assert.equal(scales.status, 200);
  const see = scales.body.scales.find(s => s.id === seeScaleId);
  assert.equal(see.bands.length, 8, 'SEE is seeded with 8 bands');

  const sci = await call('coord', 'POST', '/api/exams', {
    term_id: termId, class_level: 7, section: 'B', subject_id: sciId, full_marks: 100, grading_scale_id: customScaleId,
  });
  assert.equal(sci.status, 201, JSON.stringify(sci.body));
  examSci = sci.body.exam.id;
});

// ---------- marks: scope and grading ----------

test('subject teacher enters SEE marks for their own class, section and subject', async () => {
  const r = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [
    { student_id: ID.s1, ...splitMarks(60, 20) },   // 80 -> A
    { student_id: ID.s2, ...splitMarks(30, 8) },    // 38 -> D
    { student_id: ID.s3, absent: true },            // absent
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.changed, 3);

  const view = await call('mathT', 'GET', `/api/exams/${examB}`);
  const byId = Object.fromEntries(view.body.students.map(s => [s.student_id, s.mark]));
  assert.equal(byId[ID.s1].grade, 'A');
  assert.equal(byId[ID.s1].total, 80);
  assert.equal(byId[ID.s2].grade, 'D');
  assert.equal(byId[ID.s3].grade, 'AB');
  assert.equal(byId[ID.s3].is_pass, 0);
});

test('SEE boundaries end to end: 90 is A+, 89.99 is A, 34.99 is NG (75:25 split)', async () => {
  const aPlus = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s1, ...splitMarks(75, 15) }] });
  assert.equal(aPlus.status, 200);
  let view = await call('mathT', 'GET', `/api/exams/${examB}`);
  let s1 = view.body.students.find(s => s.student_id === ID.s1).mark;
  assert.equal(s1.total, 90);
  assert.equal(s1.grade, 'A+');

  await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s2, ...splitMarks(67.49, 22.5) }] });
  view = await call('mathT', 'GET', `/api/exams/${examB}`);
  assert.equal(view.body.students.find(s => s.student_id === ID.s2).mark.grade, 'A');

  await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s2, ...splitMarks(24.99, 10) }] });
  view = await call('mathT', 'GET', `/api/exams/${examB}`);
  const s2 = view.body.students.find(s => s.student_id === ID.s2).mark;
  assert.equal(s2.total, 34.99);
  assert.equal(s2.grade, 'NG');
  assert.equal(s2.is_pass, 0);
});

test('a batch is all or nothing: one bad entry saves nothing', async () => {
  const before = db.prepare('SELECT total FROM exam_marks WHERE exam_id = ? AND student_id = ?').get(examB, ID.s1).total;
  const r = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [
    { student_id: ID.s1, ...splitMarks(10, 10) },
    { student_id: ID.s2, ...splitMarks(99, 10) }, // theory over 75
  ] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /theory must be/);
  assert.equal(db.prepare('SELECT total FROM exam_marks WHERE exam_id = ? AND student_id = ?').get(examB, ID.s1).total, before);
});

test('subject teacher cannot enter marks for another subject, another class, or another section', async () => {
  // Science teacher on a Maths exam.
  const otherSubject = await call('sciT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s1, ...splitMarks(50, 20) }] });
  assert.equal(otherSubject.status, 403);
  assert.equal((await call('sciT', 'GET', `/api/exams/${examB}`)).status, 404, 'an exam outside scope is not shown');

  // Maths teacher (section B) on an all-sections exam, including a student in section A.
  const otherSection = await call('mathT', 'PUT', `/api/exams/${examAll}/marks`, { marks: [
    { student_id: ID.s1, mark: 70 },   // examAll is a single-mark (non-split) exam
    { student_id: ID.s4, mark: 70 },
  ] });
  assert.equal(otherSection.status, 403);
  assert.match(otherSection.body.error, /not assigned to/);
  const s1Unchanged = db.prepare('SELECT COUNT(*) AS n FROM exam_marks WHERE exam_id = ? AND student_id = ?').get(examAll, ID.s1).n;
  assert.equal(s1Unchanged, 0, 'nothing is written when the batch is refused');

  // A student from another section on a section-B exam is not on its roster.
  const notOnRoster = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s4, ...splitMarks(50, 20) }] });
  assert.equal(notOnRoster.status, 400);
  assert.match(notOnRoster.body.error, /not on this exam's roster/);
});

test('subject teacher only sees the students they can mark', async () => {
  const view = await call('mathT', 'GET', `/api/exams/${examAll}`);
  assert.equal(view.status, 200);
  const ids = view.body.students.map(s => s.student_id).sort();
  assert.deepEqual(ids, [ID.s1, ID.s2, ID.s3].sort(), 'section A student is not listed to a section B teacher');
});

test('exam coordinator has no marks-entry permission, and admin bypasses permissions', async () => {
  const coord = await call('coord', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s1, ...splitMarks(50, 20) }] });
  assert.equal(coord.status, 403);
  assert.match(coord.body.error, /exams\.enter_marks/);

  const admin = await call('admin', 'GET', '/api/exams');
  assert.equal(admin.status, 200);
  assert.ok(admin.body.exams.length >= 3);
});

test('re-saving an unchanged mark is not counted as a change', async () => {
  const r = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s3, absent: true }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed, 0, 'same value again is not a change');
});

// ---------- publish and the guardian view ----------

test('publish is blocked while a student on the roster has no mark', async () => {
  const pub = await call('coord', 'POST', `/api/exams/${examAll}/publish`);
  assert.equal(pub.status, 409);
  assert.match(pub.body.error, /no mark or absent flag/);
});

test('only the exam controller can publish', async () => {
  const denied = await call('mathT', 'POST', `/api/exams/${examB}/publish`);
  assert.equal(denied.status, 403);
});

test('unpublished marks are hidden from guardians', async () => {
  // The Science marks are entered but not published. The Maths exam is still draft too.
  const sci = await call('sciT', 'PUT', `/api/exams/${examSci}/marks`, { marks: [{ student_id: ID.s1, mark: 65 }] });
  assert.equal(sci.status, 200, JSON.stringify(sci.body));

  const g1 = await call('g1', 'GET', `/api/guardian/children/${ID.s1}/results`);
  assert.equal(g1.status, 200);
  assert.deepEqual(g1.body.results, [], 'draft marks are not shown to the guardian');
});

test('publish: exam controller publishes Maths, and the grades are locked', async () => {
  const pub = await call('coord', 'POST', `/api/exams/${examB}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.exam.status, 'published');

  const locked = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s1, ...splitMarks(75, 25) }] });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /locked/);

  const again = await call('coord', 'POST', `/api/exams/${examB}/publish`);
  assert.equal(again.status, 409);
});

test('guardian sees published results for a linked child, with the stored grade', async () => {
  const g1 = await call('g1', 'GET', `/api/guardian/children/${ID.s1}/results`);
  assert.equal(g1.status, 200);
  assert.equal(g1.body.results.length, 1, 'only the published Maths exam, not the draft Science exam');
  const [r] = g1.body.results;
  assert.equal(r.subject_name, 'Mathematics');
  assert.equal(r.total, 90);
  assert.equal(r.grade, 'A+');
  assert.equal(r.grade_point, 4);
  assert.equal(r.is_pass, true);
});

test('guardian gets nothing for a child who is not linked, or for a restricted link', async () => {
  const notLinked = await call('g1', 'GET', `/api/guardian/children/${ID.s2}/results`);
  assert.equal(notLinked.status, 404);
  const restricted = await call('g3', 'GET', `/api/guardian/children/${ID.s3}/results`);
  assert.equal(restricted.status, 404, 'a restricted link sees nothing about the child');
});

test('admin can turn exam results off for one link, and the guardian is refused', async () => {
  const patched = await call('admin', 'PATCH', `/api/guardians/${ID.g2}/students/${ID.s2}`, { can_view_results: false });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const off = await call('g2', 'GET', `/api/guardian/children/${ID.s2}/results`);
  assert.equal(off.status, 404);
});

test('guardian with a published child still sees nothing from staff routes', async () => {
  assert.equal((await call('g1', 'GET', '/api/exams')).status, 403, 'guardians are fenced out of /api/exams');
  assert.equal((await call('mathT', 'GET', `/api/guardian/children/${ID.s1}/results`)).status, 403, 'staff cannot use the guardian route');
});

test('a guardian of a section A child sees no results when that child has no published marks', async () => {
  const g4 = await call('g4', 'GET', `/api/guardian/children/${ID.s4}/results`);
  assert.equal(g4.status, 200);
  assert.deepEqual(g4.body.results, [], 'section A child has no published exam here');
});

// ---------- correcting a published exam ----------

test('unpublish needs a reason, then hides results from the guardian until republished', async () => {
  const noReason = await call('coord', 'POST', `/api/exams/${examB}/unpublish`, {});
  assert.equal(noReason.status, 400);

  const un = await call('coord', 'POST', `/api/exams/${examB}/unpublish`, { reason: 'Wrong mark entered for one student' });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.equal(un.body.exam.status, 'draft');

  const g1 = await call('g1', 'GET', `/api/guardian/children/${ID.s1}/results`);
  assert.deepEqual(g1.body.results, []);

  const fix = await call('mathT', 'PUT', `/api/exams/${examB}/marks`, { marks: [{ student_id: ID.s2, ...splitMarks(40, 20) }] });
  assert.equal(fix.status, 200, 'marks can be edited again while draft');

  const republish = await call('coord', 'POST', `/api/exams/${examB}/publish`);
  assert.equal(republish.status, 200, JSON.stringify(republish.body));
  const g1b = await call('g1', 'GET', `/api/guardian/children/${ID.s1}/results`);
  assert.equal(g1b.body.results.length, 1);
});

// ---------- audit ----------

test('every marks change and publish step is audited with previous and new values', async () => {
  const saved = db.prepare("SELECT previous_value, new_value FROM audit_logs WHERE module = 'exams' AND action = 'marks_saved' ORDER BY id").all();
  assert.ok(saved.length >= 5, `marks changes are audited (${saved.length})`);
  const first = JSON.parse(saved[0].new_value);
  assert.equal(first.grade, 'A');
  const changed = saved.find(r => r.previous_value && JSON.parse(r.previous_value).grade === 'A' && JSON.parse(r.new_value).grade === 'A+');
  assert.ok(changed, 'an entry records the previous grade (A) and the new one (A+)');

  const actions = db.prepare("SELECT action FROM audit_logs WHERE module = 'exams' AND action IN ('published','unpublished','term_created','exam_created','scale_created')").all().map(r => r.action);
  for (const a of ['published', 'unpublished', 'term_created', 'exam_created', 'scale_created']) {
    assert.ok(actions.includes(a), `${a} is audited`);
  }
  const un = db.prepare("SELECT description FROM audit_logs WHERE module = 'exams' AND action = 'unpublished'").get();
  assert.match(un.description, /Wrong mark/);
});
