// One-time setup links. An admin creates an account (guardian or student) and gets a
// link; the person opens it and chooses their own password. Only a SHA-256 hash of the
// token is stored, so a database leak does not expose live links.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { passwordProblem } from '../utils/passwordPolicy.js';
import { revokeSessions } from '../middleware/auth.js';

export const SETUP_TTL_DAYS = 7;

const hashToken = raw => crypto.createHash('sha256').update(raw).digest('hex');

/** Creates a fresh link for the user and voids any earlier unused link. Returns the raw token. */
export function createSetupToken(userId, createdBy = null) {
  const raw = crypto.randomBytes(32).toString('base64url');
  db.prepare(`UPDATE account_setup_tokens SET used_at = datetime('now')
              WHERE user_id = ? AND used_at IS NULL`).run(userId);
  db.prepare(`INSERT INTO account_setup_tokens (user_id, token_hash, expires_at, created_by)
              VALUES (?, ?, datetime('now', ?), ?)`).run(userId, hashToken(raw), `+${SETUP_TTL_DAYS} days`, createdBy);
  return raw;
}

/** Returns { token_id, user_id, name, role, expires_at } for a usable link, else null. */
export function findUsableSetup(raw) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 128) return null;
  return db.prepare(`
    SELECT t.id AS token_id, t.user_id, t.expires_at, u.name, u.role, u.account_status
    FROM account_setup_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > datetime('now')`).get(hashToken(raw)) || null;
}

/** Sets the password and spends the link. Throws an Error with .status on failure. */
export function completeSetup(raw, password) {
  const row = findUsableSetup(raw);
  if (!row) throw Object.assign(new Error('This link has expired or was already used. Ask the school for a new one.'), { status: 404 });
  if (row.account_status && row.account_status !== 'active') {
    throw Object.assign(new Error('This account is not active. Contact the school.'), { status: 403 });
  }
  const problem = passwordProblem(password);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), row.user_id);
    db.prepare(`UPDATE account_setup_tokens SET used_at = datetime('now') WHERE id = ?`).run(row.token_id);
    revokeSessions(row.user_id);
  });
  tx();
  return row;
}

/** A random password nobody knows. Used until the person sets their own through a link. */
export function unknownPasswordHash() {
  return bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
}
