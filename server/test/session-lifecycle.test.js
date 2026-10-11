// Phase 0: short access tokens with rotating refresh tokens, reuse detection, revocation, and account lockout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-session-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'session.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-456';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { revokeSessions } = await import('../src/middleware/auth.js');
const { purgeExpiredRefreshTokens } = await import('../src/services/sessions.js');

let server, base;
const PW = 'Session-Test-Pass-2026';

async function call(method, url, { cookie, client = true, body, token } = {}) {
  const h = {};
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (token) h.Authorization = `Bearer ${token}`;
  if (client) h['X-NITEX-Client'] = 'web';
  const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers, cookies: res.headers.getSetCookie() };
}

const cookieValue = (cookies, name) => {
  const c = cookies.find(x => x.startsWith(`${name}=`));
  return c ? c.split(';')[0] : null;
};

function addUser(email, extra = {}) {
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  return Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id)
    VALUES (?,?,?,'admin','approved', 'active', ?)`).run(`User ${email}`, email, bcrypt.hashSync(PW, 4), roleId).lastInsertRowid);
}

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

async function webLogin(email) {
  const r = await call('POST', '/api/auth/login', { body: { email, password: PW } });
  assert.equal(r.status, 200, r.json?.error);
  return { access: cookieValue(r.cookies, 'nitex_session'), refresh: cookieValue(r.cookies, 'nitex_refresh'), body: r.json, setCookies: r.cookies };
}

test('web login: the refresh token is only an HttpOnly cookie scoped to /api/auth, never in the body', async () => {
  addUser('rot-web@test.dev');
  const r = await call('POST', '/api/auth/login', { body: { email: 'rot-web@test.dev', password: PW } });
  const refreshSet = r.cookies.find(c => c.startsWith('nitex_refresh='));
  assert.ok(refreshSet, 'refresh cookie set');
  assert.match(refreshSet, /HttpOnly/);
  assert.match(refreshSet, /Path=\/api\/auth/);
  assert.match(refreshSet, /SameSite=Lax/);
  assert.equal(r.json.refresh_token, undefined, 'web clients do not get the refresh token in the body');
});

test('refresh rotates both tokens; the new access token works and the old refresh token cannot be used again', async () => {
  addUser('rotate@test.dev');
  const first = await webLogin('rotate@test.dev');
  const r1 = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(r1.status, 200, r1.json?.error);
  const newAccess = cookieValue(r1.cookies, 'nitex_session');
  const newRefresh = cookieValue(r1.cookies, 'nitex_refresh');
  assert.ok(newAccess && newRefresh && newRefresh !== first.refresh);
  const me = await call('GET', '/api/auth/me', { cookie: newAccess });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'rotate@test.dev');
});

test('reusing a refresh token long after it was used ends the whole session family', async () => {
  addUser('reuse@test.dev');
  const first = await webLogin('reuse@test.dev');
  const r1 = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  const second = cookieValue(r1.cookies, 'nitex_refresh');
  // Simulate the old token being replayed later than the grace window (30 seconds).
  db.prepare(`UPDATE refresh_tokens SET used_at = datetime('now', '-120 seconds') WHERE used_at IS NOT NULL
    AND user_id = (SELECT id FROM users WHERE email = 'reuse@test.dev')`).run();
  const replay = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(replay.status, 401);
  // The legitimate new token is now dead too.
  const after = await call('POST', '/api/auth/refresh', { cookie: second });
  assert.equal(after.status, 401, 'the family was revoked after reuse');
});

test('a quick second use within the grace window (two tabs) is refused but does not log the user out', async () => {
  addUser('tabs@test.dev');
  const first = await webLogin('tabs@test.dev');
  const r1 = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  const second = cookieValue(r1.cookies, 'nitex_refresh');
  const twoTabs = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(twoTabs.status, 401);
  const still = await call('POST', '/api/auth/refresh', { cookie: second });
  assert.equal(still.status, 200, 'the newer token still works');
});

test('refresh needs the client header when the cookie is used (cross-site protection)', async () => {
  addUser('hdr@test.dev');
  const first = await webLogin('hdr@test.dev');
  const r = await call('POST', '/api/auth/refresh', { cookie: first.refresh, client: false });
  assert.equal(r.status, 403);
});

test('a password reset (session revocation) ends refresh as well as the access token', async () => {
  const uid = addUser('revoke@test.dev');
  const first = await webLogin('revoke@test.dev');
  revokeSessions(uid);
  const r = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(r.status, 401);
  const me = await call('GET', '/api/auth/me', { cookie: first.access });
  assert.equal(me.status, 401);
});

test('a session ends after its absolute maximum age, even while it keeps renewing', async () => {
  addUser('maxage@test.dev');
  const first = await webLogin('maxage@test.dev');
  const r1 = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(r1.status, 200);
  const latest = cookieValue(r1.cookies, 'nitex_refresh');
  // Backdate the whole sign-in family by 31 days (the default maximum is 30).
  db.prepare(`UPDATE refresh_tokens SET created_at = datetime('now', '-31 days')
    WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE email = 'maxage@test.dev') AND revoked_at IS NULL ORDER BY id DESC LIMIT 1)`).run();
  const r2 = await call('POST', '/api/auth/refresh', { cookie: latest });
  assert.equal(r2.status, 401, 'an old sign-in cannot be renewed');
  const still = await call('POST', '/api/auth/refresh', { cookie: cookieValue(r1.cookies, 'nitex_refresh') });
  assert.equal(still.status, 401, 'and the whole family is ended');
});

test('a disabled account cannot refresh', async () => {
  const uid = addUser('disabled@test.dev');
  const first = await webLogin('disabled@test.dev');
  db.prepare("UPDATE users SET account_status = 'disabled' WHERE id = ?").run(uid);
  const r = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(r.status, 401);
});

test('logout revokes the refresh token it was given', async () => {
  addUser('logout@test.dev');
  const first = await webLogin('logout@test.dev');
  const out = await call('POST', '/api/auth/logout', { cookie: `${first.access}; ${first.refresh}` });
  assert.equal(out.status, 200);
  const r = await call('POST', '/api/auth/refresh', { cookie: first.refresh });
  assert.equal(r.status, 401, 'an old refresh token cannot renew after logout');
  const cleared = out.cookies.find(c => c.startsWith('nitex_refresh='));
  assert.match(cleared, /Max-Age=0/);
});

test('API clients (no web header) get the refresh token in the body and renew with it', async () => {
  addUser('api@test.dev');
  const r = await call('POST', '/api/auth/login', { client: false, body: { email: 'api@test.dev', password: PW } });
  assert.equal(r.status, 200);
  assert.ok(r.json.refresh_token, 'refresh token in the body for API clients');
  assert.equal(r.cookies.find(c => c.startsWith('nitex_refresh=')), undefined);
  const renewed = await call('POST', '/api/auth/refresh', { client: false, body: { refresh_token: r.json.refresh_token } });
  assert.equal(renewed.status, 200);
  assert.ok(renewed.json.token && renewed.json.refresh_token && renewed.json.refresh_token !== r.json.refresh_token);
  const me = await call('GET', '/api/auth/me', { client: false, token: renewed.json.token });
  assert.equal(me.status, 200);
});

test('refresh tokens are stored only as hashes', async () => {
  const rows = db.prepare('SELECT token_hash FROM refresh_tokens').all();
  assert.ok(rows.length > 0);
  for (const r of rows) assert.match(r.token_hash, /^[0-9a-f]{64}$/);
});

test('expired refresh tokens are purged', async () => {
  const uid = db.prepare("SELECT id FROM users WHERE email = 'api@test.dev'").get().id;
  db.prepare(`INSERT INTO refresh_tokens (user_id, family_id, token_hash, session_version, expires_at)
    VALUES (?, 'old-family', ?, 0, datetime('now', '-3 days'))`).run(uid, 'a'.repeat(64));
  assert.ok(purgeExpiredRefreshTokens() >= 1);
});

// ---- Lockout --------------------------------------------------------------------
test('lockout: 10 wrong passwords lock the account; the correct password is refused while locked', async () => {
  addUser('lock@test.dev');
  for (let i = 1; i <= 9; i++) {
    const r = await call('POST', '/api/auth/login', { body: { email: 'lock@test.dev', password: 'wrong-password-x' } });
    assert.equal(r.status, 401, `attempt ${i} is an ordinary failure`);
  }
  const tenth = await call('POST', '/api/auth/login', { body: { email: 'lock@test.dev', password: 'wrong-password-x' } });
  assert.equal(tenth.status, 429);
  assert.equal(tenth.json.locked, true);
  const correct = await call('POST', '/api/auth/login', { body: { email: 'lock@test.dev', password: PW } });
  assert.equal(correct.status, 429, 'the correct password does not get in during the lock');
});

test('lockout expires after 15 minutes and a successful sign-in clears the counter', async () => {
  const id = db.prepare("SELECT id FROM users WHERE email = 'lock@test.dev'").get().id;
  db.prepare(`UPDATE users SET locked_until = datetime('now', '-1 minute') WHERE id = ?`).run(id);
  const ok = await call('POST', '/api/auth/login', { body: { email: 'lock@test.dev', password: PW } });
  assert.equal(ok.status, 200);
  const row = db.prepare('SELECT failed_login_count, locked_until FROM users WHERE id = ?').get(id);
  assert.equal(row.failed_login_count, 0);
  assert.equal(row.locked_until, null);
});

test('lockout: a few failures followed by success never lock the account', async () => {
  addUser('few@test.dev');
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { email: 'few@test.dev', password: 'nope-nope-nope' } });
  const ok = await call('POST', '/api/auth/login', { body: { email: 'few@test.dev', password: PW } });
  assert.equal(ok.status, 200);
});

test('lockout is recorded in the audit log', async () => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'account_locked'").get();
  assert.ok(row.c >= 1);
});

test('lockout is per account: another user is unaffected', async () => {
  const r = await call('POST', '/api/auth/login', { body: { email: 'few@test.dev', password: PW } });
  assert.equal(r.status, 200);
});
