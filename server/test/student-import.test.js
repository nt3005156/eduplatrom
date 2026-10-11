// Phase 1: bulk student import (preview, all-or-nothing commit, sibling guardians) and CSV parsing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-import-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'import.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.PUBLIC_URL = 'https://school.example.test';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { parseCsv, normalizePhone } = await import('../src/utils/validate.js');

let server, base, adminToken, studentToken;

async function call(method, url, { token, body } = {}) {
  const h = { 'X-NITEX-Client': 'web' };
  if (body) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

const HEADER = 'name,email,class_level,section,roll_no,admission_no,gender,dob_ad,dob_bs,blood_group,phone,address,iemis_id,neb_reg_no,emergency_contact_name,emergency_contact_phone,guardian_name,guardian_email,guardian_phone,guardian_relationship';

before(async () => {
  const sys = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get();
  const mk = (name, email, role, extra = {}) => Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id, class_level, section)
    VALUES (?,?,?,?,'approved','active',?,?,?)`).run(name, email, bcrypt.hashSync('Pass-Import-2026-x', 4), role, extra.role_id ?? null, extra.class_level ?? null, extra.section ?? null).lastInsertRowid);
  mk('Principal', 'principal@import.test', 'admin', { role_id: sys.id });
  mk('Student', 'student@import.test', 'student', { class_level: 6, section: 'A' });
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await call('POST', '/api/auth/login', { body: { email: 'principal@import.test', password: 'Pass-Import-2026-x' } })).json.token;
  studentToken = (await call('POST', '/api/auth/login', { body: { email: 'student@import.test', password: 'Pass-Import-2026-x' } })).json.token;
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CSV parser handles quotes, doubled quotes, CRLF, BOM and blank lines', () => {
  const rows = parseCsv('\uFEFFname,note\r\n"Sharma, Ram","He said ""hi"""\r\n\r\nAsha,\n');
  assert.deepEqual(rows, [['name', 'note'], ['Sharma, Ram', 'He said "hi"'], ['Asha', '']]);
  assert.throws(() => parseCsv('name\n"unclosed'), /unclosed/);
});

test('phone rules: Nepal mobile and international E.164', () => {
  assert.equal(normalizePhone('98-1234-5678').value, '+9779812345678');
  assert.equal(normalizePhone('+977 9712345678').value, '+9779712345678');
  assert.equal(normalizePhone('00977 9612345678').value, '+9779612345678');
  assert.equal(normalizePhone('+14155550123').value, '+14155550123');
  assert.equal(normalizePhone('').value, null);
  assert.equal(normalizePhone('12345').ok, false);
  assert.equal(normalizePhone('+1 (800) abc').ok, false);
});

test('preview reports every bad row and writes nothing', async () => {
  const csv = [
    HEADER,
    'Asha Sharma,asha.new@school.test,7,A,1,ADM-100,female,2014-01-01,,,,,,,,,,,,',
    'Bad Class,bad1@school.test,13,A,,,,,,,,,,,,,,,,',              // class out of range
    'Bad Email,not-an-email,7,A,,,,,,,,,,,,,,,,',                   // invalid email
    'Dup Email,asha.new@school.test,7,B,,,,,,,,,,,,,,,,',           // repeats row 1
    'Dup Roll,dupr@school.test,7,A,1,,,,,,,,,,,,,,,',              // roll 1 repeats row 1 in same class/section
    'Future,future@school.test,6,A,,,,2099-01-01,,,,,,,,,,,,',       // future date
    'Bad Phone,phone@school.test,6,A,,,,,,,123,,,,,,,,,,',           // phone
    'Guardian Missing Email,gm@school.test,6,A,,,,,,,,,,,,,,Ram,,,father', // guardian email missing
  ].join('\n');
  const r = await call('POST', '/api/student-import/preview', { token: adminToken, body: { csv } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.summary.total, 8);
  assert.equal(r.json.summary.invalid, 7);
  const byName = Object.fromEntries(r.json.rows.map(x => [x.data.name, x]));
  assert.ok(byName['Bad Class'].errors.some(e => /class_level/.test(e)));
  assert.ok(byName['Bad Email'].errors.some(e => /email/.test(e)));
  assert.ok(byName['Dup Email'].errors.some(e => /repeats row 1/.test(e)));
  assert.ok(byName['Dup Roll'].errors.some(e => /roll_no/.test(e)));
  assert.ok(byName['Future'].errors.some(e => /future/.test(e)));
  assert.ok(byName['Bad Phone'].errors.some(e => /phone/.test(e)));
  assert.ok(byName['Guardian Missing Email'].errors.some(e => /guardian_email/.test(e)));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'asha.new@school.test'").get().c, 0, 'preview writes nothing');
});

test('file-level problems are refused before any row is read', async () => {
  const unknown = await call('POST', '/api/student-import/preview', { token: adminToken, body: { csv: 'name,email,class_level,section,favourite_colour\nA B,a@x.test,6,A,blue' } });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error, /Unknown column\(s\): favourite_colour/);
  const missing = await call('POST', '/api/student-import/preview', { token: adminToken, body: { csv: 'name,email\nA B,a@x.test' } });
  assert.match(missing.json.error, /Missing required column\(s\): class_level, section/);
  const none = await call('POST', '/api/student-import/preview', { token: adminToken, body: { csv: HEADER } });
  assert.equal(none.status, 400);
});

test('commit refuses the whole file when any row is wrong', async () => {
  const csv = [HEADER,
    'Good One,good1@school.test,6,A,1,ADM-201,,,,,,,,,,,,,,',
    'Bad One,bad2@school.test,99,A,,,,,,,,,,,,,,,,'].join('\n');
  const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const r = await call('POST', '/api/student-import', { token: adminToken, body: { csv } });
  assert.equal(r.status, 422);
  assert.match(r.json.error, /Nothing was imported/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before, 'no partial import');
});

test('500 students import in one go, siblings share one guardian, every student gets a setup link', async () => {
  const rows = [HEADER];
  const classes = [6, 7, 8, 9, 10, 11, 12];
  for (let i = 0; i < 500; i++) {
    const cls = classes[i % classes.length];
    const sec = i % 2 ? 'A' : 'B';
    const guardianIdx = Math.floor(i / 2);   // two children per guardian
    const name = i % 50 === 0 ? `"Kafle, Sita ${i}"` : `Student ${i}`;
    rows.push([name, `s${i}@bulk.test`, cls, sec, String(i + 1), `BULK-${i}`, i % 2 ? 'male' : 'female',
      '2013-05-01', '2070-01-18', 'B+', `98${String(10000000 + i).slice(0, 8)}`, 'Kathmandu', '', '', 'Emergency', '',
      `Parent ${guardianIdx}`, `parent${guardianIdx}@bulk.test`, '', 'father'].join(','));
  }
  const csv = rows.join('\n');
  const preview = await call('POST', '/api/student-import/preview', { token: adminToken, body: { csv } });
  assert.equal(preview.status, 200, preview.text);
  assert.equal(preview.json.summary.total, 500);
  assert.equal(preview.json.summary.invalid, 0, JSON.stringify(preview.json.rows.filter(r => r.errors.length).slice(0, 3)));
  assert.equal(preview.json.summary.guardians_new, 250);

  const t0 = Date.now();
  const r = await call('POST', '/api/student-import', { token: adminToken, body: { csv } });
  const ms = Date.now() - t0;
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.created.students, 500);
  assert.equal(r.json.created.guardians, 250);
  assert.equal(r.json.created.links, 500);
  assert.equal(r.json.setup_links.length, 750);
  assert.ok(ms < 5000, `import took ${ms} ms`);

  const g = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'guardian' AND email LIKE 'parent%@bulk.test'").get().c;
  assert.equal(g, 250);
  const kids = db.prepare("SELECT COUNT(*) c FROM guardian_students gs JOIN users u ON u.id = gs.guardian_id WHERE u.email = 'parent0@bulk.test'").get().c;
  assert.equal(kids, 2, 'siblings are linked to the same guardian');
  const quoted = db.prepare("SELECT name FROM users WHERE admission_no = 'BULK-0'").get();
  assert.equal(quoted.name, 'Kafle, Sita 0', 'a quoted comma stays in the name');
  const phone = db.prepare("SELECT phone FROM users WHERE email = 's1@bulk.test'").get();
  assert.equal(phone.phone, '+9779810000001', 'Nepal mobile normalised on import');
  assert.match(r.json.setup_links[0].setup_url, /^https:\/\/school\.example\.test\/setup\?token=/);
});

test('importing the same file again is refused (emails and admission numbers already exist)', async () => {
  const again = [HEADER, 'Repeat,s1@bulk.test,6,A,,BULK-1,,,,,,,,,,,,,,'].join('\n');
  const r = await call('POST', '/api/student-import', { token: adminToken, body: { csv: again } });
  assert.equal(r.status, 422);
  assert.ok(r.json.rows[0].errors.some(e => /already has an account/.test(e)));
  assert.ok(r.json.rows[0].errors.some(e => /admission_no already belongs/.test(e)));
});

test('an existing guardian account is linked, not duplicated', async () => {
  const existing = db.prepare("SELECT id FROM users WHERE email = 'parent0@bulk.test'").get();
  const cols = Object.fromEntries(HEADER.split(',').map(h => [h, '']));
  Object.assign(cols, { name: 'New Sibling', email: 'newsib@bulk.test', class_level: '8', section: 'B', admission_no: 'ADMIN-NEW',
    guardian_name: 'Parent 0', guardian_email: 'parent0@bulk.test', guardian_relationship: 'mother' });
  const csv = [HEADER, HEADER.split(',').map(h => cols[h]).join(',')].join('\n');
  const preview = await call('POST', '/api/student-import/preview', { token: adminToken, body: { csv } });
  assert.equal(preview.json.summary.guardians_existing, 1);
  assert.equal(preview.json.summary.guardians_new, 0);
  const r = await call('POST', '/api/student-import', { token: adminToken, body: { csv } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.created.guardians, 1);
  const link = db.prepare("SELECT gs.guardian_id, gs.relationship FROM guardian_students gs JOIN users u ON u.id = gs.student_id WHERE u.email = 'newsib@bulk.test'").get();
  assert.equal(link.guardian_id, existing.id);
  assert.equal(link.relationship, 'mother');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'parent0@bulk.test'").get().c, 1, 'no duplicate guardian');
});

test('only admins may import; students get 403', async () => {
  const csv = [HEADER, 'Nope,nope@x.test,6,A,,,,,,,,,,,,,,,,'].join('\n');
  assert.equal((await call('POST', '/api/student-import/preview', { token: studentToken, body: { csv } })).status, 403);
  assert.equal((await call('POST', '/api/student-import', { token: studentToken, body: { csv } })).status, 403);
});

test('an import is audited as one summary entry', () => {
  const n = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'imported'").get().c;
  assert.equal(n, 2, 'the 500-row import and the sibling import, one entry each');
});
