// Phase 1 fix: /uploads ownership. A file opens only for someone the record that owns it allows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-owner-'));
const uploadsDir = path.join(tmpDir, 'uploads');
fs.mkdirSync(path.join(uploadsDir, 'public'), { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'owner.db');
process.env.UPLOADS_DIR = uploadsDir;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-654';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');

let server, base;
const PW = 'Ownership-Test-Pass-2026';
const T = {};   // tokens by key
const ID = {};  // user ids by key
const created = [];

function addUser(key, { role, class_level = null, section = null, staff_role = null, approval = 'approved' }) {
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  const id = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, staff_role, approval_status, account_status, role_id)
    VALUES (?,?,?,?,?,?,?,?, 'active', ?)`).run(key, `${key}@own.test`, bcrypt.hashSync(PW, 4), role, class_level, section, staff_role, approval, roleId).lastInsertRowid);
  ID[key] = id;
}

async function login(key) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email: `${key}@own.test`, password: PW }),
  });
  assert.equal(r.status, 200, `login ${key}`);
  T[key] = (await r.json()).token;
}

async function open(file, who) {
  const headers = { 'X-NITEX-Client': 'web' };
  if (who) headers.Authorization = `Bearer ${T[who]}`;
  const r = await fetch(`${base}/uploads/${file}`, { headers, redirect: 'manual' });
  return r.status;
}

function putFile(name, body = `content of ${name}`) {
  fs.writeFileSync(path.join(uploadsDir, name), body);
  created.push(name);
  return name;
}

before(async () => {
  addUser('admin', { role: 'admin' });
  addUser('stu10a', { role: 'student', class_level: 10, section: 'A' });
  addUser('stu10b', { role: 'student', class_level: 10, section: 'B' });
  addUser('stu9a', { role: 'student', class_level: 9, section: 'A' });
  addUser('teacher', { role: 'teacher', staff_role: 'class_teacher' });
  addUser('stranger', { role: 'teacher', staff_role: 'class_teacher' });
  addUser('head', { role: 'teacher', staff_role: 'academic_head' });
  addUser('applicant', { role: 'student', class_level: 8, section: 'A' });
  addUser('guardian', { role: 'guardian' });
  addUser('disabled', { role: 'student', class_level: 10, section: 'A' });
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of Object.keys(ID)) await login(k);

  // The seeded subject and quiz (class 10, Mathematics) are the scope for the test records.
  const subject = db.prepare('SELECT id FROM subjects WHERE class_level = 10 ORDER BY id LIMIT 1').get().id;
  const otherSubject = db.prepare('SELECT id FROM subjects WHERE class_level = 9 ORDER BY id LIMIT 1').get().id;
  db.prepare('INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id) VALUES (?,10,NULL,?)').run(ID.teacher, subject);
  T.subject = subject;
  T.otherSubject = otherSubject;
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a material is open to its class and to the teacher who uploaded it; not to other classes or strangers', async () => {
  const f = putFile('mat-class10.pdf');
  db.prepare("INSERT INTO materials (subject_id, class_level, title, type, file_path, uploaded_by) VALUES (?,10,'Notes','pdf',?,?)").run(T.subject, `/uploads/${f}`, ID.teacher);
  assert.equal(await open(f, 'stu10a'), 200);
  assert.equal(await open(f, 'stu10b'), 200, 'same class, other section');
  assert.equal(await open(f, 'stu9a'), 404, 'other class');
  assert.equal(await open(f, 'stranger'), 404, 'teacher not assigned');
  assert.equal(await open(f, 'teacher'), 200);
  assert.equal(await open(f, 'head'), 200, 'academic head is school-wide');
  assert.equal(await open(f, 'admin'), 200);
  assert.equal(await open(f, 'guardian'), 403, 'guardians have no file access');
  assert.equal(await open(f), 401, 'signed out');
});

test('an assignment attachment is limited to its section', async () => {
  const f = putFile('assign-10a.pdf');
  db.prepare(`INSERT INTO assignments (subject_id, class_level, section, title, file_path, created_by, status)
    VALUES (?,10,'A','Worksheet',?,?, 'published')`).run(T.subject, `/uploads/${f}`, ID.teacher);
  assert.equal(await open(f, 'stu10a'), 200);
  assert.equal(await open(f, 'stu10b'), 404, 'section B cannot open section A work');
  assert.equal(await open(f, 'teacher'), 200);
});

test('a submission is visible to its student and to the teacher for that assignment, not to classmates', async () => {
  const a = db.prepare("SELECT id FROM assignments WHERE title = 'Worksheet'").get().id;
  const f = putFile('submission-stu10a.pdf');
  db.prepare(`INSERT INTO submissions (assignment_id, student_id, file_path, status) VALUES (?,?,?,'submitted')`).run(a, ID.stu10a, `/uploads/${f}`);
  assert.equal(await open(f, 'stu10a'), 200, 'the student who sent it');
  assert.equal(await open(f, 'stu10b'), 404, 'a classmate');
  assert.equal(await open(f, 'teacher'), 200, 'the assigned teacher');
  assert.equal(await open(f, 'stranger'), 404);
});

test('a JSON attachment list counts as a reference', async () => {
  const a = db.prepare("SELECT id FROM assignments WHERE title = 'Worksheet'").get().id;
  const f = putFile('multi-stu10a.pdf');
  db.prepare(`INSERT INTO submissions (assignment_id, student_id, attachments, status) VALUES (?,?,?,'submitted')`)
    .run(a, ID.stu10b, JSON.stringify([{ path: `/uploads/${f}`, name: 'a.pdf' }]));
  assert.equal(await open(f, 'stu10b'), 200, 'the student who attached it');
  assert.equal(await open(f, 'stu10a'), 404, 'a classmate');
  assert.equal(await open(f, 'teacher'), 200);
});

test('an application document is visible to the applicant and to the academic head only', async () => {
  const f = putFile('application-doc.pdf');
  db.prepare("INSERT INTO applications (applicant_user_id, version, status, data, is_current) VALUES (?,1,'submitted',?,1)")
    .run(ID.applicant, JSON.stringify({ documents: { birth_certificate: `/uploads/${f}` } }));
  assert.equal(await open(f, 'applicant'), 200);
  assert.equal(await open(f, 'head'), 200);
  assert.equal(await open(f, 'stu10a'), 404);
  assert.equal(await open(f, 'teacher'), 404, 'an ordinary teacher cannot see admission documents');
});

test('quiz question media follows the quiz class', async () => {
  const quiz = db.prepare('SELECT id FROM quizzes WHERE class_level = 10 LIMIT 1').get().id;
  const f = putFile('quiz-media.png');
  db.prepare("INSERT INTO quiz_questions (quiz_id, qtype, question, media_url) VALUES (?, 'image', 'Look', ?)").run(quiz, `/uploads/${f}`);
  assert.equal(await open(f, 'stu10a'), 200);
  assert.equal(await open(f, 'stu9a'), 404);
});

test('a file that no record refers to is open to admins only', async () => {
  const f = putFile('orphan-file.txt');
  assert.equal(await open(f, 'stu10a'), 404);
  assert.equal(await open(f, 'teacher'), 404);
  assert.equal(await open(f, 'admin'), 200);
});

test('the school logo is open to any signed-in user, but not to guardians', async () => {
  const f = putFile('school-hero.png');
  db.prepare("UPDATE settings SET hero_image_url = ? WHERE id = 1").run(`/uploads/${f}`);
  assert.equal(await open(f, 'stu9a'), 200);
  assert.equal(await open(f, 'guardian'), 403);
});

test('a disabled account loses access even with a valid token', async () => {
  const f = putFile('mat-class10.pdf');
  db.prepare("UPDATE users SET account_status = 'disabled' WHERE id = ?").run(ID.disabled);
  assert.equal(await open(f, 'disabled'), 401);
});

test('the access check refuses folders, traversal and hidden names', async () => {
  const { canReadUpload } = await import('../src/services/fileAccess.js');
  assert.equal(canReadUpload(ID.admin, '../db/index.js'), false);
  assert.equal(canReadUpload(ID.admin, 'sub/file.txt'), false);
  assert.equal(canReadUpload(ID.admin, '.env'), false);
  assert.equal(canReadUpload(ID.admin, ''), false);
  assert.equal(await open('..%2F..%2Fdb%2Findex.js', 'admin'), 404);
});

test('the file-name rules cover the stored name exactly (no partial matches)', async () => {
  const f = putFile('quiz-media-extra.png');
  // "quiz-media.png" is referenced; "media.png" and "quiz-media.png.bak" are not the same file.
  const { referencesFor } = await import('../src/services/fileAccess.js');
  assert.equal(referencesFor('quiz-media.png').length >= 1, true);
  assert.equal(referencesFor('media.png').length, 0);
  assert.equal(referencesFor(f).length, 0);
});
