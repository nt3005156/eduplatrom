// Phase 1: student photo field. Only real images, only the student or an admin may change it, and only the
// student, admins and the student's class teachers may view it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-photo-'));
const uploadsDir = path.join(tmpDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'photo.db');
process.env.UPLOADS_DIR = uploadsDir;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-987';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { sniffImage } = await import('../src/routes/studentPhotos.js');

let server, base;
const PW = 'Photo-Test-Pass-2026';
const T = {};
const ID = {};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);

function addUser(key, { role, class_level = null, section = null, staff_role = null }) {
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  ID[key] = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, class_level, section, staff_role, approval_status, account_status, role_id)
    VALUES (?,?,?,?,?,?,?, 'approved', 'active', ?)`).run(key, `${key}@photo.test`, bcrypt.hashSync(PW, 4), role, class_level, section, staff_role, roleId).lastInsertRowid);
}

async function login(key) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email: `${key}@photo.test`, password: PW }),
  });
  assert.equal(r.status, 200, `login ${key}`);
  T[key] = (await r.json()).token;
}

const auth = (who) => ({ Authorization: `Bearer ${T[who]}`, 'X-NITEX-Client': 'web' });

async function uploadPhoto(target, who, bytes, type = 'image/jpeg', filename = 'me.jpg') {
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type }), filename);
  return fetch(`${base}/api/users/${ID[target]}/photo`, { method: 'POST', headers: auth(who), body: form });
}

async function view(photoUrl, who) {
  const headers = who ? auth(who) : { 'X-NITEX-Client': 'web' };
  return (await fetch(base + photoUrl, { headers })).status;
}

before(async () => {
  addUser('admin', { role: 'admin' });
  addUser('kid', { role: 'student', class_level: 8, section: 'A' });
  addUser('classmate', { role: 'student', class_level: 8, section: 'B' });
  addUser('otherclass', { role: 'student', class_level: 9, section: 'A' });
  addUser('classteacher', { role: 'teacher', staff_role: 'class_teacher' });
  addUser('stranger', { role: 'teacher', staff_role: 'class_teacher' });
  addUser('guardian', { role: 'guardian' });
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of Object.keys(ID)) await login(k);
  const subject = db.prepare('SELECT id FROM subjects WHERE class_level = 8 ORDER BY id LIMIT 1').get().id;
  db.prepare('INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id) VALUES (?,8,NULL,?)').run(ID.classteacher, subject);
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('the image check reads the file content, not the declared type', () => {
  assert.equal(sniffImage(JPEG), 'jpg');
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(WEBP), 'webp');
  assert.equal(sniffImage(Buffer.from('<script>alert(1)</script> padding padding')), null);
  assert.equal(sniffImage(Buffer.alloc(4)), null);
});

test('a student can add their own photo; the file is stored under uploads with a random name', async () => {
  const r = await uploadPhoto('kid', 'kid', JPEG);
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.match(body.photo_url, /^\/uploads\/photo-[0-9a-f]{32}\.jpg$/);
  assert.ok(fs.existsSync(path.join(uploadsDir, path.basename(body.photo_url))));
  assert.equal(db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.kid).photo_path, body.photo_url);
});

test('an admin can add a PNG or WebP photo for a student', async () => {
  assert.equal((await uploadPhoto('classmate', 'admin', PNG, 'image/png', 'x.png')).status, 200);
  assert.equal((await uploadPhoto('classmate', 'admin', WEBP, 'image/webp', 'x.webp')).status, 200);
});

test('a file that only claims to be an image is refused', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const r = await uploadPhoto('kid', 'kid', html, 'image/jpeg', 'evil.jpg');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not a JPEG, PNG or WebP/);
});

test('a photo over 2 MB is refused', async () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024, 7)]);
  const r = await uploadPhoto('kid', 'kid', big);
  assert.equal(r.status, 400);
});

test('a student cannot change another student’s photo; teachers cannot either', async () => {
  assert.equal((await uploadPhoto('classmate', 'kid', JPEG)).status, 403);
  assert.equal((await uploadPhoto('kid', 'classteacher', JPEG)).status, 403);
});

test('photos are kept for students only', async () => {
  const r = await uploadPhoto('classteacher', 'admin', JPEG);
  assert.equal(r.status, 400);
});

test('the photo is visible to the student, admins and the class teacher, not to classmates or strangers', async () => {
  const url = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.kid).photo_path;
  assert.equal(await view(url, 'kid'), 200);
  assert.equal(await view(url, 'admin'), 200);
  assert.equal(await view(url, 'classteacher'), 200);
  assert.equal(await view(url, 'classmate'), 404, 'a classmate does not see another student’s photo');
  assert.equal(await view(url, 'otherclass'), 404);
  assert.equal(await view(url, 'stranger'), 404);
  assert.equal(await view(url, 'guardian'), 403);
});

test('replacing a photo removes the old file', async () => {
  const before = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.kid).photo_path;
  const r = await uploadPhoto('kid', 'kid', PNG, 'image/png', 'new.png');
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(uploadsDir, path.basename(before))), false, 'old file removed');
});

test('a student can remove their photo; the file goes and the field is cleared', async () => {
  const current = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.kid).photo_path;
  const r = await fetch(`${base}/api/users/${ID.kid}/photo`, { method: 'DELETE', headers: auth('kid') });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.kid).photo_path, null);
  assert.equal(fs.existsSync(path.join(uploadsDir, path.basename(current))), false);
});

test('erasure removes the photo file and clears the field', async () => {
  await uploadPhoto('classmate', 'admin', JPEG);
  const current = db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.classmate).photo_path;
  assert.ok(current);
  const r = await fetch(`${base}/api/privacy/users/${ID.classmate}/anonymize`, {
    method: 'POST', headers: { ...auth('admin'), 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'ANONYMIZE' }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(db.prepare('SELECT photo_path FROM users WHERE id = ?').get(ID.classmate).photo_path, null);
  assert.equal(fs.existsSync(path.join(uploadsDir, path.basename(current))), false);
});

test('every photo change is written to the audit log', async () => {
  const rows = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE module = 'users' AND action IN ('photo_updated','photo_removed')").get();
  assert.ok(rows.c >= 4);
});
