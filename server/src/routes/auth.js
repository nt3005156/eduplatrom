import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth, setFileCookie, clearFileCookie, setSessionCookie, clearSessionCookie,
  setRefreshCookie, clearRefreshCookie, readCookie, CLIENT_HEADER } from '../middleware/auth.js';
import { REFRESH_COOKIE, issueRefreshToken, rotateRefreshToken, revokeByToken } from '../services/sessions.js';

// Lockout: 10 failed sign-ins lock the account for 15 minutes. Expires on its own; no admin step needed.
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;

function recordFailedLogin(userId) {
  db.prepare('UPDATE users SET failed_login_count = COALESCE(failed_login_count, 0) + 1 WHERE id = ?').run(userId);
  const row = db.prepare('SELECT failed_login_count FROM users WHERE id = ?').get(userId);
  if (row.failed_login_count >= LOCK_AFTER) {
    db.prepare(`UPDATE users SET locked_until = datetime('now', ?), failed_login_count = 0 WHERE id = ?`).run(`+${LOCK_MINUTES} minutes`, userId);
    return { locked: true };
  }
  return { locked: false, remaining: LOCK_AFTER - row.failed_login_count };
}
import { notifyAdmins } from '../utils/notify.js';
import { levelForXp, gamificationEligible } from '../utils/gamification.js';
import { logAudit } from '../utils/audit.js';
import { resolveAllPermissions } from '../services/permissions.js';
import { resolveScope, allowedClassLevels } from '../services/scope.js';
import { findUsableSetup, completeSetup } from '../services/accountSetup.js';

const router = Router();

const SAFE_FIELDS = `id, name, email, role, class_level, section, gender, avatar_color, theme_preference,
  approval_status, account_status, staff_role, xp, streak_count, longest_streak, streak_last_date,
  pref_class_level, pref_section, pref_subject_id`;

function streakStatus(streakLastDate) {
  const today = new Date().toISOString().slice(0, 10);
  const studiedToday = streakLastDate === today;
  const hour = new Date().getUTCHours();
  return { studiedToday, atRisk: !studiedToday && hour >= 18 }; // "late in the day" heuristic
}

router.post('/register', (req, res) => {
  const { name, email, password, class_level, gender, section } = req.body;
  if (!name || !email || !password || !class_level) {
    return res.status(400).json({ error: 'name, email, password, and class_level are required' });
  }
  const cls = Number(class_level);
  if (cls < 6 || cls > 12) {
    return res.status(400).json({ error: 'class_level must be between 6 and 12' });
  }
  if (gender && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'gender must be male, female, or other' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const colors = ['#6C5CE7', '#00B894', '#0984E3', '#E17055', '#E84393', '#00CEC9'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, class_level, section, gender, avatar_color, approval_status)
     VALUES (?,?,?,?,?,?,?,?,'pending')`
  ).run(name, email.toLowerCase(), hash, 'student', cls, section || null, gender || null, color);

  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(info.lastInsertRowid);

  // Create the permanent, versioned Application record (v1) backing this registration.
  // This is the single source of truth for the Application Review/Rejection/
  // Reapplication workflow — nothing here is ever deleted, only ever superseded.
  db.prepare(`
    INSERT INTO applications (applicant_user_id, version, status, data, is_current)
    VALUES (?, 1, 'submitted', ?, 1)
  `).run(user.id, JSON.stringify({ name, email: email.toLowerCase(), class_level: cls, section, gender, documents: [] }));

  notifyAdmins({
    type: 'general',
    title: 'New student awaiting approval',
    body: `${name} (Class ${cls}) just registered and needs review`,
    link: '/admin/registry',
    related_id: user.id,
  });

  logAudit(req, {
    module: 'applications', action: 'submitted',
    description: `${name} submitted a registration application for Class ${cls}`,
    newValue: { name, email: email.toLowerCase(), class_level: cls, section },
    actorOverride: { id: user.id, name, role: 'student' },
  });

  // No token issued yet — the account must be approved before it can log in.
  res.json({ pending: true, user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) {
    logAudit(req, { module: 'auth', action: 'failed_login', description: `Failed login attempt for unknown email ${email}`, actorOverride: { name: email } });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Lockout: a locked account is refused before the password is even checked.
  const lock = db.prepare(`SELECT locked_until, (locked_until > datetime('now')) AS is_locked FROM users WHERE id = ?`).get(user.id);
  if (lock?.is_locked) {
    return res.status(429).json({ error: `Too many failed sign-in attempts. Try again in about ${LOCK_MINUTES} minutes.`, locked: true });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    const after = recordFailedLogin(user.id);
    logAudit(req, { module: 'auth', action: 'failed_login', description: `Failed login attempt for ${user.email}`, actorOverride: { id: user.id, name: user.name, role: user.role } });
    if (after.locked) {
      logAudit(req, { module: 'auth', action: 'account_locked', description: `${user.email} locked for ${LOCK_MINUTES} minutes after ${LOCK_AFTER} failed sign-ins`, actorOverride: { id: user.id, name: user.name, role: user.role } });
      return res.status(429).json({ error: `Too many failed sign-in attempts. The account is locked for ${LOCK_MINUTES} minutes.`, locked: true });
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.failed_login_count || user.locked_until) {
    db.prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?').run(user.id);
  }

  if (user.role === 'student' && user.approval_status !== 'approved') {
    logAudit(req, { module: 'auth', action: 'failed_login', description: `Login blocked — account ${user.approval_status}`, actorOverride: { id: user.id, name: user.name, role: user.role } });
    return res.status(403).json({
      error: user.approval_status === 'rejected'
        ? 'Your registration was not approved. Please contact your school administrator.'
        : 'Your account is awaiting admin approval. Please check back soon.',
      approval_status: user.approval_status,
    });
  }

  if (user.account_status && user.account_status !== 'active') {
    logAudit(req, { module: 'auth', action: 'failed_login', description: `Login blocked — teacher account disabled`, actorOverride: { id: user.id, name: user.name, role: user.role } });
    return res.status(403).json({
      error: 'Your account has been disabled. Please contact your administrator.',
      account_status: user.account_status,
    });
  }

  const safeUser = {
    id: user.id, name: user.name, email: user.email, role: user.role, class_level: user.class_level,
    section: user.section, gender: user.gender, avatar_color: user.avatar_color, theme_preference: user.theme_preference,
    approval_status: user.approval_status, account_status: user.account_status, staff_role: user.staff_role,
    xp: user.xp, streak_count: user.streak_count, longest_streak: user.longest_streak,
    level: levelForXp(user.xp || 0), streak: streakStatus(user.streak_last_date),
    pref_class_level: user.pref_class_level, pref_section: user.pref_section, pref_subject_id: user.pref_subject_id,
  };
  const token = signToken({ ...safeUser, session_version: user.session_version || 0 });
  const refreshToken = issueRefreshToken(user.id, user.session_version || 0);

  logAudit(req, { module: 'auth', action: 'login', description: `${user.name} logged in`, actorOverride: safeUser });

  setSessionCookie(req, res, token);
  // The web app gets the refresh token only as an HttpOnly cookie. Other clients (X-NITEX-Client other than
  // "web") receive it in the body, because they have no cookie jar.
  const web = req.headers[CLIENT_HEADER] === 'web';
  if (web) setRefreshCookie(req, res, refreshToken);
  // Guardians never receive a file cookie: they have no file access at all (see requireFileAccess).
  if (user.role !== 'guardian') setFileCookie(req, res, user);
  res.json({ token, user: { ...safeUser, gamification_enabled: gamificationEligible(user.id) }, ...(web ? {} : { refresh_token: refreshToken }) });
});

/** Renews the access token. The web app sends the refresh cookie; API clients send { refresh_token } in the body. */
router.post('/refresh', (req, res) => {
  const cookieToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
  const web = Boolean(cookieToken);
  if (web && req.headers[CLIENT_HEADER] !== 'web') return res.status(403).json({ error: 'Request blocked: missing client header' });
  const presented = cookieToken || req.body?.refresh_token;
  const r = rotateRefreshToken(presented);
  if (r.error) {
    if (web) clearRefreshCookie(req, res);
    if (r.error === 'reused') {
      logAudit(req, { module: 'auth', action: 'refresh_reuse', description: 'A used refresh token was presented again. The session was ended.' });
    }
    return res.status(401).json({ error: 'Session ended. Please sign in again.' });
  }
  const user = db.prepare('SELECT id, name, email, role, class_level, staff_role, session_version FROM users WHERE id = ?').get(r.userId);
  const token = signToken({ ...user, session_version: user.session_version || 0 });
  setSessionCookie(req, res, token);
  if (web) setRefreshCookie(req, res, r.refreshToken);
  if (user.role !== 'guardian') setFileCookie(req, res, user);
  res.json({ token, ...(web ? {} : { refresh_token: r.refreshToken }) });
});

// One-time setup link: a new guardian or student chooses a password here.
router.get('/setup/:token', (req, res) => {
  const row = findUsableSetup(req.params.token);
  if (!row) return res.status(404).json({ valid: false, error: 'This link has expired or was already used. Ask the school for a new one.' });
  res.json({ valid: true, name: row.name, role: row.role, expires_at: row.expires_at });
});

router.post('/setup', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  try {
    const row = completeSetup(token, password);
    logAudit(req, { module: 'auth', action: 'password_set', description: `${row.name} set a password from a setup link`, actorOverride: { id: row.user_id, name: row.name, role: row.role } });
    res.json({ ok: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  revokeByToken(readCookie(req.headers.cookie, REFRESH_COOKIE) || req.body?.refresh_token);
  clearSessionCookie(req, res);
  clearRefreshCookie(req, res);
  clearFileCookie(req, res);
  logAudit(req, { module: 'auth', action: 'logout', description: `${req.user.name} logged out` });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  setFileCookie(req, res, { id: user.id, role: user.role });
  res.json({ user: { ...user, level: levelForXp(user.xp || 0), streak: streakStatus(user.streak_last_date), gamification_enabled: gamificationEligible(user.id) } });
});

// Update the current user's own module preferences (default class/section/subject).
router.put('/me/preferences', requireAuth, (req, res) => {
  const { pref_class_level, pref_section, pref_subject_id } = req.body;
  db.prepare('UPDATE users SET pref_class_level = ?, pref_section = ?, pref_subject_id = ? WHERE id = ?')
    .run(pref_class_level || null, pref_section || null, pref_subject_id || null, req.user.id);
  logAudit(req, {
    module: 'settings', action: 'updated',
    description: `${req.user.name} updated their default class/section/subject preference`,
    newValue: { pref_class_level, pref_section, pref_subject_id },
  });
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.user.id);
  res.json({ user: { ...user, level: levelForXp(user.xp || 0), streak: streakStatus(user.streak_last_date), gamification_enabled: gamificationEligible(user.id) } });
});

// Resolved permission set + scope summary for the current user — powers the
// frontend PermissionContext (sidebar/nav visibility, RequirePermission
// guards) without ever trusting a client-supplied role name.
router.get('/me/permissions', requireAuth, (req, res) => {
  const { role, permissions } = resolveAllPermissions(req.user);
  const scope = resolveScope(req.user);
  // allowedClassLevels drives every Class dropdown in the app (assignment
  // creation, quiz creation, content management, filters) — a scoped staff
  // member should never even see a Class option they aren't assigned to,
  // not just get blocked server-side after picking one.
  const classLevels = scope.unrestricted ? null : allowedClassLevels(scope);
  res.json({ role, permissions, scope: { ...scope, allowedClassLevels: classLevels } });
});

export default router;
