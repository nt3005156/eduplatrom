// Phase 0: the XP and streak switch is off by default, and when on, only students aged 13+ (by date of birth) earn them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';
import { schoolDate, addDays } from '../src/utils/schoolTime.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-gamif-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'gamif.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-789';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { awardXp, touchStreak, ageOn } = await import('../src/utils/gamification.js');

let server, base;
const PW = 'Gamification-Pass-2026';

// Dates are built from the school's calendar day, the same clock the app uses for age.
const isoYearsAgo = (years, offsetDays = 0) => {
  const [y, m, d] = schoolDate().split('-');
  return addDays(`${Number(y) - years}-${m}-${d}`, offsetDays);
};

function addUser(email, role, dob) {
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  return Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id, dob_ad)
    VALUES (?,?,?,?,'approved','active',?,?)`).run(`User ${email}`, email, bcrypt.hashSync(PW, 4), role, roleId, dob ?? null).lastInsertRowid);
}

const setSwitch = (on) => db.prepare('UPDATE settings SET gamification_enabled = ? WHERE id = 1').run(on ? 1 : 0);
const xpOf = (id) => db.prepare('SELECT xp FROM users WHERE id = ?').get(id).xp;

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('the switch is off by default, so no XP or streak is recorded', () => {
  const row = db.prepare('SELECT gamification_enabled FROM settings WHERE id = 1').get();
  assert.equal(row.gamification_enabled, 0);
  const id = addUser('off-default@test.dev', 'student', isoYearsAgo(15));
  assert.equal(awardXp(id, 'material_view', 'material', 1), null);
  assert.equal(touchStreak(id), null);
  assert.equal(xpOf(id), 0);
});

test('when on, a student aged 13 or older earns XP and a streak', () => {
  setSwitch(true);
  const id = addUser('teen14@test.dev', 'student', isoYearsAgo(14));
  const xp = awardXp(id, 'material_view', 'material', 1);
  assert.ok(xp && xp.xpAwarded > 0);
  assert.ok(touchStreak(id));
  assert.ok(xpOf(id) > 0);
});

test('when on, a student under 13 earns nothing', () => {
  const id = addUser('kid12@test.dev', 'student', isoYearsAgo(12));
  assert.equal(awardXp(id, 'material_view', 'material', 1), null);
  assert.equal(touchStreak(id), null);
  assert.equal(xpOf(id), 0);
});

test('a student who turns 13 today is eligible; one who turns 13 tomorrow is not', () => {
  const today13 = addUser('turns13today@test.dev', 'student', isoYearsAgo(13));
  const tomorrow13 = addUser('turns13tomorrow@test.dev', 'student', isoYearsAgo(13, 1));
  assert.ok(awardXp(today13, 'material_view', 'material', 1));
  assert.equal(awardXp(tomorrow13, 'material_view', 'material', 1), null);
});

test('when on, a student with no date of birth is excluded (fails closed)', () => {
  const id = addUser('nodob@test.dev', 'student', null);
  assert.equal(awardXp(id, 'material_view', 'material', 1), null);
});

test('staff and admins never earn XP or streaks', () => {
  const teacher = addUser('teacher-gamif@test.dev', 'teacher', isoYearsAgo(30));
  const admin = addUser('admin-gamif@test.dev', 'admin', isoYearsAgo(30));
  assert.equal(awardXp(teacher, 'material_view', 'material', 1), null);
  assert.equal(awardXp(admin, 'material_view', 'material', 1), null);
});

test('ageOn counts whole years and handles the birthday boundary and bad input', () => {
  const day = new Date('2026-10-11T12:00:00');
  assert.equal(ageOn('2013-10-11', day), 13);
  assert.equal(ageOn('2013-10-12', day), 12);
  assert.equal(ageOn('2026-10-11', day), 0);
  assert.equal(ageOn('not-a-date', day), 0);
  assert.equal(ageOn(null, day), 0);
});

test('the admin can turn the switch on through the settings API; the value is stored as 0 or 1', async () => {
  setSwitch(false);
  addUser('admin-settings@test.dev', 'admin', null);
  db.prepare("UPDATE users SET approval_status = 'approved' WHERE email = 'admin-settings@test.dev'").run();
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
    body: JSON.stringify({ email: 'admin-settings@test.dev', password: PW }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().find(c => c.startsWith('nitex_session=')).split(';')[0];
  const put = await fetch(base + '/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web', Cookie: cookie },
    body: JSON.stringify({ gamification_enabled: true }),
  });
  assert.equal(put.status, 200, await put.text());
  const row = db.prepare('SELECT gamification_enabled FROM settings WHERE id = 1').get();
  assert.equal(row.gamification_enabled, 1);
});

test('/api/auth/me tells the client whether gamification applies to this user', async () => {
  setSwitch(true);
  addUser('me-teen@test.dev', 'student', isoYearsAgo(15));
  addUser('me-kid@test.dev', 'student', isoYearsAgo(9));
  for (const [email, expected] of [['me-teen@test.dev', true], ['me-kid@test.dev', false]]) {
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' },
      body: JSON.stringify({ email, password: PW }),
    });
    const cookie = login.headers.getSetCookie().find(c => c.startsWith('nitex_session=')).split(';')[0];
    const me = await fetch(base + '/api/auth/me', { headers: { Cookie: cookie, 'X-NITEX-Client': 'web' } });
    const body = await me.json();
    assert.equal(body.user.gamification_enabled, expected, email);
  }
});
