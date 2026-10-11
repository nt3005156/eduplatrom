// Phase 5: each user's interface language is stored, returned at /me, and validated.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-lang-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'lang.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-lang';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
let server, base, token;
const PW = 'Lang-Test-Pass-2026';

async function call(method, url, { body, auth = token } = {}) {
  const h = { 'X-NITEX-Client': 'web' };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) h.Authorization = `Bearer ${auth}`;
  const res = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id)
    VALUES ('Lang User', 'lang.user@test.dev', ?, 'admin', 'approved', 'active', ?)`).run(bcrypt.hashSync(PW, 4), roleId);
  const r = await call('POST', '/api/auth/login', { body: { email: 'lang.user@test.dev', password: PW }, auth: null });
  assert.equal(r.status, 200);
  token = r.json.token;
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a new account has no language set (the school default applies)', async () => {
  const me = await call('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.language, null);
});

test('Nepali is saved and comes back on /me', async () => {
  const r = await call('PUT', '/api/auth/me/language', { body: { language: 'ne' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.language, 'ne');
  const me = await call('GET', '/api/auth/me');
  assert.equal(me.json.user.language, 'ne');
});

test('English can be chosen again, and null clears the choice', async () => {
  assert.equal((await call('PUT', '/api/auth/me/language', { body: { language: 'en' } })).json.user.language, 'en');
  assert.equal((await call('PUT', '/api/auth/me/language', { body: { language: null } })).json.user.language, null);
});

test('unsupported languages are refused and nothing changes', async () => {
  await call('PUT', '/api/auth/me/language', { body: { language: 'ne' } });
  for (const bad of ['fr', 'NE', '', 'ne-NP', 42, ['ne']]) {
    const r = await call('PUT', '/api/auth/me/language', { body: { language: bad } });
    assert.equal(r.status, 400, `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal((await call('GET', '/api/auth/me')).json.user.language, 'ne');
});

test('the language endpoint needs a signed-in user', async () => {
  const r = await call('PUT', '/api/auth/me/language', { body: { language: 'ne' }, auth: null });
  assert.equal(r.status, 401);
});
