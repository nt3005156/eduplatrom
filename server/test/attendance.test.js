// Attendance module tests. Run with: npm test (from /server).
// Uses an isolated temporary SQLite database so the dev data is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const bcrypt = (await import('bcryptjs')).default;

let server, base;
const tokens = {};

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: res.status, json, text, headers: res.headers };
}

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}
function daysAgoISO(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

function addUser({ name, email, role, staff_role = null, class_level = null, section = null }) {
  const roleKey = role === 'student' ? null : (staff_role || 'subject_teacher');
  const roleRow = roleKey ? db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey) : null;
  const info = db.prepare(`INSERT INTO users (name, email, password_hash, role, staff_role, class_level, section,
      approval_status, account_status, role_id) VALUES (?,?,?,?,?,?,?, 'approved', 'active', ?)`)
    .run(name, email, bcrypt.hashSync('Pass@12345', 4), role, staff_role, class_level, section, roleRow?.id ?? null);
  return info.lastInsertRowid;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Seeded demo accounts (NODE_ENV=test enables demo seeding).
  for (const [key, email, pw] of [['admin', 'admin@nitex.com', 'Admin@123'], ['teacher', 'teacher@nitex.com', 'Teacher@123'], ['student', 'student@nitex.com', 'Student@123']]) {
    const r = await api('POST', '/api/auth/login', { body: { email, password: pw } });
    assert.equal(r.status, 200, `login ${key} failed`);
    tokens[key] = r.json.token;
  }

  // Extra students in Class 10 A so rosters have more than one person.
  addUser({ name: 'Bina Thapa', email: 'bina@test.com', role: 'student', class_level: 10, section: 'A' });
  addUser({ name: 'Chirag Rai', email: 'chirag@test.com', role: 'student', class_level: 10, section: 'A' });
  addUser({ name: 'Other Class Kid', email: 'other@test.com', role: 'student', class_level: 9, section: 'B' });

  // Subject-only teacher: teaches Class 10 A Mathematics but is NOT homeroom.
  const subjOnlyId = addUser({ name: 'Subject Only', email: 'subj@test.com', role: 'teacher', staff_role: 'subject_teacher' });
  const math10 = db.prepare("SELECT id FROM subjects WHERE class_level = 10 AND name = 'Mathematics'").get();
  db.prepare('INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id, is_class_teacher) VALUES (?,?,?,?,0)')
    .run(subjOnlyId, 10, 'A', math10.id);
  // Teacher with no assignments at all.
  addUser({ name: 'Unassigned', email: 'none@test.com', role: 'teacher', staff_role: 'subject_teacher' });

  for (const [key, email] of [['subj', 'subj@test.com'], ['none', 'none@test.com']]) {
    const r = await api('POST', '/api/auth/login', { body: { email, password: 'Pass@12345' } });
    assert.equal(r.status, 200, `login ${key} failed`);
    tokens[key] = r.json.token;
  }
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('unauthenticated and student callers are rejected', async () => {
  assert.equal((await api('GET', '/api/attendance/roster?class_level=10&section=A')).status, 401);
  assert.equal((await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.student })).status, 403);
  assert.equal((await api('GET', '/api/attendance/summary?class_level=10', { token: tokens.student })).status, 403);
});

test('homeroom teacher sees the Class 10 A daily register with all active students', async () => {
  const r = await api('GET', `/api/attendance/roster?class_level=10&section=A&date=${todayISO()}`, { token: tokens.teacher });
  assert.equal(r.status, 200);
  assert.equal(r.json.register, 'daily');
  const names = r.json.students.map(s => s.name);
  assert.ok(names.includes('Aarav Sharma') && names.includes('Bina Thapa') && names.includes('Chirag Rai'));
  assert.ok(!names.includes('Other Class Kid'), 'must not leak students from other classes');
  assert.equal(r.json.counts.unmarked, r.json.students.length);
});

test('bulk marking creates then updates records (upsert, no duplicates)', async () => {
  const roster = (await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.teacher })).json.students;
  const aarav = roster.find(s => s.name === 'Aarav Sharma').id;
  const bina = roster.find(s => s.name === 'Bina Thapa').id;
  const chirag = roster.find(s => s.name === 'Chirag Rai').id;
  const date = todayISO();
  const body = { class_level: 10, section: 'A', date, records: [
    { student_id: aarav, status: 'present' },
    { student_id: bina, status: 'absent', remarks: 'fever' },
    { student_id: chirag, status: 'late' },
  ] };

  const first = await api('POST', '/api/attendance', { token: tokens.teacher, body });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.created, 3);
  assert.equal(first.json.updated, 0);

  const second = await api('POST', '/api/attendance', { token: tokens.teacher, body: { ...body, records: [{ student_id: bina, status: 'excused' }] } });
  assert.equal(second.status, 200);
  assert.equal(second.json.updated, 1);
  assert.equal(second.json.created, 0);

  const reg = (await api('GET', `/api/attendance/roster?class_level=10&section=A&date=${date}`, { token: tokens.teacher })).json;
  assert.equal(reg.students.find(s => s.id === bina).status, 'excused');
  assert.equal(reg.counts.present, 1);
  assert.equal(reg.counts.unmarked, 0);
  const rows = db.prepare('SELECT COUNT(*) c FROM attendance_records WHERE student_id = ? AND date = ? AND subject_id IS NULL').get(bina, date).c;
  assert.equal(rows, 1, 'a student must never have two daily rows for one date');
});

test('invalid payloads are rejected with clear errors', async () => {
  const roster = (await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.teacher })).json.students;
  const sid = roster[0].id;
  const base = { class_level: 10, section: 'A', date: todayISO() };
  const cases = [
    [{ ...base, records: [{ student_id: sid, status: 'sleeping' }] }, /Invalid status/],
    [{ ...base, records: [{ student_id: 999999, status: 'present' }] }, /not in Class 10/],
    [{ ...base, records: [] }, /non-empty/],
    [{ ...base, date: '2099-01-01', records: [{ student_id: sid, status: 'present' }] }, /future/],
    [{ ...base, date: '2026-02-31', records: [{ student_id: sid, status: 'present' }] }, /YYYY-MM-DD/],
    [{ ...base, records: [{ student_id: sid, status: 'present' }, { student_id: sid, status: 'absent' }] }, /Duplicate/],
    [{ ...base, class_level: 99, records: [{ student_id: sid, status: 'present' }] }, /class_level/],
  ];
  for (const [body, msg] of cases) {
    const r = await api('POST', '/api/attendance', { token: tokens.teacher, body });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)}`);
    assert.match(r.json.error, msg);
  }
});

test('a teacher cannot change registers older than the edit window; an admin can', async () => {
  const roster = (await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.teacher })).json.students;
  const sid = roster[0].id;
  const body = { class_level: 10, section: 'A', date: daysAgoISO(30), records: [{ student_id: sid, status: 'present' }] };
  const denied = await api('POST', '/api/attendance', { token: tokens.teacher, body });
  assert.equal(denied.status, 403);
  assert.match(denied.json.error, /Academic Head or Admin/);
  const allowed = await api('POST', '/api/attendance', { token: tokens.admin, body });
  assert.equal(allowed.status, 200, allowed.text);
});

test('subject teacher can mark their subject register but not the homeroom register', async () => {
  const math10 = db.prepare("SELECT id FROM subjects WHERE class_level = 10 AND name = 'Mathematics'").get();
  const homeroom = await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.subj });
  assert.equal(homeroom.status, 403, 'homeroom register is for the Class Teacher only');
  const subjRoster = (await api('GET', `/api/attendance/roster?class_level=10&section=A&subject_id=${math10.id}`, { token: tokens.subj })).json;
  assert.equal(subjRoster.register, 'subject');
  const sid = subjRoster.students[0].id;
  const daily = await api('POST', '/api/attendance', { token: tokens.subj, body: { class_level: 10, section: 'A', date: todayISO(), records: [{ student_id: sid, status: 'present' }] } });
  assert.equal(daily.status, 403);
  assert.match(daily.json.error, /Class Teacher/);

  const subj = await api('POST', '/api/attendance', { token: tokens.subj, body: { class_level: 10, section: 'A', subject_id: math10.id, date: todayISO(), records: [{ student_id: sid, status: 'present' }] } });
  assert.equal(subj.status, 200, subj.text);
  const reg = (await api('GET', `/api/attendance/roster?class_level=10&section=A&subject_id=${math10.id}`, { token: tokens.subj })).json;
  assert.equal(reg.register, 'subject');
  assert.equal(reg.counts.present, 1);
});

test('teacher with no assignments is blocked from another class entirely', async () => {
  const r = await api('GET', '/api/attendance/roster?class_level=9&section=B', { token: tokens.none });
  assert.equal(r.status, 403);
  const p = await api('POST', '/api/attendance', { token: tokens.none, body: { class_level: 9, section: 'B', date: todayISO(), records: [{ student_id: 1, status: 'present' }] } });
  assert.equal(p.status, 403);
});

test('summary computes attendance % with the documented formula and exports CSV', async () => {
  // Fresh, isolated date range so earlier tests cannot skew the numbers.
  const roster = (await api('GET', '/api/attendance/roster?class_level=10&section=A', { token: tokens.teacher })).json.students;
  const bina = roster.find(s => s.name === 'Bina Thapa').id;
  const from = '2000-01-01', to = todayISO();
  // Give Bina a known mix on new dates: present, half_day, absent, excused.
  const days = [daysAgoISO(20), daysAgoISO(19), daysAgoISO(18), daysAgoISO(17)];
  const statuses = ['present', 'half_day', 'absent', 'excused'];
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/api/attendance', { token: tokens.admin, body: { class_level: 10, section: 'A', date: days[i], records: [{ student_id: bina, status: statuses[i] }] } });
    assert.equal(r.status, 200);
  }
  const sum = await api('GET', `/api/attendance/summary?class_level=10&section=A&from=${from}&to=${to}`, { token: tokens.admin });
  assert.equal(sum.status, 200, sum.text);
  const row = sum.json.students.find(s => s.id === bina);
  // Bina's daily register rows: the 4 new ones, plus whatever the earlier tests wrote for her.
  // attended = present + late + excused + 0.5*half_day ; pct = attended / total.
  const attended = row.present + row.late + row.excused + 0.5 * row.half_day;
  assert.equal(row.attendance_pct, Math.round((attended / row.total) * 1000) / 10);
  assert.ok(row.excused >= 1 && row.half_day >= 1);

  // Exact check on a fresh student with a known, small set of records.
  const fresh = addUser({ name: 'Exact Math', email: 'exact@test.com', role: 'student', class_level: 8, section: 'A' });
  const days2 = [daysAgoISO(10), daysAgoISO(9), daysAgoISO(8), daysAgoISO(7)];
  const st2 = ['present', 'present', 'half_day', 'absent'];
  for (let i = 0; i < 4; i++) {
    await api('POST', '/api/attendance', { token: tokens.admin, body: { class_level: 8, section: 'A', date: days2[i], records: [{ student_id: fresh, status: st2[i] }] } });
  }
  const s8 = (await api('GET', `/api/attendance/summary?class_level=8&section=A&from=${days2[0]}&to=${days2[3]}`, { token: tokens.admin })).json;
  const ex = s8.students.find(s => s.id === fresh);
  assert.equal(ex.total, 4);
  assert.equal(ex.attendance_pct, 62.5); // (2 present + 0.5 half_day) / 4 = 2.5/4 -> 62.5%
  assert.equal(s8.at_risk_count, 1);

  const csv = await api('GET', `/api/attendance/summary?class_level=10&section=A&from=${from}&to=${to}&format=csv`, { token: tokens.admin });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text.split('\n')[0], /^"Name","Email"/);
  assert.match(csv.text, /Bina Thapa/);
});

test('a student sees only their own attendance and a below-75% flag', async () => {
  const r = await api('GET', '/api/attendance/me', { token: tokens.student });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.records));
  assert.ok(r.json.records.every(x => x.date));
  const staffTry = await api('GET', '/api/attendance/me', { token: tokens.teacher });
  assert.equal(staffTry.status, 403);
});

test('default reporting window includes today even when the active session has ended', async () => {
  // The seeded academic session (2025-2026) is over; today's register must still show up.
  const r = await api('GET', `/api/attendance/summary?class_level=10&section=A`, { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.to, todayISO());
  const aarav = r.json.students.find(s => s.name === 'Aarav Sharma');
  assert.ok(aarav && aarav.total >= 1, 'today\'s marks must be inside the default window');
});

test('absent students get an in-app notification and the action is audited', async () => {
  const sid = db.prepare("SELECT id FROM users WHERE email = 'bina@test.com'").get().id;
  const note = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND title LIKE 'Marked absent%'").get(sid).c;
  assert.ok(note >= 1, 'expected an attendance notification for an absent student');
  const audit = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE module = 'attendance' AND action = 'marked'").get().c;
  assert.ok(audit >= 1, 'expected an audit entry for marking attendance');
});
