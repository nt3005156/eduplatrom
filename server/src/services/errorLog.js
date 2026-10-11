// Phase 0: error tracking that needs no third-party account. Each distinct error is stored once with a
// count, so a broken endpoint shows up as one row that keeps growing, not as thousands of log lines.
// Privacy: only a redacted message, the top stack frame, and the route are kept. Request bodies,
// headers and cookies are never read here.
import crypto from 'crypto';
import db from '../db/index.js';

const MAX_MESSAGE = 300;

/** Remove values that identify people or carry credentials before the message is stored. */
export function redact(text) {
  return String(text || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [token]')
    .replace(/(password|secret|token|cookie)(["'\s:=]+)[^\s"',;}&]+/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE);
}

function topFrame(stack) {
  const line = String(stack || '').split('\n').find(l => l.trim().startsWith('at ') && !l.includes('node:internal'));
  if (!line) return null;
  // Keep the function name and the path from src/ onwards; drop the absolute host path prefix.
  return redact(line.trim().replace(/^at\s+/, '').replace(/\(?[^\s()]*?[\\/](src[\\/][^\s()]*)\)?$/, (m, rel) => rel)).slice(0, 200);
}

/** Record an error. Never throws: error tracking must not break the request that failed. */
export function captureError(err, { route = null, status = 500 } = {}) {
  try {
    const name = err?.name || 'Error';
    const message = redact(err?.message || String(err));
    const location = topFrame(err?.stack);
    const safeRoute = route ? redact(route).slice(0, 120) : null;
    const fingerprint = crypto.createHash('sha256').update(`${name}|${message}|${location || ''}|${safeRoute || ''}`).digest('hex');
    db.prepare(`INSERT INTO error_events (fingerprint, message, location, route, status)
      VALUES (?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_seen = datetime('now'), status = excluded.status`)
      .run(fingerprint, `${name}: ${message}`.slice(0, MAX_MESSAGE), location, safeRoute, status);
    return fingerprint;
  } catch {
    return null;
  }
}

/** Recent errors, most recent first, for the admin view. */
export function listErrors({ limit = 100 } = {}) {
  return db.prepare('SELECT * FROM error_events ORDER BY last_seen DESC, count DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 500));
}
