import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import { resolveScope } from '../services/scope.js';

const router = Router();

// Every route in this file requires the 'analytics.view_school_wide'
// permission (Coordinator, Exam Coordinator, Academic Head, System Admin
// hold it by default — see db/seedRbac.js) rather than a hardcoded role
// check, so a future custom role granted this permission gets the same
// monitoring screens automatically with zero code change.
router.use(requireAuth, requirePermission('analytics.view_school_wide'));

/**
 * Restricts a query to a coordinator's assigned department(s) when they
 * have explicit scope_assignments rows; unrestricted roles (Academic Head,
 * System Admin) and coordinators with no department scope configured yet
 * see the whole school — see services/scope.js resolveScope() for the
 * "coordinator with zero scope rows = whole-school monitoring" rule.
 */
function departmentFilterClause(scope, subjectAlias = 's') {
  if (scope.unrestricted || scope.departments.length === 0) return { sql: '1=1', params: [] };
  const clauses = scope.departments.map(() => `${subjectAlias}.name = ?`);
  return { sql: `(${clauses.join(' OR ')})`, params: scope.departments };
}

// GET /api/coordinator/teacher-workload — assignments/quizzes/grading load
// per teacher, so a Coordinator can spot overloaded or under-utilized staff.
router.get('/teacher-workload', (req, res) => {
  const scope = resolveScope(req.user);
  const teachers = db.prepare(`
    SELECT u.id, u.name, u.staff_role, u.account_status
    FROM users u WHERE u.role = 'teacher'
    ORDER BY u.name
  `).all();

  const workload = teachers.map(t => {
    const assignmentsCreated = db.prepare('SELECT COUNT(*) c FROM assignments WHERE created_by = ?').get(t.id).c;
    const quizzesCreated = db.prepare('SELECT COUNT(*) c FROM quizzes WHERE created_by = ?').get(t.id).c;
    const pendingGrading = db.prepare(`
      SELECT COUNT(*) c FROM submissions sub
      JOIN assignments a ON sub.assignment_id = a.id
      WHERE a.created_by = ? AND sub.status IN ('submitted','late')
    `).get(t.id).c;
    const classCount = db.prepare('SELECT COUNT(DISTINCT class_level || \'-\' || COALESCE(section,\'\')) c FROM teacher_assignments WHERE teacher_id = ?').get(t.id).c;
    const lastLogin = db.prepare(`
      SELECT created_at FROM audit_logs WHERE user_id = ? AND action = 'login' AND status = 'success'
      ORDER BY created_at DESC LIMIT 1
    `).get(t.id);
    return {
      id: t.id, name: t.name, staff_role: t.staff_role, account_status: t.account_status,
      assignments_created: assignmentsCreated, quizzes_created: quizzesCreated,
      pending_grading: pendingGrading, class_count: classCount,
      last_login_at: lastLogin?.created_at || null,
    };
  });

  res.json({ teachers: workload });
});

// GET /api/coordinator/login-activity — recent login/logout events from the
// existing audit_logs table, reused rather than duplicated.
router.get('/login-activity', (req, res) => {
  const { limit = 50 } = req.query;
  const events = db.prepare(`
    SELECT id, user_id, user_name, user_role, action, status, ip_address, user_agent, created_at
    FROM audit_logs WHERE module = 'auth' AND action IN ('login','logout','failed_login')
    ORDER BY created_at DESC LIMIT ?
  `).all(Math.min(Number(limit) || 50, 200));
  res.json({ events });
});

// GET /api/coordinator/pending-reviews — ungraded submissions across every
// teacher (not just the coordinator's own), for "Pending Reviews" widget.
router.get('/pending-reviews', (req, res) => {
  const submissions = db.prepare(`
    SELECT sub.id, sub.status, sub.submitted_at, sub.is_late,
           st.name as student_name, a.title as assignment_title, a.class_level, a.section,
           s.name as subject_name, t.name as teacher_name, t.id as teacher_id
    FROM submissions sub
    JOIN assignments a ON sub.assignment_id = a.id
    JOIN users st ON sub.student_id = st.id
    JOIN subjects s ON a.subject_id = s.id
    LEFT JOIN users t ON a.created_by = t.id
    WHERE sub.status IN ('submitted','late')
    ORDER BY sub.submitted_at ASC LIMIT 100
  `).all();
  res.json({ submissions });
});

// GET /api/coordinator/inactive-teachers — teachers with no login in N days.
router.get('/inactive-teachers', (req, res) => {
  const { days = 7 } = req.query;
  const threshold = Number(days) || 7;
  const teachers = db.prepare(`
    SELECT u.id, u.name, u.email, u.staff_role,
      (SELECT MAX(created_at) FROM audit_logs WHERE user_id = u.id AND action = 'login' AND status = 'success') as last_login_at
    FROM users u WHERE u.role = 'teacher' AND u.account_status = 'active'
  `).all();
  const inactive = teachers.filter(t => {
    if (!t.last_login_at) return true;
    const daysSince = (Date.now() - new Date(t.last_login_at.replace(' ', 'T') + 'Z').getTime()) / 86400000;
    return daysSince >= threshold;
  });
  res.json({ teachers: inactive, thresholdDays: threshold });
});

// GET /api/coordinator/overview — top-level cards for the Coordinator dashboard.
router.get('/overview', (req, res) => {
  const totalTeachers = db.prepare("SELECT COUNT(*) c FROM users WHERE role='teacher' AND account_status != 'disabled'").get().c;
  const totalStudents = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND approval_status='approved'").get().c;
  const totalClasses = db.prepare('SELECT COUNT(DISTINCT class_level) c FROM users WHERE role=\'student\'').get().c;

  const pendingGrading = db.prepare("SELECT COUNT(*) c FROM submissions WHERE status IN ('submitted','late')").get().c;

  const quizAvg = db.prepare(`
    SELECT AVG(CAST(score AS FLOAT)/total*100) avg FROM quiz_attempts
  `).get().avg;

  const assignmentCompletion = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM submissions) as submitted,
      (SELECT COUNT(*) FROM assignments) as total_assignments
  `).get();

  const recentAudit = db.prepare(`
    SELECT id, user_name, user_role, module, action, description, status, created_at
    FROM audit_logs ORDER BY created_at DESC LIMIT 20
  `).all();

  res.json({
    totalTeachers, totalStudents, totalClasses, pendingGrading,
    avgQuizPct: quizAvg ? Math.round(quizAvg) : null,
    assignmentCompletion,
    recentAudit,
  });
});

export default router;
