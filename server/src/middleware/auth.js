import jwt from 'jsonwebtoken';
import db from '../db/index.js';

const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set (32+ chars) when NODE_ENV=production');
}
// The fallback is only ever used in development/test.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// --- Role architecture -----------------------------------------------------
// role: 'student' | 'teacher' | 'admin' (top-level account type — controls which
//        broad area of the app the account can reach at all).
// staff_role (only when role='teacher'): a finer-grained tier controlling what
//        a *teacher* specifically can do among teacher-level permissions:
//   - class_teacher    : homeroom teacher for a class+section. Can see all
//                         subjects/grades for their homeroom students (not just
//                         their own subject), but still cannot manage other
//                         teachers or site-wide settings.
//   - subject_teacher   : the default/base tier — full access to content,
//                         assignments, quizzes, grading, but ONLY for the
//                         classes/sections/subjects they are assigned to via
//                         teacher_assignments. Cannot manage other teachers.
//   - coordinator       : subject_teacher permissions + can view (read-only)
//                         analytics/reports across the whole school for their
//                         subject, and manage the Question Bank broadly.
//   - exam_controller   : can create/schedule/publish quizzes & exams across
//                         classes, and see exam analytics school-wide, but
//                         cannot manage teacher accounts or branding.
//   - academic_head     : broadest teacher-tier — can view all classes/
//                         sections/subjects (read + grade), and view (not
//                         edit) the Teacher Management directory, but still
//                         cannot create/edit/disable teacher accounts or
//                         touch billing/branding/audit-log — those remain
//                         strictly Admin-only.
// Only role='admin' can create/edit/disable/reset-password on teacher
// accounts, manage branding/site settings, or view the Audit Log.
// -----------------------------------------------------------------------------

// Sessions last one school day. A password reset, disable or archive revokes
// every session immediately (see revokeSessions), so the lifetime can be short.
export const SESSION_COOKIE = 'nitex_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id, role: user.role, class_level: user.class_level, name: user.name,
      email: user.email, staff_role: user.staff_role || null, sv: user.session_version || 0,
    },
    JWT_SECRET,
    { expiresIn: SESSION_TTL_SECONDS }
  );
}

/** Methods that change data. Cookie sessions must send the custom header on these. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CLIENT_HEADER = 'x-nitex-client';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;
  let viaCookie = false;
  if (header && header.startsWith('Bearer ')) {
    token = header.split(' ')[1];
  } else {
    token = readCookie(req.headers.cookie, SESSION_COOKIE);
    viaCookie = Boolean(token);
  }
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  // The browser attaches cookies to cross-site requests too. The custom header
  // cannot be sent cross-site without a CORS preflight, and this API never
  // allows one (see app.js), so requiring it blocks cross-site writes.
  if (viaCookie && UNSAFE_METHODS.has(req.method) && req.headers[CLIENT_HEADER] !== 'web') {
    return res.status(403).json({ error: 'Request blocked: missing client header' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // File-download tokens must not open the API.
  if (payload.purpose === 'file') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Check the live account, not just the token: a disabled or archived user
  // must lose access immediately, not when the token expires.
  const acct = db.prepare('SELECT account_status, session_version FROM users WHERE id = ?').get(payload.id);
  if (!acct || (acct.account_status && acct.account_status !== 'active')) {
    return res.status(401).json({ error: 'Account is not active' });
  }
  if (!sessionIsCurrent(payload, acct)) {
    return res.status(401).json({ error: 'Session ended. Please sign in again.' });
  }
  req.user = payload;
  next();
}

/**
 * Every token carries the user's session_version at issue time (claim `sv`).
 * Revoking bumps the counter, so every older token stops matching. This is
 * exact: no clock comparison, so a login right after a reset always works.
 * Tokens issued before this claim existed have no `sv` and are refused, which
 * means users sign in once after the upgrade.
 */
export function sessionIsCurrent(payload, acct) {
  return payload.sv !== undefined && payload.sv === (acct.session_version || 0);
}

/** Invalidate every token issued so far for this user (password reset, disable, archive, anonymize). */
export function revokeSessions(userId) {
  db.prepare('UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?').run(userId);
}

/** Only the super-admin role — full system access (branding, audit log, teacher account management, etc). */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** Admin or Teacher (any tier) — day-to-day content/grading operations both roles can perform. */
export function requireStaff(req, res, next) {
  if (!['admin', 'teacher'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
}

const ELEVATED_TEACHER_TIERS = new Set(['coordinator', 'exam_controller', 'academic_head']);

/** Admin, or a teacher in an elevated tier (Coordinator/Exam Controller/Academic Head) — broader read/reporting access than a plain Subject/Class Teacher. */
export function requireElevatedStaff(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (req.user?.role === 'teacher' && ELEVATED_TEACHER_TIERS.has(req.user?.staff_role)) return next();
  return res.status(403).json({ error: 'This action requires an elevated staff role (Coordinator, Exam Controller, or Academic Head)' });
}

/**
 * System Admin OR a teacher whose staff_role is 'academic_head' — the two
 * tiers that hold true near-complete authority over the whole school (view
 * everything, compare every class/subject/teacher, override grades, approve
 * workflows). Deliberately narrower than requireElevatedStaff: a Coordinator
 * or Exam Controller must NOT get Academic Head's override/approval powers,
 * only its read-only monitoring views (already covered by the
 * 'analytics.view_school_wide' permission they hold).
 */
export function requireAcademicHead(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (req.user?.role === 'teacher' && req.user?.staff_role === 'academic_head') return next();
  return res.status(403).json({ error: 'This action requires Academic Head or System Admin access.' });
}

export { JWT_SECRET };

// --- Browser session cookie ------------------------------------------------
// The web app never reads the token. The HttpOnly cookie is sent by the browser
// on every API call, so a script injected into the page cannot copy it.
function cookieSecure(req) {
  return IS_PROD || req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function setSessionCookie(req, res, token) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${cookieSecure(req) ? '; Secure' : ''}`);
}

export function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure(req) ? '; Secure' : ''}`);
}

// --- Authenticated file access -------------------------------------------
// Uploaded files (student submissions, application documents, materials) are
// personal data, so they are never served anonymously. A browser cannot send an
// Authorization header on a plain <a href>, so login sets a short-lived HttpOnly
// cookie scoped to /uploads. API clients may still send a Bearer token.
export const FILE_COOKIE = 'nitex_file';
const FILE_COOKIE_MAX_AGE = SESSION_TTL_SECONDS;

export function setFileCookie(req, res, user) {
  const sv = db.prepare('SELECT session_version FROM users WHERE id = ?').get(user.id)?.session_version || 0;
  const token = jwt.sign({ id: user.id, role: user.role, purpose: 'file', sv }, JWT_SECRET, { expiresIn: FILE_COOKIE_MAX_AGE });
  res.append('Set-Cookie', `${FILE_COOKIE}=${token}; Path=/uploads; HttpOnly; SameSite=Lax; Max-Age=${FILE_COOKIE_MAX_AGE}${cookieSecure(req) ? '; Secure' : ''}`);
}

export function clearFileCookie(req, res) {
  res.append('Set-Cookie', `${FILE_COOKIE}=; Path=/uploads; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure(req) ? '; Secure' : ''}`);
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function requireFileAccess(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null;
  const token = bearer || readCookie(req.headers.cookie, FILE_COOKIE);
  if (!token) return res.status(401).json({ error: 'Sign in to open this file' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const acct = db.prepare('SELECT account_status, session_version FROM users WHERE id = ?').get(payload.id);
    if (!acct || (acct.account_status && acct.account_status !== 'active')) {
      return res.status(401).json({ error: 'Account is not active' });
    }
    if (!sessionIsCurrent(payload, acct)) {
      return res.status(401).json({ error: 'Sign in to open this file' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Sign in to open this file' });
  }
}
