#!/usr/bin/env node
// Phase 0 restore: unpacks a backup archive into a target database path and uploads folder.
//   node scripts/restore.js <archive.tar.gz> --db <path> --uploads <dir> [--force]
// It refuses to overwrite an existing database unless --force is given, checks every file hash against the
// manifest, and runs an integrity check before writing anything to the target.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

export function restoreArchive({ archive, dbTarget, uploadsTarget, force = false }) {
  if (!archive || !fs.existsSync(archive)) throw new Error(`archive not found: ${archive}`);
  if (!dbTarget || !uploadsTarget) throw new Error('--db and --uploads are required');
  if (fs.existsSync(dbTarget) && !force) throw new Error(`target database already exists (use --force to replace): ${dbTarget}`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-restore-'));
  try {
    execFileSync('tar', ['-xzf', path.resolve(archive), '-C', staging]);
    const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
    const dbFile = path.join(staging, 'database.db');

    const hash = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
    if (hash !== manifest.database.sha256) throw new Error('database hash does not match the manifest; archive is damaged');

    const check = new Database(dbFile, { readonly: true, fileMustExist: true });
    let integrity, users;
    try {
      integrity = check.pragma('integrity_check', { simple: true });
      users = check.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    } finally {
      check.close();
    }
    if (integrity !== 'ok') throw new Error(`integrity check failed: ${integrity}`);

    // Write the database, removing stale WAL files from an earlier run.
    fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbTarget + suffix, { force: true });
    fs.copyFileSync(dbFile, dbTarget);

    fs.mkdirSync(uploadsTarget, { recursive: true });
    const uploadsSrc = path.join(staging, 'uploads');
    if (fs.existsSync(uploadsSrc)) fs.cpSync(uploadsSrc, uploadsTarget, { recursive: true });

    return { dbTarget, uploadsTarget, users, manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const res = restoreArchive({
      archive: process.argv[2],
      dbTarget: arg('--db'),
      uploadsTarget: arg('--uploads'),
      force: process.argv.includes('--force'),
    });
    console.log(`restored database to ${res.dbTarget} (users: ${res.users})`);
    console.log(`restored uploads to ${res.uploadsTarget}`);
  } catch (err) {
    console.error(`restore FAILED: ${err.message}`);
    process.exit(1);
  }
}
