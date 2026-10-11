// School-local dates (Asia/Kathmandu, not UTC) and sign-in rate limits that count only failed attempts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-time-limits-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'time.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-789';

const { schoolDate, schoolHour, addDays, daysBetweenDates } = await import('../src/utils/schoolTime.js');
const { ageOn } = await import('../src/utils/gamification.js');

// ---- school-local dates --------------------------------------------------------------------------

test('schoolDate uses the Kathmandu calendar day, not the UTC day', () => {
  // 18:15 UTC is midnight in Kathmandu (UTC+05:45): the school date has already moved on.
  assert.equal(schoolDate(new Date('2026-10-11T18:15:00Z')), '2026-10-12');
  assert.equal(schoolDate(new Date('2026-10-11T18:14:59Z')), '2026-10-11');
});

test('schoolDate reads SQLite UTC timestamps as UTC', () => {
  assert.equal(schoolDate('2026-10-11 20:18:53'), '2026-10-12');
  assert.equal(schoolDate('2026-10-11 10:00:00'), '2026-10-11');
});

test('schoolHour is the Kathmandu hour of day', () => {
  assert.equal(schoolHour(new Date('2026-10-11T12:30:00Z')), 18); // 18:15 local
  assert.equal(schoolHour(new Date('2026-10-11T18:15:00Z')), 0);  // midnight local
});

test('addDays does calendar arithmetic across month and year ends', () => {
  assert.equal(addDays('2026-10-12', -30), '2026-09-12');
  assert.equal(addDays('2026-01-05', -10), '2025-12-26');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // leap year
  assert.equal(daysBetweenDates('2026-10-01', '2026-10-12'), 11);
});

test('age changes on the school birthday, not at UTC midnight', () => {
  // DOB 12 Oct 2013. At 18:30 UTC on 11 Oct it is already 00:15 on 12 Oct in Kathmandu: 13 years old.
  assert.equal(ageOn('2013-10-12', new Date('2026-10-11T18:30:00Z')), 13);
  // One second earlier it is still 23:59:59 on 11 Oct locally: 12 years old.
  assert.equal(ageOn('2013-10-12', new Date('2026-10-11T18:14:59Z')), 12);
  assert.equal(ageOn('not-a-date'), 0);
});

// ---- sign-in rate limits ------------------------------------------------------------------------

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
let server, base;
const PW = 'Limit-Test-Pass-2026';

async function login(email, password = PW) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id)
    VALUES ('Limit Admin', 'limit.admin@test.dev', ?, 'admin', 'approved', 'active', ?)`).run(bcrypt.hashSync(PW, 4), roleId);
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('successful sign-ins are never counted against the limit', async () => {
  for (let i = 0; i < 30; i++) {
    const r = await login('limit.admin@test.dev');
    assert.equal(r.status, 200, `sign-in ${i + 1} should succeed`);
  }
});

test('20 wrong passwords for one account from one connection are limited (21st is 429)', async () => {
  for (let i = 1; i <= 20; i++) {
    const r = await login('ghost.one@test.dev', 'wrong-password-x');
    assert.equal(r.status, 401, `failure ${i} is an ordinary 401`);
  }
  const blocked = await login('ghost.one@test.dev', 'wrong-password-x');
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /Too many attempts/);
});

test('the limit is per account too: another account from the same connection still gets a normal answer', async () => {
  const other = await login('ghost.two@test.dev', 'wrong-password-x');
  assert.equal(other.status, 401, 'a shared office connection must not lock out other people');
  const real = await login('limit.admin@test.dev');
  assert.equal(real.status, 200, 'a real account still signs in from the same connection');
});
