import db from '../db/index.js';

const insertAudit = db.prepare(`
  INSERT INTO audit_logs (user_id, user_name, user_role, module, action, description, ip_address, user_agent, status, previous_value, new_value, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function safeStringify(value) {
  if (value === undefined || value === null) return null;
  try { return JSON.stringify(value); } catch { return null; }
}

function extractIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || null;
}

// Actions that represent something failing rather than succeeding — used to
// auto-derive `status` when the caller doesn't explicitly pass one, so every
// existing logAudit() call site across the codebase gets a correct Status
// column for free without needing to be individually updated.
const FAILURE_ACTIONS = new Set(['failed_login', 'rejected', 'rejected_invalid', 'denied']);

/**
 * Record an entry in the enterprise audit log.
 *
 * @param {import('express').Request} [req] - the originating request, used to pull user/IP/user-agent.
 *   Pass null for system-initiated events that have no request context.
 * @param {object} opts
 * @param {string} opts.module - e.g. 'auth', 'users', 'assignments', 'quizzes', 'content', 'settings', 'applications'
 * @param {string} opts.action - e.g. 'login', 'created', 'updated', 'deleted', 'approved', 'rejected'
 * @param {string} [opts.description]
 * @param {'success'|'failure'} [opts.status] - defaults to 'failure' for known failure actions (e.g. failed_login), else 'success'.
 * @param {object|null} [opts.previousValue]
 * @param {object|null} [opts.newValue]
 * @param {object} [opts.metadata]
 * @param {object} [opts.actorOverride] - override the acting user when req.user isn't available (e.g. failed login attempts)
 */
export function logAudit(req, { module, action, description = '', status = null, previousValue = null, newValue = null, metadata = null, actorOverride = null }) {
  const actor = actorOverride || req?.user || null;
  const finalStatus = status || (FAILURE_ACTIONS.has(action) ? 'failure' : 'success');
  insertAudit.run(
    actor?.id || null,
    actor?.name || actorOverride?.name || null,
    actor?.role || actorOverride?.role || null,
    module,
    action,
    description,
    req ? extractIp(req) : null,
    req?.headers?.['user-agent'] || null,
    finalStatus,
    safeStringify(previousValue),
    safeStringify(newValue),
    safeStringify(metadata)
  );
}

// Very small, dependency-free User-Agent parser — good enough to show a
// human-readable "Device" column (e.g. "Chrome on Windows", "Safari on
// iPhone") in the Audit Log without pulling in a heavy UA-parsing library.
export function parseDevice(userAgent) {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/curl\//.test(ua)) browser = 'curl (script)';
  else if (/Postman/.test(ua)) browser = 'Postman (script)';

  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} on ${os}`;
}

