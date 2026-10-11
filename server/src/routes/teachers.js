import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { requireAuth, requireAdmin, revokeSessions } from '../middleware/auth.js';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../utils/passwordPolicy.js';
import { notifyUser } from '../utils/notify.js';
import { logAudit } from '../utils/audit.js';
import { invalidateUserRoleCache } from '../services/permissions.js';

const router = Router();

// Teacher Management — this entire file is admin-only. Per the product spec:
// "Only Admin can manage teacher accounts. Class Teacher should NOT create
// teachers. Subject Teacher should NOT manage other teachers." No requireStaff
// anywhere below — every route uses requireAdmin.

const STAFF_ROLES = ['class_teacher', 'subject_teacher', 'coordinator', 'exam_controller', 'academic_head', 'finance_officer', 'lead_cashier'];

// Maps the legacy staff_role text value to the RBAC engine's roles.key, so
// setting a teacher's staff_role here (the existing Teacher Management UI)
// keeps users.role_id — the source of truth for permission resolution — in
// sync automatically. Without this, an admin could change a teacher's
// displayed role tier while their actual granted permissions silently stayed
// on the old role.
const STAFF_ROLE_TO_ROLE_KEY = {
  class_teacher: 'class_teacher',
  subject_teacher: 'subject_teacher',
  coordinator: 'coordinator',
  exam_controller: 'exam_coordinator',
  academic_head: 'academic_head',
  finance_officer: 'finance_officer',
  lead_cashier: 'lead_cashier',
};

function syncRoleId(userId, staffRole) {
  const roleKey = STAFF_ROLE_TO_ROLE_KEY[staffRole] || 'subject_teacher';
  const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  if (role) db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role.id, userId);
  invalidateUserRoleCache(userId);
}
const STAFF_ROLE_LABELS = {
  finance_officer: 'Finance Officer',
  lead_cashier: 'Lead Cashier',
  class_teacher: 'Class Teacher',
  subject_teacher: 'Subject Teacher',
  coordinator: 'Coordinator',
  exam_controller: 'Exam Controller',
  academic_head: 'Academic Head',
};

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function loadAssignments(teacherId) {
  return db.prepare(`
    SELECT ta.id, ta.class_level, ta.section, ta.is_class_teacher,
           s.id as subject_id, s.name as subject_name, s.color as subject_color
    FROM teacher_assignments ta JOIN subjects s ON ta.subject_id = s.id
    WHERE ta.teacher_id = ?
    ORDER BY ta.class_level, ta.section, s.name
  `).all(teacherId);
}

function serializeTeacher(t) {
  return {
    id: t.id, name: t.name, email: t.email, staff_role: t.staff_role,
    employee_no: t.employee_no || null,
    staff_role_label: STAFF_ROLE_LABELS[t.staff_role] || null,
    account_status: t.account_status || 'active',
    avatar_color: t.avatar_color, created_at: t.created_at,
    assignments: loadAssignments(t.id),
  };
}

// GET /api/teachers — list every teacher with role tier, status, and full
// Class -> Section -> Subject assignment breakdown.
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const { status, staff_role, search } = req.query;
  let sql = "SELECT * FROM users WHERE role = 'teacher'";
  const params = [];
  if (status) { sql += ' AND account_status = ?'; params.push(status); }
  if (staff_role) { sql += ' AND staff_role = ?'; params.push(staff_role); }
  if (search) { sql += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY name';
  const teachers = db.prepare(sql).all(...params);
  res.json({ teachers: teachers.map(serializeTeacher), staff_roles: STAFF_ROLES.map(v => ({ value: v, label: STAFF_ROLE_LABELS[v] })) });
});

router.get('/:id', requireAuth, requireAdmin, (req, res) => {
  const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
  res.json({ teacher: serializeTeacher(teacher) });
});

// POST /api/teachers — create a teacher account (with role tier).
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password, staff_role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, and password are required' });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (staff_role && !STAFF_ROLES.includes(staff_role)) return res.status(400).json({ error: 'Invalid staff_role' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const colors = ['#6C5CE7', '#00B894', '#0984E3', '#E17055', '#E84393', '#00CEC9'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, avatar_color, approval_status, account_status, staff_role)
     VALUES (?,?,?,'teacher',?,'approved','active',?)`
  ).run(name, email.toLowerCase(), hash, color, staff_role || 'subject_teacher');

  syncRoleId(info.lastInsertRowid, staff_role || 'subject_teacher');

  logAudit(req, {
    module: 'users', action: 'created',
    description: `${req.user.name} created a teacher account for ${name} (${STAFF_ROLE_LABELS[staff_role || 'subject_teacher']})`,
    newValue: { name, email: email.toLowerCase(), role: 'teacher', staff_role: staff_role || 'subject_teacher' },
  });

  const teacher = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ teacher: serializeTeacher(teacher) });
});

// PUT /api/teachers/:id — edit name/email/staff_role.
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, email, staff_role } = req.body;
  const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
  if (staff_role && !STAFF_ROLES.includes(staff_role)) return res.status(400).json({ error: 'Invalid staff_role' });
  if (email && email.toLowerCase() !== teacher.email) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase(), teacher.id);
    if (existing) return res.status(409).json({ error: 'Email already registered to another account' });
  }

  db.prepare('UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), staff_role = COALESCE(?, staff_role) WHERE id = ?')
    .run(name || null, email ? email.toLowerCase() : null, staff_role || null, teacher.id);

  if (staff_role) syncRoleId(teacher.id, staff_role);

  logAudit(req, {
    module: 'users', action: 'updated',
    description: `${req.user.name} updated teacher account ${teacher.name}`,
    previousValue: { name: teacher.name, email: teacher.email, staff_role: teacher.staff_role },
    newValue: { name, email, staff_role },
  });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(teacher.id);
  res.json({ teacher: serializeTeacher(updated) });
});

// PUT /api/teachers/:id/status — disable/enable (never hard-deletes data).
router.put('/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { account_status } = req.body;
  if (!['active', 'disabled'].includes(account_status)) {
    return res.status(400).json({ error: "account_status must be 'active' or 'disabled'" });
  }
  const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

  db.prepare('UPDATE users SET account_status = ? WHERE id = ?').run(account_status, teacher.id);
  if (account_status === 'disabled') revokeSessions(teacher.id);

  logAudit(req, {
    module: 'users', action: account_status === 'disabled' ? 'disabled' : 'enabled',
    description: `${req.user.name} ${account_status === 'disabled' ? 'disabled' : 're-enabled'} teacher account ${teacher.name}`,
    previousValue: { account_status: teacher.account_status || 'active' },
    newValue: { account_status },
  });

  if (account_status === 'active') {
    notifyUser({
      user_id: teacher.id, type: 'general', title: 'Your account has been re-enabled',
      body: 'You can now log in again.', link: '/login',
    });
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(teacher.id);
  res.json({ teacher: serializeTeacher(updated) });
});

// PUT /api/teachers/:id/reset-password — admin sets (or auto-generates) a new password.
router.put('/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const { new_password } = req.body;
  const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

  // An admin-chosen password must meet the policy. Leaving it empty generates one.
  if (new_password) {
    const problem = passwordProblem(new_password);
    if (problem) return res.status(400).json({ error: problem });
  }
  const password = new_password || randomPassword();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, teacher.id);
  revokeSessions(teacher.id); // the old password's sessions end immediately

  logAudit(req, {
    module: 'users', action: 'password_reset',
    description: `${req.user.name} reset the password for teacher ${teacher.name}`,
    metadata: { teacher_id: teacher.id },
  });

  notifyUser({
    user_id: teacher.id, type: 'general', title: 'Your password was reset by an administrator',
    body: 'Please log in with your new password and change it as soon as possible.', link: '/login',
  });

  // Return the generated password once, only to the admin who requested it —
  // never stored or logged in plaintext anywhere.
  res.json({ ok: true, temporary_password: password });
});

// DELETE /api/teachers/:id — hard delete only ever used for accidental/test
// accounts with zero history. Prefer /status disable for real accounts.
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

  const hasHistory = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM assignments WHERE created_by = ?) +
      (SELECT COUNT(*) FROM quizzes WHERE created_by = ?) as cnt
  `).get(teacher.id, teacher.id).cnt;

  if (hasHistory > 0) {
    return res.status(409).json({
      error: 'This teacher has created assignments or quizzes and cannot be permanently deleted. Disable the account instead to preserve history.',
    });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(teacher.id);
  logAudit(req, {
    module: 'users', action: 'deleted',
    description: `${req.user.name} permanently removed teacher account ${teacher.name}`,
    previousValue: { name: teacher.name, email: teacher.email },
  });
  res.json({ ok: true });
});

// PUT /api/teachers/:id/assignments — replace the full Teacher -> Class ->
// Section -> Subject assignment set for this teacher in one transaction.
// body: { assignments: [{ class_level, section, subject_id, is_class_teacher }] }
router.put('/:id/assignments', requireAuth, requireAdmin, (req, res) => {
  const { assignments } = req.body;
  const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
  if (!Array.isArray(assignments)) return res.status(400).json({ error: 'assignments must be an array' });

  for (const a of assignments) {
    if (!a.class_level || !a.subject_id) {
      return res.status(400).json({ error: 'Each assignment requires class_level and subject_id' });
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM teacher_assignments WHERE teacher_id = ?').run(teacher.id);
    const insert = db.prepare(`
      INSERT INTO teacher_assignments (teacher_id, class_level, section, subject_id, is_class_teacher)
      VALUES (?,?,?,?,?)
    `);
    for (const a of assignments) {
      insert.run(teacher.id, Number(a.class_level), a.section || null, Number(a.subject_id), a.is_class_teacher ? 1 : 0);
    }
  });
  tx();

  // AUTO-PROMOTE: ticking "Class Teacher for this section" on any row means
  // this teacher is now a homeroom teacher — their staff_role should reflect
  // that automatically instead of silently staying "Subject Teacher" while
  // holding a Class Teacher assignment underneath (previously required the
  // admin to separately remember to also edit the Staff Role dropdown).
  // Only auto-promotes FROM the base 'subject_teacher' tier (or no tier set
  // yet) — an admin who has deliberately elevated someone to Coordinator/
  // Exam Controller/Academic Head keeps that broader tier even if they're
  // also a homeroom teacher for one class, since those tiers already imply
  // at least as much access as Class Teacher and demoting them would be
  // wrong. Only forward-promotes; never auto-demotes back to Subject
  // Teacher if a Class Teacher row is later removed — that direction is a
  // deliberate admin decision made via the Edit Teacher form.
  const isNowClassTeacher = assignments.some(a => a.is_class_teacher);
  let roleAutoChanged = false;
  if (isNowClassTeacher && (!teacher.staff_role || teacher.staff_role === 'subject_teacher')) {
    db.prepare("UPDATE users SET staff_role = 'class_teacher' WHERE id = ?").run(teacher.id);
    syncRoleId(teacher.id, 'class_teacher');
    roleAutoChanged = true;
  }

  logAudit(req, {
    module: 'users', action: 'teacher_assigned',
    description: `${req.user.name} updated Class/Section/Subject assignments for ${teacher.name}`
      + (roleAutoChanged ? ' — staff role automatically promoted to Class Teacher' : ''),
    newValue: { assignments, auto_promoted_to_class_teacher: roleAutoChanged },
    metadata: { teacher_id: teacher.id },
  });

  notifyUser({
    user_id: teacher.id, type: 'general', title: 'Your teaching assignments were updated',
    body: 'An administrator changed the classes/sections/subjects assigned to you.'
      + (roleAutoChanged ? ' You have also been promoted to Class Teacher.' : ''),
    link: '/admin',
  });

  res.json({ teacher: serializeTeacher(db.prepare('SELECT * FROM users WHERE id = ?').get(teacher.id)) });
});

// GET /api/teachers/lookup/for-class?class_level=10&section=A&subject_id=5
// Used by other modules (Assignments, Quizzes, Content) to resolve which
// teacher(s) are the source of truth for a given Class/Section/Subject —
// e.g. to target notifications correctly instead of blasting all staff.
router.get('/lookup/for-class', requireAuth, requireAdmin, (req, res) => {
  const { class_level, section, subject_id } = req.query;
  if (!class_level) return res.status(400).json({ error: 'class_level is required' });
  let sql = `
    SELECT ta.*, u.name as teacher_name, u.email as teacher_email, u.staff_role
    FROM teacher_assignments ta JOIN users u ON ta.teacher_id = u.id
    WHERE ta.class_level = ? AND (ta.section IS NULL OR ta.section = ?)
  `;
  const params = [Number(class_level), section || null];
  if (subject_id) { sql += ' AND ta.subject_id = ?'; params.push(Number(subject_id)); }
  const rows = db.prepare(sql).all(...params);
  res.json({ teachers: rows });
});

export default router;
