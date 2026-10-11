// Refresh tokens. The access token (JWT, 15 minutes) is short. The refresh token is long-lived but stored
// only as a SHA-256 hash, can be revoked, and is rotated on every use.
//
// Rotation and reuse detection:
//  - Each refresh returns a new refresh token in the same "family" and marks the old one used.
//  - If a token that was already used comes back, someone copied it. The whole family is revoked.
//    Exception: a reuse within REUSE_GRACE_SECONDS (two tabs refreshing at the same moment) is refused
//    but does not revoke the family, so a normal user is not logged out of both tabs.
//  - A password reset, disable, archive or anonymize bumps session_version. Refresh checks it, so the
//    refresh token dies with the access tokens.
import crypto from 'crypto';
import db from '../db/index.js';

export const REFRESH_COOKIE = 'nitex_refresh';
export const REFRESH_TTL_SECONDS = 8 * 60 * 60;   // one school day
// Absolute cap on one sign-in. Renewal keeps a session alive while the browser is in use, so this limit
// forces a fresh sign-in at least this often, whatever the activity. Default 30 days.
export const SESSION_MAX_SECONDS = (Number(process.env.SESSION_MAX_DAYS) || 30) * 24 * 60 * 60;
export const ACCESS_TTL_SECONDS = 15 * 60;        // access token lifetime
const REUSE_GRACE_SECONDS = 30;

const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');

/** Creates a refresh token for a user. Returns the plain token (only ever sent to the client once). */
export function issueRefreshToken(userId, sessionVersion, familyId = crypto.randomUUID()) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO refresh_tokens (user_id, family_id, token_hash, session_version, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', ?))`).run(userId, familyId, sha256(token), sessionVersion, `+${REFRESH_TTL_SECONDS} seconds`);
  return token;
}

export function revokeFamily(familyId) {
  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE family_id = ? AND revoked_at IS NULL`).run(familyId);
}

/** Revokes every refresh token for a user. Used with session_version bumps, and for anonymize. */
export function revokeAllRefreshTokens(userId) {
  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(userId);
}

/** Logout: revokes the family of the presented token, if any. */
export function revokeByToken(token) {
  if (!token) return;
  const row = db.prepare('SELECT family_id FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  if (row) revokeFamily(row.family_id);
}

/**
 * Exchanges a refresh token for a new one. Returns { userId, refreshToken, familyId } or
 * { error } with a short reason for the audit log. Never returns the old token.
 */
export function rotateRefreshToken(token) {
  if (!token) return { error: 'missing' };
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  if (!row) return { error: 'unknown' };

  if (row.revoked_at) return { error: 'revoked' };
  if (row.used_at) {
    const age = db.prepare(`SELECT (julianday('now') - julianday(?)) * 86400 AS s`).get(row.used_at).s;
    if (age > REUSE_GRACE_SECONDS) revokeFamily(row.family_id);   // a replayed token: treat as theft
    return { error: 'reused' };
  }
  const expired = db.prepare(`SELECT datetime('now') > ? AS e`).get(row.expires_at).e;
  if (expired) return { error: 'expired' };

  const started = db.prepare('SELECT MIN(created_at) AS s FROM refresh_tokens WHERE family_id = ?').get(row.family_id).s;
  const sessionAge = db.prepare(`SELECT (julianday('now') - julianday(?)) * 86400 AS s`).get(started).s;
  if (sessionAge > SESSION_MAX_SECONDS) { revokeFamily(row.family_id); return { error: 'session_too_old' }; }

  const acct = db.prepare('SELECT account_status, session_version FROM users WHERE id = ?').get(row.user_id);
  if (!acct || (acct.account_status && acct.account_status !== 'active')) { revokeFamily(row.family_id); return { error: 'inactive' }; }
  if ((acct.session_version || 0) !== row.session_version) { revokeFamily(row.family_id); return { error: 'session_ended' }; }

  // Claim the old token atomically. If another request got there first, this one is a reuse.
  const claim = db.prepare(`UPDATE refresh_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`).run(row.id);
  if (claim.changes === 0) return { error: 'reused' };

  const refreshToken = issueRefreshToken(row.user_id, row.session_version, row.family_id);
  return { userId: row.user_id, refreshToken, familyId: row.family_id, sessionVersion: row.session_version };
}

/** Removes refresh tokens that expired more than a day ago. Run from the daily job. */
export function purgeExpiredRefreshTokens() {
  return db.prepare(`DELETE FROM refresh_tokens WHERE expires_at < datetime('now', '-1 day')`).run().changes;
}
