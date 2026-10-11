import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { notifyAdmins } from '../utils/notify.js';
import { levelForXp } from '../utils/gamification.js';
import { logAudit } from '../utils/audit.js';
import { resolveAllPermissions } from '../services/permissions.js';
import { resolveScope, allowedClassLevels } from '../services/scope.js';

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

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    logAudit(req, { module: 'auth', action: 'failed_login', description: `Failed login attempt for ${user.email}`, actorOverride: { id: user.id, name: user.name, role: user.role } });
    return res.status(401).json({ error: 'Invalid email or password' });
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

  if (user.role === 'teacher' && user.account_status === 'disabled') {
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
  const token = signToken(safeUser);

  logAudit(req, { module: 'auth', action: 'login', description: `${user.name} logged in`, actorOverride: safeUser });

  res.json({ token, user: safeUser });
});

router.post('/logout', requireAuth, (req, res) => {
  logAudit(req, { module: 'auth', action: 'logout', description: `${req.user.name} logged out` });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, level: levelForXp(user.xp || 0), streak: streakStatus(user.streak_last_date) } });
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
  res.json({ user: { ...user, level: levelForXp(user.xp || 0), streak: streakStatus(user.streak_last_date) } });
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
