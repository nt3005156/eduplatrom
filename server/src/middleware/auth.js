import jwt from 'jsonwebtoken';

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

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id, role: user.role, class_level: user.class_level, name: user.name,
      email: user.email, staff_role: user.staff_role || null,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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

