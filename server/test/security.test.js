// Security regression tests: fail-closed scope, production startup guard,
// production seeding, and the login-page demo accounts never being exposed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-sec-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'sec.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { resolveScope } = await import('../src/services/scope.js');
const { signToken } = await import('../src/middleware/auth.js');

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); try { db.close(); } catch {} fs.rmSync(tmpDir, { recursive: true, force: true }); });

test('a user with no resolvable role gets NO scope (fail closed)', () => {
  const info = db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id)
    VALUES ('Orphan','orphan@test.com','x','teacher','approved','active', NULL)`).run();
  const scope = resolveScope({ id: info.lastInsertRowid, role: 'teacher' });
  assert.equal(scope.unrestricted, false, 'role-less user must not be unrestricted');
  assert.deepEqual(scope.classSections, []);
  assert.deepEqual(scope.subjectAssignments, []);
});

test('a token for a role-less teacher cannot read attendance', async () => {
  const id = db.prepare("SELECT id FROM users WHERE email='orphan@test.com'").get().id;
  const token = signToken({ id, role: 'teacher', name: 'Orphan', email: 'orphan@test.com' });
  const res = await fetch(`${base}/api/attendance/roster?class_level=10&section=A`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 403);
});

test('unknown /api paths return JSON 404, not the web app shell', async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /json/);
});

test('production refuses to start without a real JWT_SECRET', () => {
  const env = { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', DB_PATH: path.join(tmpDir, 'prod1.db') };
  const r = spawnSync(process.execPath, ['-e', "import('./src/middleware/auth.js').catch(e=>{console.error(e.message);process.exit(3)})"], { cwd: serverDir, env, encoding: 'utf8' });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /JWT_SECRET must be set/);
});

test('production does not create demo accounts unless SEED_DEMO=true', () => {
  const dbPath = path.join(tmpDir, 'prod2.db');
  const env = { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(40), DB_PATH: dbPath, SEED_DEMO: '', ADMIN_EMAIL: 'boss@school.edu', ADMIN_PASSWORD: 'LongEnough1!' };
  const code = "const {default:db}=await import('./src/db/index.js'); await import('./src/db/seed.js'); console.log(JSON.stringify(db.prepare('SELECT email, role FROM users').all()));";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: serverDir, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const users = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(users, [{ email: 'boss@school.edu', role: 'admin' }], 'only the bootstrap admin may exist in production');
});

test('the login page only shows demo quick-fill buttons in development builds', () => {
  const src = fs.readFileSync(path.resolve(serverDir, '../client/src/pages/auth/Login.jsx'), 'utf8');
  assert.match(src, /import\.meta\.env\.DEV && \(/);
});
