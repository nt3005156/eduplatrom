import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin, requireStaff } from '../middleware/auth.js';
import { resolveScope, scopeWhereClause } from '../services/scope.js';

const router = Router();

/**
 * Builds a parameterized WHERE fragment restricting a `users` (student)
 * query to the caller's assigned class+section combinations. Students don't
 * have a subject_id column, so any subject-only assignment still grants
 * roster visibility for that class+section (a Subject Teacher needs to see
 * their assigned students exist, even though they can't see other subjects'
 * content for that class). Fail-closed: zero assignments => '1=0'.
 */
function studentScopeClause(scope, columns = { classLevel: 'class_level', section: 'section' }) {
  if (scope.unrestricted) return { sql: '1=1', params: [] };
  const combos = [...scope.classSections, ...scope.subjectAssignments.map(a => ({ class_level: a.class_level, section: a.section }))];
  if (combos.length === 0) return { sql: '1=0', params: [] };
  const seen = new Set();
  const clauses = [];
  const params = [];
  for (const c of combos) {
    const key = `${c.class_level}|${c.section || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.section) {
      clauses.push(`(${columns.classLevel}=? AND (${columns.section}=? OR ${columns.section} IS NULL))`);
      params.push(c.class_level, c.section);
    } else {
      clauses.push(`(${columns.classLevel}=?)`);
      params.push(c.class_level);
    }
  }
  return { sql: `(${clauses.join(' OR ')})`, params };
}


// STUDENT DASHBOARD
router.get('/student', requireAuth, (req, res) => {
  const cls = req.user.class_level;
  const studentId = req.user.id;

  const materialsCount = db.prepare('SELECT COUNT(*) c FROM materials WHERE class_level=?').get(cls).c;
  const viewedCount = db.prepare(`
    SELECT COUNT(DISTINCT material_id) c FROM material_views mv
    JOIN materials m ON mv.material_id = m.id
    WHERE mv.student_id=? AND m.class_level=?
  `).get(studentId, cls).c;

  const assignmentsTotal = db.prepare('SELECT COUNT(*) c FROM assignments WHERE class_level=?').get(cls).c;
  const assignmentsDone = db.prepare(`
    SELECT COUNT(*) c FROM submissions sub
    JOIN assignments a ON sub.assignment_id = a.id
    WHERE sub.student_id=? AND a.class_level=?
  `).get(studentId, cls).c;

  const gradedSubs = db.prepare(`
    SELECT sub.grade, a.max_score, a.title, s.name as subject_name, sub.graded_at
    FROM submissions sub JOIN assignments a ON sub.assignment_id=a.id JOIN subjects s ON a.subject_id = s.id
    WHERE sub.student_id=? AND sub.status='graded' ORDER BY sub.graded_at DESC LIMIT 10
  `).all(studentId);

  const avgGradePct = gradedSubs.length
    ? Math.round(gradedSubs.reduce((sum, g) => sum + (g.grade / g.max_score) * 100, 0) / gradedSubs.length)
    : null;

  const quizAttempts = db.prepare(`
    SELECT qa.score, qa.total, qa.attempted_at, q.title, q.topic, s.name as subject_name
    FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id=q.id JOIN subjects s ON q.subject_id=s.id
    WHERE qa.student_id=? ORDER BY qa.attempted_at DESC LIMIT 10
  `).all(studentId);

  const avgQuizPct = quizAttempts.length
    ? Math.round(quizAttempts.reduce((sum, a) => sum + (a.score / a.total) * 100, 0) / quizAttempts.length)
    : null;

  // Upcoming due assignments
  const upcoming = db.prepare(`
    SELECT a.*, s.name as subject_name, s.color as subject_color
    FROM assignments a JOIN subjects s ON a.subject_id=s.id
    LEFT JOIN submissions sub ON sub.assignment_id=a.id AND sub.student_id=?
    WHERE a.class_level=? AND sub.id IS NULL AND (a.due_date IS NULL OR a.due_date >= datetime('now'))
    ORDER BY a.due_date ASC LIMIT 5
  `).all(studentId, cls);

  // Recommendation engine: find weak topics from quiz attempts, recommend unread materials on that topic;
  // fallback to unread materials in general.
  const weakTopics = db.prepare(`
    SELECT q.topic, AVG(CAST(qa.score AS FLOAT)/qa.total) as avg_pct
    FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id=q.id
    WHERE qa.student_id=? AND q.topic IS NOT NULL
    GROUP BY q.topic HAVING avg_pct < 0.7 ORDER BY avg_pct ASC LIMIT 3
  `).all(studentId);

  let recommendations = [];
  for (const wt of weakTopics) {
    const mats = db.prepare(`
      SELECT m.*, s.name as subject_name, s.color as subject_color, 'weak_topic' as reason
      FROM materials m JOIN subjects s ON m.subject_id = s.id
      WHERE m.class_level=? AND m.topic = ?
      AND m.id NOT IN (SELECT material_id FROM material_views WHERE student_id=?)
      LIMIT 3
    `).all(cls, wt.topic, studentId);
    recommendations.push(...mats);
  }
  if (recommendations.length < 4) {
    const fallback = db.prepare(`
      SELECT m.*, s.name as subject_name, s.color as subject_color, 'new' as reason
      FROM materials m JOIN subjects s ON m.subject_id = s.id
      WHERE m.class_level=?
      AND m.id NOT IN (SELECT material_id FROM material_views WHERE student_id=?)
      ORDER BY m.created_at DESC LIMIT ?
    `).all(cls, studentId, 4 - recommendations.length);
    recommendations.push(...fallback);
  }

  res.json({
    class_level: cls,
    materials: { total: materialsCount, viewed: viewedCount, pct: materialsCount ? Math.round((viewedCount / materialsCount) * 100) : 0 },
    assignments: { total: assignmentsTotal, done: assignmentsDone, pct: assignmentsTotal ? Math.round((assignmentsDone / assignmentsTotal) * 100) : 0 },
    avgGradePct,
    avgQuizPct,
    recentGrades: gradedSubs,
    recentQuizzes: quizAttempts,
    upcomingAssignments: upcoming,
    recommendations: recommendations.slice(0, 6),
  });
});

// STUDENT: knowledge constellation — topic-level mastery map for a subject
router.get('/student/constellation/:subjectId', requireAuth, (req, res) => {
  const { subjectId } = req.params;
  const studentId = req.user.id;

  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(subjectId);
  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  const topicRows = db.prepare(
    "SELECT DISTINCT topic FROM materials WHERE subject_id = ? AND topic IS NOT NULL AND topic != ''"
  ).all(subjectId);
  const quizTopicRows = db.prepare(
    "SELECT DISTINCT topic FROM quizzes WHERE subject_id = ? AND topic IS NOT NULL AND topic != ''"
  ).all(subjectId);

  const topicNames = [...new Set([...topicRows.map(t => t.topic), ...quizTopicRows.map(t => t.topic)])];

  const topics = topicNames.map(topic => {
    const materialsInTopic = db.prepare(
      'SELECT id FROM materials WHERE subject_id = ? AND topic = ?'
    ).all(subjectId, topic);
    const materialIds = materialsInTopic.map(m => m.id);
    const viewedCount = materialIds.length
      ? db.prepare(`SELECT COUNT(DISTINCT material_id) c FROM material_views WHERE student_id = ? AND material_id IN (${materialIds.map(() => '?').join(',')})`).get(studentId, ...materialIds).c
      : 0;

    const quizStats = db.prepare(`
      SELECT AVG(CAST(qa.score AS FLOAT) / qa.total) as avg_pct, COUNT(*) as attempts
      FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id
      WHERE q.subject_id = ? AND q.topic = ? AND qa.student_id = ?
    `).get(subjectId, topic, studentId);

    let mastery = 'unexplored';
    if (quizStats.attempts > 0) {
      mastery = quizStats.avg_pct >= 0.7 ? 'mastered' : 'practicing';
    } else if (viewedCount > 0) {
      mastery = 'exploring';
    }

    return {
      topic,
      materialCount: materialIds.length,
      viewedCount,
      quizAttempts: quizStats.attempts || 0,
      quizAvgPct: quizStats.avg_pct != null ? Math.round(quizStats.avg_pct * 100) : null,
      mastery,
    };
  });

  res.json({ subject: { id: subject.id, name: subject.name, color: subject.color }, topics });
});

// ADMIN / STAFF DASHBOARD — scope-aware.
// CRITICAL FIX: this endpoint previously queried every students/materials/
// assignments/quizzes row in the entire school regardless of who was
// logged in — meaning a Subject Teacher assigned only to "Class 10 Section A
// Mathematics" saw totals and lists for every class and every subject. It
// now applies the same scope resolution used everywhere else in this
// redesign (see services/scope.js) so unrestricted roles (System Admin,
// Academic Head) still see the whole school, while Class/Subject Teachers
// see only their assigned classes/sections/subjects, and a teacher with
// zero assignments sees zero rows (fail-closed) instead of everything.
router.get('/admin', requireAuth, requireStaff, (req, res) => {
  const scope = resolveScope(req.user);

  const studentClause = studentScopeClause(scope);
  const totalStudents = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='student' AND approval_status='approved' AND ${studentClause.sql}`).get(...studentClause.params).c;

  const materialsClause = scopeWhereClause(scope, { classLevel: 'class_level', section: null, subjectId: 'subject_id' });
  const totalMaterials = db.prepare(`SELECT COUNT(*) c FROM materials WHERE ${materialsClause.sql}`).get(...materialsClause.params).c;

  const assignClause = scopeWhereClause(scope, { classLevel: 'class_level', section: 'section', subjectId: 'subject_id' });
  const totalAssignments = db.prepare(`SELECT COUNT(*) c FROM assignments WHERE ${assignClause.sql}`).get(...assignClause.params).c;

  const quizClause = scopeWhereClause(scope, { classLevel: 'class_level', section: null, subjectId: 'subject_id' });
  const totalQuizzes = db.prepare(`SELECT COUNT(*) c FROM quizzes WHERE ${quizClause.sql}`).get(...quizClause.params).c;

  const pendingGradingClause = scopeWhereClause(scope, { classLevel: 'a.class_level', section: 'a.section', subjectId: 'a.subject_id' });
  const pendingGrading = db.prepare(`
    SELECT COUNT(*) c FROM submissions sub JOIN assignments a ON sub.assignment_id = a.id
    WHERE (sub.status='submitted' OR sub.status='late') AND ${pendingGradingClause.sql}
  `).get(...pendingGradingClause.params).c;

  // Pending student approvals are an admin/academic-head-only concern —
  // meaningless (and none of their business) for a Subject/Class Teacher.
  const pendingApprovals = scope.unrestricted
    ? db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND approval_status='pending'").get().c
    : 0;

  const studentsByClass = db.prepare(`
    SELECT class_level, COUNT(*) c FROM users WHERE role='student' AND approval_status='approved' AND ${studentClause.sql} GROUP BY class_level ORDER BY class_level
  `).all(...studentClause.params);


  const recentSubsClause = scopeWhereClause(scope, { classLevel: 'a.class_level', section: 'a.section', subjectId: 'a.subject_id' });
  const recentSubmissions = db.prepare(`
    SELECT sub.*, u.name as student_name, a.title as assignment_title, a.class_level
    FROM submissions sub JOIN users u ON sub.student_id = u.id JOIN assignments a ON sub.assignment_id = a.id
    WHERE ${recentSubsClause.sql}
    ORDER BY sub.submitted_at DESC LIMIT 10
  `).all(...recentSubsClause.params);

  const topPerformersClause = scope.unrestricted ? { sql: '1=1', params: [] } : (() => {
    const combos = [...scope.classSections, ...scope.subjectAssignments.map(a => ({ class_level: a.class_level, section: a.section }))];
    if (combos.length === 0) return { sql: '1=0', params: [] };
    const clauses = combos.map(c => c.section ? '(u.class_level=? AND (u.section=? OR u.section IS NULL))' : '(u.class_level=?)');
    const params = combos.flatMap(c => c.section ? [c.class_level, c.section] : [c.class_level]);
    return { sql: `(${clauses.join(' OR ')})`, params };
  })();
  const topPerformers = db.prepare(`
    SELECT u.id, u.name, u.class_level, AVG(CAST(qa.score AS FLOAT)/qa.total*100) as avg_score
    FROM quiz_attempts qa JOIN users u ON qa.student_id = u.id
    WHERE ${topPerformersClause.sql}
    GROUP BY u.id ORDER BY avg_score DESC LIMIT 5
  `).all(...topPerformersClause.params);

  res.json({
    totalStudents, totalMaterials, totalAssignments, totalQuizzes, pendingGrading, pendingApprovals,
    studentsByClass, recentSubmissions, topPerformers,
    scope: { unrestricted: scope.unrestricted, roleKey: scope.roleKey },
  });
});

// ADMIN: instant drill-down details for each overview stat card — scoped.
router.get('/admin/details/materials', requireAuth, requireStaff, (req, res) => {
  const scope = resolveScope(req.user);
  const clause = scopeWhereClause(scope, { classLevel: 'm.class_level', section: null, subjectId: 'm.subject_id' });
  const materials = db.prepare(`
    SELECT m.id, m.title, m.type, m.difficulty, m.class_level, m.created_at,
           s.name as subject_name, s.color as subject_color
    FROM materials m JOIN subjects s ON m.subject_id = s.id
    WHERE ${clause.sql}
    ORDER BY m.created_at DESC LIMIT 100
  `).all(...clause.params);
  res.json({ materials });
});

router.get('/admin/details/assignments', requireAuth, requireStaff, (req, res) => {
  const scope = resolveScope(req.user);
  const clause = scopeWhereClause(scope, { classLevel: 'a.class_level', section: 'a.section', subjectId: 'a.subject_id' });
  const assignments = db.prepare(`
    SELECT a.id, a.title, a.due_date, a.max_score, a.class_level, a.created_at,
           s.name as subject_name, s.color as subject_color,
           (SELECT COUNT(*) FROM submissions sub WHERE sub.assignment_id = a.id) as submission_count
    FROM assignments a JOIN subjects s ON a.subject_id = s.id
    WHERE ${clause.sql}
    ORDER BY a.created_at DESC LIMIT 100
  `).all(...clause.params);
  res.json({ assignments });
});

router.get('/admin/details/quizzes', requireAuth, requireStaff, (req, res) => {
  const scope = resolveScope(req.user);
  const clause = scopeWhereClause(scope, { classLevel: 'q.class_level', section: null, subjectId: 'q.subject_id' });
  const quizzes = db.prepare(`
    SELECT q.id, q.title, q.topic, q.class_level, q.time_limit_min, q.created_at,
           s.name as subject_name, s.color as subject_color,
           (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) as question_count,
           (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = q.id) as attempt_count
    FROM quizzes q JOIN subjects s ON q.subject_id = s.id
    WHERE ${clause.sql}
    ORDER BY q.created_at DESC LIMIT 100
  `).all(...clause.params);
  res.json({ quizzes });
});

router.get('/admin/details/pending-grading', requireAuth, requireStaff, (req, res) => {
  const scope = resolveScope(req.user);
  const clause = scopeWhereClause(scope, { classLevel: 'a.class_level', section: 'a.section', subjectId: 'a.subject_id' });
  const submissions = db.prepare(`
    SELECT sub.id, sub.status, sub.submitted_at, sub.file_path,
           u.name as student_name, u.class_level,
           a.title as assignment_title, a.max_score, a.id as assignment_id
    FROM submissions sub
    JOIN users u ON sub.student_id = u.id
    JOIN assignments a ON sub.assignment_id = a.id
    WHERE sub.status IN ('submitted','late') AND ${clause.sql}
    ORDER BY sub.submitted_at ASC LIMIT 100
  `).all(...clause.params);
  res.json({ submissions });
});

// ADMIN: list students with progress, optionally filter by class and/or gender — scoped.
router.get('/admin/students', requireAuth, requireStaff, (req, res) => {
  const { class_level, gender } = req.query;
  const scope = resolveScope(req.user);
  const conditions = ["role='student'"];
  const params = [];
  if (class_level) { conditions.push('class_level=?'); params.push(class_level); }
  if (gender) { conditions.push('gender=?'); params.push(gender); }

  // CRITICAL FIX: a Subject/Class Teacher (scoped, non-unrestricted) must
  // never see a pending/rejected registration in their Students list — only
  // an Admin/Academic Head can review and approve new registrations, so
  // only they get to see a student before that decision is made. A new
  // registration should be invisible everywhere in a teacher's portal
  // (Students module AND the Overview "Total Students" count, which was
  // already correctly filtering on approval_status='approved') until an
  // admin approves it — at which point it appears in both places for every
  // teacher whose scope covers that student's class/section.
  if (!scope.unrestricted) {
    conditions.push("approval_status='approved'");
  }

  const scopeClause = studentScopeClause(scope);
  conditions.push(scopeClause.sql);
  params.push(...scopeClause.params);

  const students = db.prepare(
    `SELECT id, name, email, class_level, gender, approval_status, xp, streak_count, created_at
     FROM users WHERE ${conditions.join(' AND ')} ORDER BY class_level, name`
  ).all(...params);

  const withStats = students.map((s, idx) => {
    const quizAvg = db.prepare('SELECT AVG(CAST(score AS FLOAT)/total*100) avg FROM quiz_attempts WHERE student_id=?').get(s.id).avg;
    const assignmentsDone = db.prepare('SELECT COUNT(*) c FROM submissions WHERE student_id=?').get(s.id).c;
    const materialsViewed = db.prepare('SELECT COUNT(DISTINCT material_id) c FROM material_views WHERE student_id=?').get(s.id).c;
    return { ...s, sn: idx + 1, quiz_avg: quizAvg ? Math.round(quizAvg) : null, assignments_done: assignmentsDone, materials_viewed: materialsViewed };
  });
  res.json({ students: withStats });
});

// ADMIN: full profile for a single student — all submissions, quiz attempts, and material views.
// Scoped: a Subject/Class Teacher can only open a profile for a student who
// is actually within one of their assigned class+section combinations.
router.get('/admin/students/:id', requireAuth, requireStaff, (req, res) => {
  const student = db.prepare(
    "SELECT id, name, email, class_level, section, gender, approval_status, xp, streak_count, longest_streak, created_at FROM users WHERE id = ? AND role='student'"
  ).get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const scope = resolveScope(req.user);
  if (!scope.unrestricted) {
    const combos = [...scope.classSections, ...scope.subjectAssignments.map(a => ({ class_level: a.class_level, section: a.section }))];
    const allowed = combos.some(c => c.class_level === student.class_level && (!c.section || c.section === student.section));
    if (!allowed) return res.status(403).json({ error: 'This student is outside your assigned classes/sections.' });
    // A Subject/Class Teacher can't open a not-yet-approved registration's
    // profile even by guessing/typing the ID directly — same rule as the
    // list endpoint above.
    if (student.approval_status !== 'approved') {
      return res.status(403).json({ error: 'This student registration has not been approved yet.' });
    }
  }


  const assignmentSubmissions = db.prepare(`
    SELECT sub.id, sub.status, sub.grade, sub.feedback, sub.submitted_at, sub.graded_at, sub.file_path,
           a.title as assignment_title, a.max_score, s.name as subject_name, s.color as subject_color
    FROM submissions sub
    JOIN assignments a ON sub.assignment_id = a.id
    JOIN subjects s ON a.subject_id = s.id
    WHERE sub.student_id = ?
    ORDER BY sub.submitted_at DESC
  `).all(student.id);

  const quizAttempts = db.prepare(`
    SELECT qa.id, qa.score, qa.total, qa.attempted_at, q.title as quiz_title, q.topic,
           s.name as subject_name, s.color as subject_color
    FROM quiz_attempts qa
    JOIN quizzes q ON qa.quiz_id = q.id
    JOIN subjects s ON q.subject_id = s.id
    WHERE qa.student_id = ?
    ORDER BY qa.attempted_at DESC
  `).all(student.id);

  const materialViews = db.prepare(`
    SELECT mv.viewed_at, m.title as material_title, m.type, s.name as subject_name, s.color as subject_color
    FROM material_views mv
    JOIN materials m ON mv.material_id = m.id
    JOIN subjects s ON m.subject_id = s.id
    WHERE mv.student_id = ?
    ORDER BY mv.viewed_at DESC
  `).all(student.id);

  const bySubject = {};
  for (const row of [...assignmentSubmissions.map(r => ({ ...r, kind: 'assignment' })), ...quizAttempts.map(r => ({ ...r, kind: 'quiz' })), ...materialViews.map(r => ({ ...r, kind: 'material' }))]) {
    const name = row.subject_name;
    if (!bySubject[name]) bySubject[name] = { subject_name: name, subject_color: row.subject_color, assignments: 0, quizzes: 0, materials: 0 };
    if (row.kind === 'assignment') bySubject[name].assignments++;
    if (row.kind === 'quiz') bySubject[name].quizzes++;
    if (row.kind === 'material') bySubject[name].materials++;
  }

  const quizAvg = quizAttempts.length
    ? Math.round(quizAttempts.reduce((sum, q) => sum + (q.score / q.total) * 100, 0) / quizAttempts.length)
    : null;
  const gradedSubs = assignmentSubmissions.filter(s => s.status === 'graded');
  const assignmentAvg = gradedSubs.length
    ? Math.round(gradedSubs.reduce((sum, s) => sum + (s.grade / s.max_score) * 100, 0) / gradedSubs.length)
    : null;

  res.json({
    student,
    summary: { quizAvg, assignmentAvg, totalMaterialsViewed: materialViews.length, totalQuizAttempts: quizAttempts.length, totalSubmissions: assignmentSubmissions.length },
    bySubject: Object.values(bySubject),
    assignmentSubmissions,
    quizAttempts,
    materialViews,
  });
});

export default router;
