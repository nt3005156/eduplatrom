import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAcademicHead } from '../middleware/auth.js';
import { requirePermission, hasPermission } from '../services/permissions.js';
import { logAudit } from '../utils/audit.js';
import { notifyUser } from '../utils/notify.js';

// Academic Head / Principal module — the "near-complete control" tier per
// the RBAC spec: view every class/subject/teacher, compare them against
// each other, override a grade after it's already been finalized (subject
// to an approval trail, not a silent edit), and clear an approval queue.
// Every route here requires the 'analytics.view_school_wide' permission for
// the read/compare endpoints (same permission Coordinator/Exam Coordinator
// already hold, so they naturally get the comparison views too — they just
// don't get override/approval rights, gated separately below by
// requireAcademicHead), matching "different roles, different depth of the
// same read-only data" rather than duplicating query logic per role.
const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// COMPARISON ANALYTICS — read-only, available to anyone holding
// 'analytics.view_school_wide' (Academic Head, Coordinator, Exam
// Coordinator, System Admin). This is the piece that was completely missing
// before: an Academic Head previously just saw the same admin Overview page
// as everyone else, with no way to actually compare one class/subject/
// teacher against another.
// ---------------------------------------------------------------------------

// GET /api/academic-head/compare/classes — per-class rollup: student count,
// average quiz score, average assignment grade, assignment completion rate.
router.get('/compare/classes', requirePermission('analytics.view_school_wide'), (req, res) => {
  const classes = db.prepare(`
    SELECT DISTINCT class_level FROM users WHERE role = 'student' AND approval_status = 'approved' ORDER BY class_level
  `).all().map(r => r.class_level);

  const rows = classes.map(cls => {
    const studentCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='student' AND approval_status='approved' AND class_level=?`).get(cls).c;

    const quizStats = db.prepare(`
      SELECT AVG(CAST(qa.score AS FLOAT)/qa.total*100) avg_pct, COUNT(*) attempts
      FROM quiz_attempts qa JOIN users u ON qa.student_id = u.id
      WHERE u.class_level = ?
    `).get(cls);

    const gradeStats = db.prepare(`
      SELECT AVG(CAST(sub.grade AS FLOAT)/a.max_score*100) avg_pct, COUNT(*) graded
      FROM submissions sub JOIN assignments a ON sub.assignment_id = a.id
      WHERE a.class_level = ? AND sub.status IN ('graded','regraded') AND sub.grade IS NOT NULL
    `).get(cls);

    const completion = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM assignments WHERE class_level = ?) as total_assignments,
        (SELECT COUNT(*) FROM submissions sub JOIN assignments a ON sub.assignment_id = a.id WHERE a.class_level = ?) as total_submissions
    `).get(cls, cls);

    const expectedSubmissions = completion.total_assignments * studentCount;
    const completionPct = expectedSubmissions > 0 ? Math.round((completion.total_submissions / expectedSubmissions) * 100) : null;

    return {
      class_level: cls,
      student_count: studentCount,
      avg_quiz_pct: quizStats.avg_pct != null ? Math.round(quizStats.avg_pct) : null,
      quiz_attempts: quizStats.attempts,
      avg_grade_pct: gradeStats.avg_pct != null ? Math.round(gradeStats.avg_pct) : null,
      graded_count: gradeStats.graded,
      assignment_completion_pct: completionPct,
    };
  });

  res.json({ classes: rows });
});

// GET /api/academic-head/compare/subjects — per-subject rollup across the
// whole school (or filtered to one class via ?class_level=10), so an
// Academic Head can see "Mathematics is weaker school-wide than Science."
router.get('/compare/subjects', requirePermission('analytics.view_school_wide'), (req, res) => {
  const { class_level } = req.query;
  const clauses = [];
  const params = [];
  if (class_level) { clauses.push('sub_t.class_level = ?'); params.push(class_level); }
  const classFilter = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

  const subjects = db.prepare(`
    SELECT DISTINCT s.id, s.name, s.color, s.class_level as subject_class_level
    FROM subjects s ${class_level ? 'WHERE s.class_level = ?' : ''}
    ORDER BY s.class_level, s.name
  `).all(...(class_level ? [class_level] : []));

  const rows = subjects.map(subj => {
    const quizStats = db.prepare(`
      SELECT AVG(CAST(qa.score AS FLOAT)/qa.total*100) avg_pct, COUNT(*) attempts
      FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id
      WHERE q.subject_id = ?
    `).get(subj.id);

    const gradeStats = db.prepare(`
      SELECT AVG(CAST(sub.grade AS FLOAT)/a.max_score*100) avg_pct, COUNT(*) graded
      FROM submissions sub JOIN assignments a ON sub.assignment_id = a.id
      WHERE a.subject_id = ? AND sub.status IN ('graded','regraded') AND sub.grade IS NOT NULL
    `).get(subj.id);

    // Weak-chapter detection: quiz topics averaging under 60%, worst first.
    const weakTopics = db.prepare(`
      SELECT q.topic, AVG(CAST(qa.score AS FLOAT)/qa.total*100) avg_pct, COUNT(*) attempts
      FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id
      WHERE q.subject_id = ? AND q.topic IS NOT NULL AND q.topic != ''
      GROUP BY q.topic HAVING avg_pct < 60 ORDER BY avg_pct ASC LIMIT 3
    `).all(subj.id);

    return {
      subject_id: subj.id, subject_name: subj.name, subject_color: subj.color, class_level: subj.subject_class_level,
      avg_quiz_pct: quizStats.avg_pct != null ? Math.round(quizStats.avg_pct) : null,
      quiz_attempts: quizStats.attempts,
      avg_grade_pct: gradeStats.avg_pct != null ? Math.round(gradeStats.avg_pct) : null,
      graded_count: gradeStats.graded,
      weak_topics: weakTopics.map(t => ({ topic: t.topic, avg_pct: Math.round(t.avg_pct), attempts: t.attempts })),
    };
  });

  res.json({ subjects: rows });
});

// GET /api/academic-head/compare/teachers — per-teacher rollup: classes
// taught, content volume, grading turnaround, average outcome of their
// students, so an Academic Head can compare teachers against each other
// (not just workload counts like the Coordinator's existing view, but
// actual student-outcome quality).
router.get('/compare/teachers', requirePermission('analytics.view_school_wide'), (req, res) => {
  const teachers = db.prepare(`
    SELECT u.id, u.name, u.staff_role, u.account_status
    FROM users u WHERE u.role = 'teacher' ORDER BY u.name
  `).all();

  const rows = teachers.map(t => {
    const assignmentsCreated = db.prepare('SELECT COUNT(*) c FROM assignments WHERE created_by = ?').get(t.id).c;
    const quizzesCreated = db.prepare('SELECT COUNT(*) c FROM quizzes WHERE created_by = ?').get(t.id).c;

    const gradingStats = db.prepare(`
      SELECT
        COUNT(*) as total_graded,
        AVG(CAST((julianday(sub.graded_at) - julianday(sub.submitted_at)) AS FLOAT)) as avg_turnaround_days
      FROM submissions sub JOIN assignments a ON sub.assignment_id = a.id
      WHERE a.created_by = ? AND sub.status IN ('graded','regraded') AND sub.graded_at IS NOT NULL
    `).get(t.id);

    const studentOutcomes = db.prepare(`
      SELECT AVG(CAST(sub.grade AS FLOAT)/a.max_score*100) avg_pct
      FROM submissions sub JOIN assignments a ON sub.assignment_id = a.id
      WHERE a.created_by = ? AND sub.status IN ('graded','regraded') AND sub.grade IS NOT NULL
    `).get(t.id);

    const classCount = db.prepare(`
      SELECT COUNT(DISTINCT class_level || '-' || COALESCE(section,'')) c FROM teacher_assignments WHERE teacher_id = ?
    `).get(t.id).c;

    return {
      id: t.id, name: t.name, staff_role: t.staff_role, account_status: t.account_status,
      classes_taught: classCount,
      assignments_created: assignmentsCreated, quizzes_created: quizzesCreated,
      avg_student_outcome_pct: studentOutcomes.avg_pct != null ? Math.round(studentOutcomes.avg_pct) : null,
      total_graded: gradingStats.total_graded,
      avg_grading_turnaround_days: gradingStats.avg_turnaround_days != null ? Math.round(gradingStats.avg_turnaround_days * 10) / 10 : null,
    };
  });

  res.json({ teachers: rows });
});

// GET /api/academic-head/overview — top-level cards for the Academic Head
// landing page (distinct from Coordinator's overview: adds override/approval
// queue counts that only this tier acts on).
router.get('/overview', requirePermission('analytics.view_school_wide'), (req, res) => {
  const totalStudents = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND approval_status='approved'").get().c;
  const totalTeachers = db.prepare("SELECT COUNT(*) c FROM users WHERE role='teacher' AND account_status != 'disabled'").get().c;
  const totalClasses = db.prepare("SELECT COUNT(DISTINCT class_level) c FROM users WHERE role='student'").get().c;

  const schoolAvgQuizPct = db.prepare('SELECT AVG(CAST(score AS FLOAT)/total*100) avg FROM quiz_attempts').get().avg;
  const schoolAvgGradePct = db.prepare(`
    SELECT AVG(CAST(sub.grade AS FLOAT)/a.max_score*100) avg FROM submissions sub
    JOIN assignments a ON sub.assignment_id = a.id
    WHERE sub.status IN ('graded','regraded') AND sub.grade IS NOT NULL
  `).get().avg;

  const pendingApprovals = db.prepare("SELECT COUNT(*) c FROM approval_requests WHERE status = 'pending'").get().c;
  const pendingRegrades = db.prepare("SELECT COUNT(*) c FROM regrade_requests WHERE status = 'pending'").get().c;
  const pendingStudentApprovals = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND approval_status='pending'").get().c;

  res.json({
    totalStudents, totalTeachers, totalClasses,
    schoolAvgQuizPct: schoolAvgQuizPct != null ? Math.round(schoolAvgQuizPct) : null,
    schoolAvgGradePct: schoolAvgGradePct != null ? Math.round(schoolAvgGradePct) : null,
    pendingApprovals, pendingRegrades, pendingStudentApprovals,
  });
});

// ---------------------------------------------------------------------------
// GRADE OVERRIDE + APPROVAL WORKFLOW — Academic Head / System Admin only.
// This is the first real use of the 'grade.override' permission, which
// existed in the RBAC catalogue since Round 2 but was never wired to any
// route — an Academic Head previously had zero actual way to override a
// grade despite holding the permission.
//
// Design: overriding an ALREADY-FINALIZED grade (status graded/regraded)
// does not happen silently — it's logged as an approval_requests row with
// entity_type='grade_override', auto-approved and applied immediately by
// the Academic Head themselves (they have the authority to decide on the
// spot), but still leaves a full audit trail (reason required, previous +
// new value captured) exactly like the audit log's OldValue/NewValue
// requirement. A Coordinator/Exam Coordinator (who hold
// analytics.view_school_wide but NOT the override permission) can instead
// *request* the same override, which lands in the pending queue for the
// Academic Head to approve/reject — this is the literal "approval
// workflow" from the spec.
// ---------------------------------------------------------------------------

function loadSubmissionWithContext(subId) {
  return db.prepare(`
    SELECT sub.*, a.title as assignment_title, a.max_score, a.class_level, a.section, a.subject_id,
           s.name as subject_name, st.name as student_name
    FROM submissions sub
    JOIN assignments a ON sub.assignment_id = a.id
    JOIN subjects s ON a.subject_id = s.id
    JOIN users st ON sub.student_id = st.id
    WHERE sub.id = ?
  `).get(subId);
}

// PUT /api/academic-head/submissions/:subId/override-grade — apply
// immediately (Academic Head / System Admin only, via the 'grade.override'
// permission check below, doubled up with requireAcademicHead as a
// code-level backstop matching the pattern used elsewhere for admin_only
// permissions).
router.put('/submissions/:subId/override-grade', requireAcademicHead, requirePermission('grade.override'), (req, res) => {
  const { new_grade, reason } = req.body;
  if (new_grade === undefined || new_grade === null || isNaN(Number(new_grade))) {
    return res.status(400).json({ error: 'new_grade (a number) is required' });
  }
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to override a grade.' });

  const submission = loadSubmissionWithContext(req.params.subId);
  if (!submission) return res.status(404).json({ error: 'Submission not found' });

  const previousValue = { grade: submission.grade, status: submission.status };
  const proposedValue = { grade: Number(new_grade) };

  const tx = db.transaction(() => {
    db.prepare("UPDATE submissions SET grade = ?, status = 'regraded', graded_at = datetime('now'), graded_by = ? WHERE id = ?")
      .run(Number(new_grade), req.user.id, submission.id);
    db.prepare(`
      INSERT INTO grade_history (submission_id, grade, feedback, is_regrade, graded_by, graded_by_name)
      VALUES (?,?,?,1,?,?)
    `).run(submission.id, Number(new_grade), `Academic Head override: ${reason.trim()}`, req.user.id, req.user.name);
    db.prepare(`
      INSERT INTO approval_requests (entity_type, entity_id, requested_by, reason, proposed_value, previous_value, status, decided_by, decision_note, decided_at)
      VALUES ('grade_override', ?, ?, ?, ?, ?, 'approved', ?, 'Applied directly by Academic Head', datetime('now'))
    `).run(submission.id, req.user.id, reason.trim(), JSON.stringify(proposedValue), JSON.stringify(previousValue), req.user.id);
  });
  tx();

  notifyUser({
    user_id: submission.student_id, type: 'grade',
    title: `Grade overridden: ${submission.assignment_title}`,
    body: `An Academic Head updated your score to ${new_grade}/${submission.max_score}. Reason: ${reason.trim()}`,
    link: '/assignments', related_id: submission.assignment_id,
  });

  logAudit(req, {
    module: 'gradebook', action: 'grade_overridden',
    description: `${req.user.name} overrode the grade for "${submission.assignment_title}" (${submission.student_name}): ${submission.grade ?? '—'} -> ${new_grade}`,
    previousValue, newValue: proposedValue,
    metadata: { submission_id: submission.id, reason: reason.trim() },
  });

  res.json({ submission: db.prepare('SELECT * FROM submissions WHERE id = ?').get(submission.id) });
});

// POST /api/academic-head/submissions/:subId/request-override — for a role
// that holds 'analytics.view_school_wide' (Coordinator/Exam Coordinator)
// but NOT 'grade.override' — queues a request for the Academic Head to
// decide on instead of applying it themselves. This is the literal
// "approve workflows" requirement: someone below Academic Head can flag
// something for review, but cannot make the change unilaterally.
router.post('/submissions/:subId/request-override', requirePermission('analytics.view_school_wide'), (req, res) => {
  if (hasPermission(req.user, 'grade.override')) {
    return res.status(400).json({ error: 'You can apply this override directly via PUT /override-grade — no approval request needed.' });
  }
  const { proposed_grade, reason } = req.body;
  if (proposed_grade === undefined || proposed_grade === null || isNaN(Number(proposed_grade))) {
    return res.status(400).json({ error: 'proposed_grade (a number) is required' });
  }
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required.' });

  const submission = loadSubmissionWithContext(req.params.subId);
  if (!submission) return res.status(404).json({ error: 'Submission not found' });

  const info = db.prepare(`
    INSERT INTO approval_requests (entity_type, entity_id, requested_by, reason, proposed_value, previous_value, status)
    VALUES ('grade_override', ?, ?, ?, ?, ?, 'pending')
  `).run(
    submission.id, req.user.id, reason.trim(),
    JSON.stringify({ grade: Number(proposed_grade) }),
    JSON.stringify({ grade: submission.grade, status: submission.status }),
  );

  logAudit(req, {
    module: 'gradebook', action: 'override_requested',
    description: `${req.user.name} requested a grade override for "${submission.assignment_title}" (${submission.student_name}): ${submission.grade ?? '—'} -> ${proposed_grade}`,
    newValue: { proposed_grade, reason: reason.trim() },
    metadata: { submission_id: submission.id },
  });

  res.json({ request: db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(info.lastInsertRowid) });
});

// GET /api/academic-head/approval-queue — every pending approval_requests
// row, hydrated with the underlying submission/assignment/student context,
// for the Academic Head's "Approve Workflows" screen.
router.get('/approval-queue', requireAcademicHead, requirePermission('analytics.view_school_wide'), (req, res) => {
  const { status = 'pending' } = req.query;
  const requests = db.prepare(`
    SELECT ar.*, u.name as requested_by_name, d.name as decided_by_name
    FROM approval_requests ar
    JOIN users u ON ar.requested_by = u.id
    LEFT JOIN users d ON ar.decided_by = d.id
    WHERE ar.status = ?
    ORDER BY ar.created_at DESC
  `).all(status);

  const hydrated = requests.map(r => {
    if (r.entity_type === 'grade_override') {
      const submission = loadSubmissionWithContext(r.entity_id);
      return {
        ...r,
        proposed_value: JSON.parse(r.proposed_value || '{}'),
        previous_value: JSON.parse(r.previous_value || '{}'),
        context: submission ? {
          assignment_title: submission.assignment_title, subject_name: submission.subject_name,
          class_level: submission.class_level, section: submission.section, student_name: submission.student_name,
          current_grade: submission.grade, max_score: submission.max_score,
        } : null,
      };
    }
    return { ...r, proposed_value: JSON.parse(r.proposed_value || '{}'), previous_value: JSON.parse(r.previous_value || '{}') };
  });

  res.json({ requests: hydrated });
});

// PUT /api/academic-head/approval-queue/:id/decide — approve (applies the
// change) or reject a pending request.
router.put('/approval-queue/:id/decide', requireAcademicHead, requirePermission('grade.override'), (req, res) => {
  const { decision, decision_note } = req.body; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });

  const request = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'This request has already been decided.' });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE approval_requests SET status = ?, decided_by = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?`)
      .run(decision, req.user.id, decision_note || null, request.id);

    if (decision === 'approved' && request.entity_type === 'grade_override') {
      const proposed = JSON.parse(request.proposed_value || '{}');
      const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(request.entity_id);
      if (submission && proposed.grade !== undefined) {
        db.prepare("UPDATE submissions SET grade = ?, status = 'regraded', graded_at = datetime('now'), graded_by = ? WHERE id = ?")
          .run(proposed.grade, req.user.id, submission.id);
        db.prepare(`
          INSERT INTO grade_history (submission_id, grade, feedback, is_regrade, graded_by, graded_by_name)
          VALUES (?,?,?,1,?,?)
        `).run(submission.id, proposed.grade, `Approved override: ${request.reason}`, req.user.id, req.user.name);

        const assignment = db.prepare('SELECT title, max_score FROM assignments WHERE id = ?').get(submission.assignment_id);
        notifyUser({
          user_id: submission.student_id, type: 'grade',
          title: `Grade overridden: ${assignment?.title || ''}`,
          body: `Your score was updated to ${proposed.grade}/${assignment?.max_score ?? 100} following Academic Head review.`,
          link: '/assignments', related_id: submission.assignment_id,
        });
      }
    }
  });
  tx();

  logAudit(req, {
    module: 'gradebook', action: `override_${decision}`,
    description: `${req.user.name} ${decision} a grade override request (originally requested by user #${request.requested_by})`,
    previousValue: JSON.parse(request.previous_value || '{}'),
    newValue: JSON.parse(request.proposed_value || '{}'),
    metadata: { approval_request_id: request.id, decision_note },
  });

  res.json({ ok: true });
});

export default router;
