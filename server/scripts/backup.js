#!/usr/bin/env node
// Phase 0 backup: one archive per run, containing a consistent copy of the database and the uploads folder.
//   node scripts/backup.js                 (uses DB_PATH, UPLOADS_DIR, BACKUP_DIR, BACKUP_KEEP)
// The database is copied with VACUUM INTO, which gives a consistent snapshot even while the app is writing (WAL mode).
// Each archive has a manifest with SHA-256 hashes; the copy is re-opened and integrity-checked before the run succeeds.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(here, '..');
const DB_PATH = process.env.DB_PATH || path.join(SERVER_DIR, 'src', 'db', 'nitex.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(SERVER_DIR, 'src', 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(SERVER_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 14);

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function runBackup({ dbPath = DB_PATH, uploadsDir = UPLOADS_DIR, backupDir = BACKUP_DIR, keep = KEEP } = {}) {
  if (!fs.existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-backup-'));
  try {
    const snapshot = path.join(staging, 'database.db');
    const src = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      src.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    } finally {
      src.close();
    }

    // Check the copy itself before trusting it.
    const copy = new Database(snapshot, { readonly: true, fileMustExist: true });
    let integrity, counts;
    try {
      integrity = copy.pragma('integrity_check', { simple: true });
      counts = {
        users: copy.prepare('SELECT COUNT(*) AS c FROM users').get().c,
        schema_tables: copy.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get().c,
      };
    } finally {
      copy.close();
    }
    if (integrity !== 'ok') throw new Error(`integrity check failed on the backup copy: ${integrity}`);

    const manifest = {
      created_at: new Date().toISOString(),
      database: { file: 'database.db', sha256: sha256(snapshot), bytes: fs.statSync(snapshot).size, counts },
      uploads: { folder: 'uploads', files: countFiles(uploadsDir) },
      node: process.version,
    };
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const archive = path.join(backupDir, `nitex-${stamp}.tar.gz`);
    // Two -C options: the snapshot and manifest come from staging, the uploads from the app folder.
    execFileSync('tar', ['-czf', archive, '-C', staging, 'database.db', 'manifest.json', '-C', path.dirname(uploadsDir), path.basename(uploadsDir)]);

    pruneOld(backupDir, keep);
    return { archive, manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else if (e.isFile()) n += 1;
  }
  return n;
}

function pruneOld(dir, keep) {
  if (!keep || keep < 1) return;
  const files = fs.readdirSync(dir).filter(f => /^nitex-.*\.tar\.gz$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { archive, manifest } = runBackup();
    console.log(`backup written: ${archive}`);
    console.log(`users in backup: ${manifest.database.counts.users}; uploads files: ${manifest.uploads.files}`);
  } catch (err) {
    console.error(`backup FAILED: ${err.message}`);
    process.exit(1);
  }
}
