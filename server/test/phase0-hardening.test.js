// Phase 0 hardening: browser session cookie, cross-site write protection,
// session revocation, password policy, CSP, CORS allowlist, health check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-phase0-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'phase0.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.CORS_ORIGINS = 'https://partner.example.org';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const jwt = (await import('jsonwebtoken')).default;

let server, base;
const NEW_PASSWORD = 'Brand-New-Pass-2026';

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
  assert.equal(r.status, 200, `login failed for ${email}: ${r.text}`);
  const session = r.headers.getSetCookie().find(c => c.startsWith('nitex_session=')) || '';
  return { token: r.json.token, cookie: session.split(';')[0], setCookie: session };
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

test('login sets an HttpOnly session cookie that scripts cannot read', async () => {
  const s = await login('admin@nitex.com', 'Admin@123');
  assert.match(s.setCookie, /HttpOnly/);
  assert.match(s.setCookie, /SameSite=Lax/);
  assert.match(s.setCookie, /Path=\//);
  assert.match(s.setCookie, /Max-Age=28800/, 'session lasts 8 hours');
});

test('the session cookie alone authenticates reads', async () => {
  const s = await login('admin@nitex.com', 'Admin@123');
  const r = await call('GET', '/api/auth/me', { cookie: s.cookie, client: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'admin@nitex.com');
});

test('cookie-authenticated writes need the client header (cross-site write protection)', async () => {
  const s = await login('admin@nitex.com', 'Admin@123');
  const blocked = await call('POST', '/api/announcements', { cookie: s.cookie, client: false, body: { title: 'x', body: 'y' } });
  assert.equal(blocked.status, 403, 'a write without the custom header must be refused');
  assert.match(blocked.json.error, /client header/);
});

test('cookie-authenticated writes succeed with the client header', async () => {
  const s = await login('admin@nitex.com', 'Admin@123');
  const r = await call('POST', '/api/auth/logout', { cookie: s.cookie, client: true });
  assert.equal(r.status, 200);
});

test('Bearer tokens keep working for API clients (no header needed)', async () => {
  const s = await login('teacher@nitex.com', 'Teacher@123');
  const r = await call('GET', '/api/auth/me', { token: s.token, client: false });
  assert.equal(r.status, 200);
});

test('logout clears the session cookie', async () => {
  const s = await login('student@nitex.com', 'Student@123');
  const r = await call('POST', '/api/auth/logout', { cookie: s.cookie });
  const cleared = r.headers.getSetCookie().find(c => c.startsWith('nitex_session='));
  assert.match(cleared, /Max-Age=0/);
});

test('a file-download token cannot open the API', async () => {
  const admin = db.prepare("SELECT id, role FROM users WHERE email = 'admin@nitex.com'").get();
  const fileToken = jwt.sign({ id: admin.id, role: admin.role, purpose: 'file' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const r = await call('GET', '/api/auth/me', { token: fileToken, client: false });
  assert.equal(r.status, 401);
});

test('admin password reset ends the teacher\'s existing sessions immediately', async () => {
  const admin = await login('admin@nitex.com', 'Admin@123');
  const created = await call('POST', '/api/teachers', {
    token: admin.token, body: { name: 'Session Test', email: 'session.test@school.test', password: 'Teacher-Original-1', staff_role: 'subject_teacher' },
  });
  assert.equal(created.status, 200, created.text);
  const teacherId = created.json.teacher?.id ?? db.prepare("SELECT id FROM users WHERE email='session.test@school.test'").get().id;

  const before = await login('session.test@school.test', 'Teacher-Original-1');
  assert.equal((await call('GET', '/api/auth/me', { cookie: before.cookie, client: false })).status, 200);

  const reset = await call('PUT', `/api/teachers/${teacherId}/reset-password`, { token: admin.token, body: { new_password: NEW_PASSWORD } });
  assert.equal(reset.status, 200, reset.text);

  const stale = await call('GET', '/api/auth/me', { cookie: before.cookie, client: false });
  assert.equal(stale.status, 401);
  assert.match(stale.json.error, /Session ended/);

  // Log in immediately, in the same second as the reset. This used to be rejected.
  const fresh = await login('session.test@school.test', NEW_PASSWORD);
  assert.equal((await call('GET', '/api/auth/me', { cookie: fresh.cookie, client: false })).status, 200, 'a login right after a reset must work');
});

test('password policy: passwords under 12 characters or on the common list are refused', async () => {
  const admin = await login('admin@nitex.com', 'Admin@123');
  const short = await call('POST', '/api/teachers', { token: admin.token, body: { name: 'Short', email: 'short.pw@school.test', password: 'Abc12345' } });
  assert.equal(short.status, 400);
  assert.match(short.json.error, /at least 12/);

  const common = await call('POST', '/api/teachers', { token: admin.token, body: { name: 'Common', email: 'common.pw@school.test', password: 'Welcome12345' } });
  assert.equal(common.status, 400);
  assert.match(common.json.error, /too common/);

  const reset = await call('PUT', `/api/teachers/${db.prepare("SELECT id FROM users WHERE email='session.test@school.test'").get().id}/reset-password`, { token: admin.token, body: { new_password: 'short' } });
  assert.equal(reset.status, 400, 'an admin-chosen short password must be refused, not silently replaced');
});

test('a disabled teacher loses an active session immediately', async () => {
  const admin = await login('admin@nitex.com', 'Admin@123');
  const teacher = await login('session.test@school.test', NEW_PASSWORD);
  const id = db.prepare("SELECT id FROM users WHERE email='session.test@school.test'").get().id;
  const r = await call('PUT', `/api/teachers/${id}/status`, { token: admin.token, body: { account_status: 'disabled' } });
  assert.equal(r.status, 200, r.text);
  const after = await call('GET', '/api/auth/me', { cookie: teacher.cookie, client: false });
  assert.equal(after.status, 401);
});

test('CSP allows only the app\'s own scripts, plus Google Fonts for styles and fonts', async () => {
  const r = await call('GET', '/api/health', { client: false });
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'Content-Security-Policy header is present');
  assert.match(csp, /script-src 'self'(;|$)/, 'scripts: same origin only');
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-/, 'no unsafe-inline or unsafe-eval for scripts');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.equal(r.headers.get('x-powered-by'), null, 'server identity is hidden');
});

test('CORS: an unlisted website gets no access; the allowlisted partner does', async () => {
  const evil = await call('GET', '/api/health', { client: false, headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const partner = await call('GET', '/api/health', { client: false, headers: { Origin: 'https://partner.example.org' } });
  assert.equal(partner.headers.get('access-control-allow-origin'), 'https://partner.example.org');
});

test('health check runs a database query and reports ok', async () => {
  const r = await call('GET', '/api/health', { client: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.db, true);
  assert.equal(typeof r.json.uptime_s, 'number');
});

test('the student ad slot has been removed from the app', async () => {
  const adFile = path.resolve(here, '../../client/src/components/AdSlot.jsx');
  assert.equal(fs.existsSync(adFile), false, 'AdSlot.jsx must be deleted');
  const dash = fs.readFileSync(path.resolve(here, '../../client/src/pages/student/Dashboard.jsx'), 'utf8');
  assert.doesNotMatch(dash, /AdSlot/, 'student dashboard must not reference ads');
});
