// Upgrade path for an existing school database: users.role must gain 'guardian'
// without losing rows, columns, or child records (a cascade would silently wipe data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaText = fs.readFileSync(path.join(here, '..', 'src', 'db', 'schema.sql'), 'utf-8');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-migrate-'));
const dbPath = path.join(tmpDir, 'legacy.db');

// 1. Build a database as the pre-guardian release left it: old role CHECK,
//    a column added by a later migration, and real child rows.
const legacySchema = schemaText.replace("CHECK(role IN ('student','teacher','admin','guardian'))", "CHECK(role IN ('student','teacher','admin'))");
assert.notEqual(legacySchema, schemaText, 'test setup: role CHECK not found in schema.sql');
{
  const old = new Database(dbPath);
  old.exec(legacySchema);
  old.exec('ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0');
  old.prepare("INSERT INTO users (id, name, email, password_hash, role, class_level, section, session_version) VALUES (1,'Admin','admin@x.test','h','admin',NULL,NULL,4)").run();
  old.prepare("INSERT INTO users (id, name, email, password_hash, role, class_level, section, session_version) VALUES (2,'Asha','asha@x.test','h','student',7,'A',2)").run();
  old.prepare("INSERT INTO attendance_records (student_id, class_level, section, date, status, marked_by) VALUES (2, 7, 'A', '2026-10-01', 'present', 1)").run();
  old.close();
}

// 2. Open it with the current code. The migration runs on import.
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
const { default: db } = await import('../src/db/index.js');

test('upgrade keeps every user row and column', () => {
  const users = db.prepare('SELECT id, name, email, role, session_version FROM users ORDER BY id').all();
  assert.deepEqual(users.map(u => u.id), [1, 2]);
  assert.equal(users[0].session_version, 4, 'session_version must survive the rebuild');
  assert.equal(users[1].session_version, 2);
});

test('upgrade keeps child records (no cascade delete)', () => {
  const n = db.prepare('SELECT COUNT(*) c FROM attendance_records').get().c;
  assert.equal(n, 1, 'attendance row was removed during the users rebuild');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('upgrade allows the guardian role and still enforces the CHECK', () => {
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Parent','parent@x.test','h','guardian')").run();
  assert.throws(() => db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Bad','bad@x.test','h','janitor')").run(), /CHECK/);
});

test('upgrade keeps the users indexes and writes a backup', () => {
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'").all().map(r => r.name);
  assert.ok(idx.includes('idx_users_role'), `indexes after upgrade: ${idx}`);
  const backups = fs.readdirSync(tmpDir).filter(f => f.includes('.pre-guardian-'));
  assert.equal(backups.length, 1, 'expected one pre-migration backup');
  const copy = new Database(path.join(tmpDir, backups[0]), { readonly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) c FROM users').get().c, 2, 'backup holds the pre-upgrade rows');
  copy.close();
});

test('a second start does not migrate again', async () => {
  db.close();
  const { default: again } = await import('../src/db/index.js?second-start');
  assert.equal(again.prepare('SELECT COUNT(*) c FROM users').get().c, 3);
});
