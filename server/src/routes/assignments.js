import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sanitizeHtml from 'sanitize-html';
import db from '../db/index.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import { notifyClass, notifyUser, notifyTeachersForClass } from '../utils/notify.js';
import { awardXp, touchStreak } from '../utils/gamification.js';
import { logAudit } from '../utils/audit.js';
import { resolveScope, isWithinScope, scopeWhereClause } from '../services/scope.js';

// Assignment descriptions support basic rich text (per the redesign spec), but the raw
// HTML comes from teacher input and is stored verbatim — sanitize server-side too as
// defense-in-depth (the client also sanitizes with DOMPurify before rendering).
const RICH_TEXT_OPTS = {
  allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'span'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
};
const sanitizeDescription = (html) => sanitizeHtml(html || '', RICH_TEXT_OPTS);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname)),
});

// Block dangerous executable/script file types regardless of what an individual
// assignment's allowed_file_types setting says — a security backstop that applies
// to every upload in this route (teacher attachments AND student submissions).
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.msi', '.com', '.scr', '.jar', '.js', '.vbs', '.ps1', '.app', '.dll',
]);
const uploadFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type "${ext}" is not allowed for security reasons.`));
  }
  cb(null, true);
};
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: uploadFileFilter });

const RESUBMISSION_REASONS = ['Wrong File', 'Missing Questions', 'Formatting Issues', 'Incomplete Work', 'Poor Quality', 'Plagiarism', 'Other'];

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function withAttachments(assignment) {
  const attachments = db.prepare('SELECT id, file_path, original_name FROM assignment_attachments WHERE assignment_id = ?').all(assignment.id);
  return { ...assignment, attachments, reference_links: safeParse(assignment.reference_links, []) };
}

/** Attach the rubric criteria (if any) to an assignment payload. */
function withRubric(assignment) {
  const rubric = db.prepare('SELECT * FROM assignment_rubrics WHERE assignment_id = ? ORDER BY order_index ASC, id ASC').all(assignment.id);
  return { ...assignment, rubric };
}

/**
 * Replace an assignment's rubric criteria in one transaction. `rubric` is
 * expected to be a JSON string or array of { criterion, max_points }.
 * Never touches existing submission_rubric_scores rows for criteria that
 * still exist by name+order — but since rubric editing is rare after
 * grading has started, the simplest safe behavior is: only allow rebuilding
 * the rubric definition; already-recorded scores reference rubric_id via a
 * cascading FK, so if a criterion is removed its recorded scores are removed
 * with it (acceptable, since the criterion itself no longer exists to grade).
 */
function saveRubric(assignmentId, rawRubric) {
  if (rawRubric === undefined) return; // caller didn't send a rubric field — leave existing rubric untouched
  let rubric = rawRubric;
  if (typeof rubric === 'string') { try { rubric = JSON.parse(rubric); } catch { rubric = []; } }
  if (!Array.isArray(rubric)) rubric = [];

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM assignment_rubrics WHERE assignment_id = ?').run(assignmentId);
    const insert = db.prepare('INSERT INTO assignment_rubrics (assignment_id, criterion, max_points, order_index) VALUES (?,?,?,?)');
    rubric.forEach((r, idx) => {
      if (!r.criterion || !r.criterion.trim()) return;
      insert.run(assignmentId, r.criterion.trim(), Number(r.max_points) || 10, idx);
    });
  });
  tx();
}

/** Effective status a STUDENT should see for an assignment row (never expose draft/hidden/not-yet-published). */
function isVisibleToStudents(assignment) {
  if (assignment.visibility === 'hidden') return false;
  if (assignment.status === 'draft' || assignment.status === 'archived') return false;
  if (assignment.status === 'scheduled' && assignment.publish_at && new Date(assignment.publish_at) > new Date()) return false;
  return true;
}

/** Compute the student-facing submission status label per the spec's status list. */
function computeSubmissionStatus(assignment, submission) {
  if (!submission) {
    if (assignment.due_date && new Date() > new Date(assignment.due_date)) return 'missing';
    return 'not_started';
  }
  return submission.status; // submitted | under_review | graded | resubmission_requested | resubmitted | regraded | closed | rejected_invalid
}

const router = Router();

/**
 * Blocks a staff request from touching an assignment (create/edit/delete/
 * grade/view-submissions) outside their own assigned class/section/subject.
 * CRITICAL FIX: none of the assignment write/list endpoints previously
 * checked this at all — a Subject Teacher scoped to one class+subject could
 * create, edit, or delete assignments for ANY class/subject in the school,
 * and the cross-class GET / listing returned every assignment regardless of
 * assignment ownership. This helper closes that gap without touching the
 * unrestricted (System Admin / Academic Head) code path.
 */
function assertAssignmentInScope(req, assignment) {
  if (req.user.role === 'admin') return null; // legacy fast-path, same as requireStaff's own bypass
  const scope = resolveScope(req.user);
  if (scope.unrestricted) return null;
  const inScope = isWithinScope(scope, {
    classLevel: assignment.class_level, section: assignment.section, subjectId: assignment.subject_id,
  });
  return inScope ? null : { status: 403, error: 'This assignment is outside your assigned classes/sections/subjects.' };
}

/** Same check but against a request BODY (for create), before any row exists yet. */
function assertTargetInScope(req, { class_level, section, subject_id }) {
  if (req.user.role === 'admin') return null;
  const scope = resolveScope(req.user);
  if (scope.unrestricted) return null;
  const inScope = isWithinScope(scope, { classLevel: class_level, section, subjectId: subject_id });
  return inScope ? null : { status: 403, error: 'You can only create assignments for classes/sections/subjects assigned to you.' };
}

/**
 * Looks up the parent assignment for a submission and scope-checks it —
 * used by every submission-mutating endpoint (grade, reject-invalid,
 * mark-late, request-resubmission, etc). Returns { assignment, scopeError }.
 */
function loadSubmissionAssignmentInScope(req, submissionId) {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
  if (!submission) return { error: { status: 404, error: 'Submission not found' } };
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(submission.assignment_id);
  if (!assignment) return { error: { status: 404, error: 'Assignment not found' } };
  const scopeError = assertAssignmentInScope(req, assignment);
  if (scopeError) return { error: scopeError };
  return { submission, assignment };
}

router.get('/resubmission-reasons', requireAuth, requireStaff, (req, res) => res.json({ reasons: RESUBMISSION_REASONS }));

// NOTE: this must be registered before the generic '/:id' route below, otherwise
// Express would treat "regrade-requests" as an :id value and never reach here.
// CRITICAL FIX: previously returned every regrade request school-wide to any
// staff member. Now scoped so a Subject/Class Teacher only ever sees regrade
// requests for assignments within their own assigned classes/sections/subjects.
router.get('/regrade-requests', requireAuth, requireStaff, (req, res) => {
  const { status } = req.query;
  const clauses = [];
  const params = [];
  if (status) { clauses.push('rr.status = ?'); params.push(status); }

  const scope = resolveScope(req.user);
  const scopeClause = scopeWhereClause(scope, { classLevel: 'a.class_level', section: 'a.section', subjectId: 'a.subject_id' });
  clauses.push(scopeClause.sql);
  params.push(...scopeClause.params);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const requests = db.prepare(`
    SELECT rr.*, u.name as student_name, sub.assignment_id, a.title as assignment_title, a.max_score
    FROM regrade_requests rr
    JOIN users u ON rr.student_id = u.id
    JOIN submissions sub ON rr.submission_id = sub.id
    JOIN assignments a ON sub.assignment_id = a.id
    ${where}
    ORDER BY rr.requested_at DESC
  `).all(...params);
  res.json({ requests });
});

// GET /api/assignments — cross-class listing for staff, honoring the global
// class/subject filter pattern (omit class_level/subject_id for "All Classes"/"All Subjects").
// CRITICAL FIX: this used to return every assignment in the school to any
// staff member — now always additionally restricted to the caller's own
// scope (System Admin / Academic Head remain unrestricted).
router.get('/', requireAuth, requireStaff, (req, res) => {
  const { class_level, subject_id, status } = req.query;
  const clauses = [];
  const params = [];
  if (class_level) { clauses.push('a.class_level = ?'); params.push(class_level); }
  if (subject_id) { clauses.push('a.subject_id = ?'); params.push(subject_id); }
  if (status) { clauses.push('a.status = ?'); params.push(status); }

  const scope = resolveScope(req.user);
  const scopeClause = scopeWhereClause(scope, { classLevel: 'a.class_level', section: 'a.section', subjectId: 'a.subject_id' });
  clauses.push(scopeClause.sql);
  params.push(...scopeClause.params);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const assignments = db.prepare(`
    SELECT a.*, s.name as subject_name, s.color as subject_color
    FROM assignments a JOIN subjects s ON a.subject_id = s.id
    ${where} ORDER BY a.created_at DESC
  `).all(...params);

  const withCounts = assignments.map(a => {
    const total = db.prepare('SELECT COUNT(*) c FROM submissions WHERE assignment_id=?').get(a.id).c;
    const pending = db.prepare("SELECT COUNT(*) c FROM submissions WHERE assignment_id=? AND status IN ('submitted','under_review','resubmitted')").get(a.id).c;
    return withRubric(withAttachments({ ...a, submission_count: total, pending_grading: pending }));
  });
  res.json({ assignments: withCounts });
});

router.get('/class/:cls', requireAuth, (req, res) => {
  const assignments = db.prepare(`
    SELECT a.*, s.name as subject_name, s.color as subject_color
    FROM assignments a JOIN subjects s ON a.subject_id = s.id
    WHERE a.class_level = ? ORDER BY a.due_date ASC
  `).all(req.params.cls);

  if (req.user.role === 'student') {
    const visible = assignments.filter(isVisibleToStudents).filter(a => !a.section || a.section === req.user.section);
    const withStatus = visible.map(a => {
      const sub = db.prepare('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?').get(a.id, req.user.id);
      // The submission's `attachments` column is stored as a JSON string — it
      // must always be parsed into a real array before reaching the client,
      // otherwise `.map()`/`.length` calls on it crash the frontend (this was
      // a real bug: this listing endpoint forgot to parse it while other
      // submission-returning endpoints in this file correctly do).
      const parsedSub = sub ? { ...sub, attachments: safeParse(sub.attachments, []) } : null;
      return withRubric(withAttachments({ ...a, submission: parsedSub, student_status: computeSubmissionStatus(a, sub) }));
    });
    return res.json({ assignments: withStatus });
  }

  // Staff branch: still scoped, so a direct API call can't be used to bypass
  // the class/section/subject restriction the UI already enforces.
  const scope = resolveScope(req.user);
  const inScopeAssignments = scope.unrestricted
    ? assignments
    : assignments.filter(a => isWithinScope(scope, { classLevel: a.class_level, section: a.section, subjectId: a.subject_id }));

  const withCounts = inScopeAssignments.map(a => {
    const total = db.prepare('SELECT COUNT(*) c FROM submissions WHERE assignment_id=?').get(a.id).c;
    const pending = db.prepare("SELECT COUNT(*) c FROM submissions WHERE assignment_id=? AND status IN ('submitted','under_review','resubmitted')").get(a.id).c;
    return withRubric(withAttachments({ ...a, submission_count: total, pending_grading: pending }));
  });
  res.json({ assignments: withCounts });
});

router.get('/subject/:subjectId', requireAuth, (req, res) => {
  const assignments = db.prepare('SELECT * FROM assignments WHERE subject_id = ? ORDER BY due_date ASC').all(req.params.subjectId);
  if (req.user.role === 'student') {
    return res.json({ assignments: assignments.filter(isVisibleToStudents).map(withAttachments) });
  }
  const scope = resolveScope(req.user);
  const inScope = scope.unrestricted
    ? assignments
    : assignments.filter(a => isWithinScope(scope, { classLevel: a.class_level, section: a.section, subjectId: a.subject_id }));
  res.json({ assignments: inScope.map(withAttachments) });
});

router.get('/:id', requireAuth, (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (req.user.role === 'student' && !isVisibleToStudents(assignment)) {
    return res.status(404).json({ error: 'Assignment not found' });
  }
  if (req.user.role !== 'student') {
    const scopeError = assertAssignmentInScope(req, assignment);
    if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  }
  res.json({ assignment: withRubric(withAttachments(assignment)) });
});

function parseReferenceLinks(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

router.post('/', requireAuth, requireStaff, requirePermission('assignment.create'), upload.array('attachments', 10), (req, res) => {
  const {
    subject_id, class_level, section, title, chapter, description, instructions, due_date, publish_at,
    max_score, passing_score, allow_late, late_penalty_pct, allow_resubmission, max_resubmissions,
    allow_regrade_requests, allowed_file_types, max_upload_size_mb, status, visibility, reference_links,
  } = req.body;
  if (!subject_id || !class_level || !title) return res.status(400).json({ error: 'subject_id, class_level, title required' });

  const scopeError = assertTargetInScope(req, { class_level, section, subject_id });
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const finalStatus = ['draft', 'scheduled', 'published', 'archived'].includes(status) ? status : 'published';
  const firstFile = (req.files || [])[0];
  const legacyFilePath = firstFile ? `/uploads/${firstFile.filename}` : null;

  const info = db.prepare(`
    INSERT INTO assignments (
      subject_id, class_level, section, title, chapter, description, instructions, reference_links, file_path,
      due_date, publish_at, max_score, passing_score, allow_late, late_penalty_pct, allow_resubmission,
      max_resubmissions, allow_regrade_requests, allowed_file_types, max_upload_size_mb, status, visibility, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    subject_id, class_level, section || null, title, chapter || null, sanitizeDescription(description), instructions || '',
    JSON.stringify(parseReferenceLinks(reference_links)), legacyFilePath, due_date || null, publish_at || null,
    max_score || 100, passing_score || null, allow_late ? 1 : 0, Number(late_penalty_pct) || 0,
    allow_resubmission === undefined ? 1 : (allow_resubmission ? 1 : 0), Number(max_resubmissions) || 3,
    allow_regrade_requests === undefined ? 1 : (allow_regrade_requests ? 1 : 0), allowed_file_types || null,
    Number(max_upload_size_mb) || 25, finalStatus, visibility || 'visible', req.user.id
  );
  const assignmentId = info.lastInsertRowid;

  if (req.files && req.files.length) {
    const insertAtt = db.prepare('INSERT INTO assignment_attachments (assignment_id, file_path, original_name) VALUES (?,?,?)');
    for (const f of req.files) insertAtt.run(assignmentId, `/uploads/${f.filename}`, f.originalname);
  }

  saveRubric(assignmentId, req.body.rubric);

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(subject_id);

  if (finalStatus === 'published') {
    notifyClass({
      class_level: Number(class_level),
      type: 'assignment',
      title: `New assignment: ${title}`,
      body: `${subject?.name || 'Subject'}${due_date ? ` • Due ${new Date(due_date).toLocaleDateString()}` : ''}`,
      link: '/assignments',
      related_id: assignmentId,
    });
  }

  logAudit(req, {
    module: 'assignments', action: 'created',
    description: `${req.user.name} created assignment "${title}" (Class ${class_level}, ${subject?.name || 'subject'}) as ${finalStatus}`,
    newValue: { title, subject_id, class_level, due_date, max_score, status: finalStatus },
  });

  res.json({ assignment: withRubric(withAttachments(assignment)) });
});

router.put('/:id', requireAuth, requireStaff, requirePermission('assignment.publish'), upload.array('attachments', 10), (req, res) => {
  const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Assignment not found' });

  // Must be in scope for the assignment's CURRENT class/subject...
  let scopeError = assertAssignmentInScope(req, existing);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  // ...and, if the request is moving it to a different class/section/subject,
  // also in scope for the NEW target (prevents "reassigning" someone else's
  // assignment into your own scope, or moving your assignment into a class
  // you don't teach).
  const targetClass = req.body.class_level !== undefined ? req.body.class_level : existing.class_level;
  const targetSection = req.body.section !== undefined ? req.body.section : existing.section;
  const targetSubject = req.body.subject_id !== undefined ? req.body.subject_id : existing.subject_id;
  scopeError = assertTargetInScope(req, { class_level: targetClass, section: targetSection, subject_id: targetSubject });
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const fields = [
    'title', 'chapter', 'description', 'instructions', 'due_date', 'publish_at', 'max_score', 'passing_score',
    'allow_late', 'late_penalty_pct', 'allow_resubmission', 'max_resubmissions', 'allow_regrade_requests',
    'allowed_file_types', 'max_upload_size_mb', 'status', 'visibility', 'section', 'subject_id', 'class_level',
  ];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  if (updates.description !== undefined) updates.description = sanitizeDescription(updates.description);
  if (req.body.reference_links !== undefined) updates.reference_links = JSON.stringify(parseReferenceLinks(req.body.reference_links));

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  if (setClause) {
    db.prepare(`UPDATE assignments SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(updates), req.params.id);
  }

  if (req.files && req.files.length) {
    const insertAtt = db.prepare('INSERT INTO assignment_attachments (assignment_id, file_path, original_name) VALUES (?,?,?)');
    for (const f of req.files) insertAtt.run(req.params.id, `/uploads/${f.filename}`, f.originalname);
  }

  saveRubric(req.params.id, req.body.rubric);

  const wasDraft = existing.status === 'draft';
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (wasDraft && assignment.status === 'published') {
    const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(assignment.subject_id);
    notifyClass({
      class_level: assignment.class_level, type: 'assignment',
      title: `New assignment: ${assignment.title}`,
      body: `${subject?.name || 'Subject'}${assignment.due_date ? ` • Due ${new Date(assignment.due_date).toLocaleDateString()}` : ''}`,
      link: '/assignments', related_id: assignment.id,
    });
  }

  logAudit(req, {
    module: 'assignments', action: 'edited',
    description: `${req.user.name} edited assignment "${assignment.title}"`,
    previousValue: { status: existing.status }, newValue: { status: assignment.status },
  });

  res.json({ assignment: withRubric(withAttachments(assignment)) });
});

router.post('/:id/duplicate', requireAuth, requireStaff, requirePermission('assignment.create'), (req, res) => {
  const original = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Assignment not found' });
  const scopeError = assertAssignmentInScope(req, original);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const info = db.prepare(`
    INSERT INTO assignments (
      subject_id, class_level, section, title, chapter, description, instructions, reference_links, file_path,
      due_date, publish_at, max_score, passing_score, allow_late, late_penalty_pct, allow_resubmission,
      max_resubmissions, allow_regrade_requests, allowed_file_types, max_upload_size_mb, status, visibility,
      duplicated_from, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    original.subject_id, original.class_level, original.section, `${original.title} (Copy)`, original.chapter,
    original.description, original.instructions, original.reference_links, original.file_path, null, null,
    original.max_score, original.passing_score, original.allow_late, original.late_penalty_pct,
    original.allow_resubmission, original.max_resubmissions, original.allow_regrade_requests,
    original.allowed_file_types, original.max_upload_size_mb, 'draft', original.visibility, original.id, req.user.id
  );
  const newId = info.lastInsertRowid;

  const attachments = db.prepare('SELECT file_path, original_name FROM assignment_attachments WHERE assignment_id = ?').all(original.id);
  const insertAtt = db.prepare('INSERT INTO assignment_attachments (assignment_id, file_path, original_name) VALUES (?,?,?)');
  for (const att of attachments) insertAtt.run(newId, att.file_path, att.original_name);

  const rubric = db.prepare('SELECT * FROM assignment_rubrics WHERE assignment_id = ? ORDER BY order_index ASC').all(original.id);
  const insertRubric = db.prepare('INSERT INTO assignment_rubrics (assignment_id, criterion, max_points, order_index) VALUES (?,?,?,?)');
  for (const r of rubric) insertRubric.run(newId, r.criterion, r.max_points, r.order_index);

  logAudit(req, { module: 'assignments', action: 'duplicated', description: `${req.user.name} duplicated assignment "${original.title}"` });

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(newId);
  res.json({ assignment: withRubric(withAttachments(assignment)) });
});

router.put('/:id/archive', requireAuth, requireStaff, requirePermission('assignment.publish'), (req, res) => {
  const existing = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Assignment not found' });
  const scopeError = assertAssignmentInScope(req, existing);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  db.prepare("UPDATE assignments SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req, { module: 'assignments', action: 'archived', description: `${req.user.name} archived assignment "${existing.title}"` });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireStaff, requirePermission('assignment.delete'), (req, res) => {
  const a = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const scopeError = assertAssignmentInScope(req, a);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });
  db.prepare('DELETE FROM assignments WHERE id = ?').run(req.params.id);
  logAudit(req, {
    module: 'assignments', action: 'deleted',
    description: `${req.user.name} deleted assignment "${a.title}"`,
    previousValue: { title: a.title },
  });
  res.json({ ok: true });
});

// --- Student submission workflow ---

function computeLateAndPenalty(assignment) {
  const isLate = !!(assignment.due_date && new Date() > new Date(assignment.due_date));
  return { isLate, penaltyPct: isLate ? (assignment.late_penalty_pct || 0) : 0 };
}

// Student submits (or saves a draft of) their work. status=draft|submitted controls behavior.
router.post('/:id/submit', requireAuth, upload.array('attachments', 10), (req, res) => {
  const assignmentId = req.params.id;
  const { note, save_as_draft } = req.body;
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  const { isLate } = computeLateAndPenalty(assignment);
  if (isLate && !assignment.allow_late) {
    return res.status(400).json({ error: 'This assignment no longer accepts submissions — the due date has passed.' });
  }

  // Enforce this specific assignment's allowed file types / max upload size, if configured.
  if (req.files?.length && assignment.allowed_file_types) {
    const allowedExts = assignment.allowed_file_types.split(',').map(e => e.trim().toLowerCase().replace(/^\./, ''));
    const invalid = req.files.find(f => !allowedExts.includes(path.extname(f.originalname).slice(1).toLowerCase()));
    if (invalid) {
      for (const f of req.files) fs.unlinkSync(path.join(UPLOAD_DIR, f.filename));
      return res.status(400).json({ error: `Only these file types are allowed for this assignment: ${assignment.allowed_file_types}` });
    }
  }
  if (req.files?.length && assignment.max_upload_size_mb) {
    const maxBytes = assignment.max_upload_size_mb * 1024 * 1024;
    const tooLarge = req.files.find(f => f.size > maxBytes);
    if (tooLarge) {
      for (const f of req.files) fs.unlinkSync(path.join(UPLOAD_DIR, f.filename));
      return res.status(400).json({ error: `Files must be under ${assignment.max_upload_size_mb}MB for this assignment.` });
    }
  }

  const attachments = (req.files || []).map(f => ({ path: `/uploads/${f.filename}`, name: f.originalname }));
  const primaryFilePath = attachments[0]?.path || null;
  const existing = db.prepare('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?').get(assignmentId, req.user.id);
  const isDraft = save_as_draft === 'true' || save_as_draft === true;
  const nextStatus = isDraft ? 'draft' : (isLate ? 'submitted' : 'submitted');

  const finalAttachments = attachments.length ? attachments : (existing ? safeParse(existing.attachments, []) : []);
  const finalFilePath = primaryFilePath || existing?.file_path || null;

  let submissionId;
  if (existing) {
    // Enforce max resubmission count once the student has already submitted for real at least once.
    if (!isDraft && existing.status !== 'draft' && assignment.allow_resubmission && existing.version_count >= (assignment.max_resubmissions || 3) + 1) {
      return res.status(400).json({ error: `Maximum resubmissions (${assignment.max_resubmissions}) reached for this assignment.` });
    }
    const nextVersionCount = isDraft ? existing.version_count : existing.version_count + 1;
    db.prepare(`
      UPDATE submissions SET file_path=?, attachments=?, note=?, status=?, is_late=?, version_count=?, submitted_at=datetime('now')
      WHERE id=?
    `).run(finalFilePath, JSON.stringify(finalAttachments), note || '', nextStatus, isLate ? 1 : 0, nextVersionCount, existing.id);
    submissionId = existing.id;
  } else {
    const info = db.prepare(`
      INSERT INTO submissions (assignment_id, student_id, file_path, attachments, note, status, is_late, version_count)
      VALUES (?,?,?,?,?,?,?,1)
    `).run(assignmentId, req.user.id, finalFilePath, JSON.stringify(finalAttachments), note || '', nextStatus, isLate ? 1 : 0);
    submissionId = info.lastInsertRowid;
  }

  if (!isDraft) {
    const submissionRow = db.prepare('SELECT version_count FROM submissions WHERE id = ?').get(submissionId);
    db.prepare(`
      INSERT INTO submission_versions (submission_id, assignment_id, student_id, version_number, file_path, note, is_late)
      VALUES (?,?,?,?,?,?,?)
    `).run(submissionId, assignmentId, req.user.id, submissionRow.version_count, finalFilePath, note || '', isLate ? 1 : 0);
  }

  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);

  if (!isDraft) {
    const streak = touchStreak(req.user.id);
    const xpResult = existing?.submitted_at ? null : awardXp(req.user.id, 'assignment_submit', 'assignment', assignmentId);

    // Notify only the teacher(s) actually assigned to this class/section/
    // subject (via teacher_assignments), plus admins — not every teacher in
    // the school, which was the old behavior.
    notifyTeachersForClass({
      class_level: assignment.class_level, section: assignment.section, subject_id: assignment.subject_id,
      type: 'assignment',
      title: `${req.user.name} submitted: ${assignment.title}`,
      body: `${isLate ? 'Late submission' : 'New submission'} — review it now`,
      link: '/admin/assignments',
      related_id: assignment.id,
    });

    logAudit(req, {
      module: 'assignments', action: existing?.submitted_at ? 'resubmitted' : 'submitted',
      description: `${req.user.name} ${existing?.submitted_at ? 'resubmitted' : 'submitted'} "${assignment.title}"${isLate ? ' (late)' : ''}`,
      metadata: { assignment_id: assignment.id, late: isLate },
    });

    return res.json({ submission: { ...submission, attachments: safeParse(submission.attachments, []) }, xp: xpResult, streak });
  }

  res.json({ submission: { ...submission, attachments: safeParse(submission.attachments, []) } });
});

// Full permanent version history for a submission (never overwritten)
router.get('/submissions/:subId/versions', requireAuth, (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.subId);
  if (!submission) return res.status(404).json({ error: 'Submission not found' });
  if (req.user.role === 'student' && submission.student_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const versions = db.prepare('SELECT * FROM submission_versions WHERE submission_id = ? ORDER BY version_number ASC').all(req.params.subId);
  res.json({ versions });
});

// Staff: list all submissions for an assignment
router.get('/:id/submissions', requireAuth, requireStaff, (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const scopeError = assertAssignmentInScope(req, assignment);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const submissions = db.prepare(`
    SELECT sub.*, u.name as student_name, u.class_level
    FROM submissions sub JOIN users u ON sub.student_id = u.id
    WHERE sub.assignment_id = ? ORDER BY sub.submitted_at DESC
  `).all(req.params.id);
  res.json({ submissions: submissions.map(s => ({ ...s, attachments: safeParse(s.attachments, []) })) });
});

// --- Grading ---

// GET /assignments/submissions/:subId/rubric-scores — the rubric (criteria +
// max points) alongside any scores already recorded for this submission, so
// both the teacher's grading UI and the student's feedback view can render
// a per-criterion breakdown.
router.get('/submissions/:subId/rubric-scores', requireAuth, (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.subId);
  if (!submission) return res.status(404).json({ error: 'Submission not found' });
  if (req.user.role === 'student' && submission.student_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const rubric = db.prepare('SELECT * FROM assignment_rubrics WHERE assignment_id = ? ORDER BY order_index ASC, id ASC').all(submission.assignment_id);
  const scores = db.prepare('SELECT * FROM submission_rubric_scores WHERE submission_id = ?').all(req.params.subId);
  const scoreByRubric = Object.fromEntries(scores.map(s => [s.rubric_id, s]));

  res.json({
    rubric: rubric.map(r => ({ ...r, score: scoreByRubric[r.id]?.score ?? null, comment: scoreByRubric[r.id]?.comment ?? null })),
  });
});

router.put('/submissions/:subId/grade', requireAuth, requireStaff, requirePermission('grade.create'), (req, res) => {
  const { feedback, save_as_draft, rubric_scores } = req.body;
  let { grade } = req.body;
  const scoped = loadSubmissionAssignmentInScope(req, req.params.subId);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });
  const existing = scoped.submission;
  const wasAlreadyGraded = existing.status === 'graded' || existing.status === 'regraded';
  const isDraftGrade = save_as_draft === true || save_as_draft === 'true';

  // If the teacher graded via rubric (a per-criterion score list), the total
  // grade is derived automatically from those scores rather than trusting a
  // separately-typed `grade` value that could drift out of sync.
  if (Array.isArray(rubric_scores) && rubric_scores.length > 0) {
    grade = rubric_scores.reduce((sum, r) => sum + (Number(r.score) || 0), 0);
    const tx = db.transaction(() => {
      for (const r of rubric_scores) {
        db.prepare(`
          INSERT INTO submission_rubric_scores (submission_id, rubric_id, score, comment)
          VALUES (?,?,?,?)
          ON CONFLICT(submission_id, rubric_id) DO UPDATE SET score = excluded.score, comment = excluded.comment
        `).run(req.params.subId, r.rubric_id, Number(r.score) || 0, r.comment || null);
      }
    });
    tx();
  }

  const nextStatus = isDraftGrade ? existing.status : (wasAlreadyGraded ? 'regraded' : 'graded');
  db.prepare("UPDATE submissions SET grade=?, feedback=?, status=?, graded_at=datetime('now'), graded_by=? WHERE id=?")
    .run(grade, feedback || '', nextStatus, req.user.id, req.params.subId);

  if (!isDraftGrade) {
    db.prepare(`
      INSERT INTO grade_history (submission_id, grade, feedback, is_regrade, graded_by, graded_by_name)
      VALUES (?,?,?,?,?,?)
    `).run(req.params.subId, grade, feedback || '', wasAlreadyGraded ? 1 : 0, req.user.id, req.user.name);
  }

  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.subId);
  const assignment = db.prepare('SELECT title, max_score FROM assignments WHERE id = ?').get(submission.assignment_id);

  if (!isDraftGrade) {
    notifyUser({
      user_id: submission.student_id,
      type: 'grade',
      title: `${wasAlreadyGraded ? 'Grade updated' : 'Assignment graded'}: ${assignment?.title || ''}`,
      body: `You scored ${grade}/${assignment?.max_score ?? 100}${feedback ? ` — "${feedback}"` : ''}`,
      link: '/assignments',
      related_id: submission.assignment_id,
    });

    logAudit(req, {
      module: 'assignments', action: wasAlreadyGraded ? 'regraded' : 'graded',
      description: `${req.user.name} graded submission for "${assignment?.title || ''}": ${grade}/${assignment?.max_score ?? 100}`,
      previousValue: wasAlreadyGraded ? { grade: existing.grade, feedback: existing.feedback } : null,
      newValue: { grade, feedback },
    });
  }

  res.json({ submission, wasAlreadyGraded });
});

router.get('/submissions/:subId/grade-history', requireAuth, requireStaff, (req, res) => {
  const scoped = loadSubmissionAssignmentInScope(req, req.params.subId);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });
  const history = db.prepare('SELECT * FROM grade_history WHERE submission_id = ? ORDER BY graded_at ASC').all(req.params.subId);
  res.json({ history });
});

router.put('/submissions/:subId/reject-invalid', requireAuth, requireStaff, requirePermission('grade.create'), (req, res) => {
  const { reason } = req.body;
  const scoped = loadSubmissionAssignmentInScope(req, req.params.subId);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });
  const existing = scoped.submission;
  db.prepare("UPDATE submissions SET status = 'rejected_invalid', feedback = ? WHERE id = ?").run(reason || existing.feedback, req.params.subId);

  notifyUser({
    user_id: existing.student_id, type: 'assignment',
    title: 'Submission marked invalid', body: reason || 'Your teacher marked this submission as invalid. Please resubmit.',
    link: '/assignments', related_id: existing.assignment_id,
  });
  logAudit(req, { module: 'assignments', action: 'rejected_invalid', description: `${req.user.name} marked a submission invalid`, newValue: { reason } });
  res.json({ ok: true });
});

router.put('/submissions/:subId/mark-late', requireAuth, requireStaff, requirePermission('grade.create'), (req, res) => {
  const scoped = loadSubmissionAssignmentInScope(req, req.params.subId);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });
  db.prepare('UPDATE submissions SET is_late = 1 WHERE id = ?').run(req.params.subId);
  logAudit(req, { module: 'assignments', action: 'marked_late', description: `${req.user.name} manually marked a submission as late` });
  res.json({ ok: true });
});

// --- Resubmission Workflow (teacher requests, student resubmits) ---

router.post('/submissions/:subId/request-resubmission', requireAuth, requireStaff, requirePermission('grade.create'), (req, res) => {
  const { reason, custom_reason, new_deadline } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const scoped = loadSubmissionAssignmentInScope(req, req.params.subId);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });
  const submission = scoped.submission;

  db.prepare(`
    INSERT INTO resubmission_requests (submission_id, requested_by, reason, custom_reason, new_deadline)
    VALUES (?,?,?,?,?)
  `).run(req.params.subId, req.user.id, reason, custom_reason || null, new_deadline || null);

  db.prepare("UPDATE submissions SET status = 'resubmission_requested' WHERE id = ?").run(req.params.subId);

  if (new_deadline) {
    db.prepare('UPDATE assignments SET due_date = ? WHERE id = ?').run(new_deadline, submission.assignment_id);
  }

  const assignment = db.prepare('SELECT title FROM assignments WHERE id = ?').get(submission.assignment_id);
  notifyUser({
    user_id: submission.student_id, type: 'assignment',
    title: `Resubmission requested: ${assignment?.title || ''}`,
    body: `Reason: ${reason === 'Other' ? custom_reason : reason}${new_deadline ? ` — New deadline: ${new Date(new_deadline).toLocaleString()}` : ''}`,
    link: '/assignments', related_id: submission.assignment_id,
  });

  logAudit(req, {
    module: 'assignments', action: 'resubmission_requested',
    description: `${req.user.name} requested a resubmission for "${assignment?.title || ''}" — ${reason}`,
    newValue: { reason, custom_reason, new_deadline },
  });

  res.json({ ok: true });
});

// --- Regrade Workflow (student requests, teacher approves/rejects/regrades) ---

router.post('/submissions/:subId/regrade-request', requireAuth, upload.single('attachment'), (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.subId);
  if (!submission) return res.status(404).json({ error: 'Submission not found' });
  if (submission.student_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const assignment = db.prepare('SELECT allow_regrade_requests, title, class_level, section, subject_id FROM assignments WHERE id = ?').get(submission.assignment_id);
  if (assignment && !assignment.allow_regrade_requests) {
    return res.status(400).json({ error: 'Regrade requests are not allowed for this assignment' });
  }

  const attachmentPath = req.file ? `/uploads/${req.file.filename}` : null;
  const info = db.prepare(`
    INSERT INTO regrade_requests (submission_id, student_id, reason, attachment_path, previous_grade)
    VALUES (?,?,?,?,?)
  `).run(req.params.subId, req.user.id, reason, attachmentPath, submission.grade);

  notifyTeachersForClass({
    class_level: assignment?.class_level, section: assignment?.section, subject_id: assignment?.subject_id,
    type: 'assignment', title: `Regrade requested: ${assignment?.title || ''}`,
    body: `${req.user.name}: ${reason}`, link: '/admin/assignments', related_id: submission.assignment_id,
  });

  logAudit(req, {
    module: 'assignments', action: 'regrade_requested',
    description: `${req.user.name} requested a regrade for "${assignment?.title || ''}"`,
    newValue: { reason }, actorOverride: req.user,
  });

  res.json({ request: db.prepare('SELECT * FROM regrade_requests WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/regrade-requests/:id/decide', requireAuth, requireStaff, requirePermission('grade.create'), (req, res) => {
  const { decision, teacher_response, new_grade } = req.body; // decision: 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });

  const request = db.prepare('SELECT * FROM regrade_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const scoped = loadSubmissionAssignmentInScope(req, request.submission_id);
  if (scoped.error) return res.status(scoped.error.status).json({ error: scoped.error.error });

  db.prepare(`
    UPDATE regrade_requests SET status = ?, teacher_response = ?, new_grade = ?, resolved_at = datetime('now'), resolved_by = ?
    WHERE id = ?
  `).run(decision, teacher_response || null, decision === 'approved' ? (new_grade ?? null) : null, req.user.id, req.params.id);

  if (decision === 'approved' && new_grade !== undefined && new_grade !== null) {
    const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(request.submission_id);
    db.prepare("UPDATE submissions SET grade = ?, status = 'regraded', graded_at = datetime('now'), graded_by = ? WHERE id = ?")
      .run(new_grade, req.user.id, request.submission_id);
    db.prepare(`
      INSERT INTO grade_history (submission_id, grade, feedback, is_regrade, graded_by, graded_by_name)
      VALUES (?,?,?,1,?,?)
    `).run(request.submission_id, new_grade, teacher_response || 'Regrade request approved', req.user.id, req.user.name);

    const assignment = db.prepare('SELECT title, max_score FROM assignments WHERE id = ?').get(submission.assignment_id);
    notifyUser({
      user_id: request.student_id, type: 'grade',
      title: `Regrade approved: ${assignment?.title || ''}`,
      body: `Your new score is ${new_grade}/${assignment?.max_score ?? 100}`,
      link: '/assignments', related_id: submission.assignment_id,
    });
  } else if (decision === 'rejected') {
    const submission = db.prepare('SELECT assignment_id FROM submissions WHERE id = ?').get(request.submission_id);
    notifyUser({
      user_id: request.student_id, type: 'grade',
      title: 'Regrade request declined',
      body: teacher_response || 'Your regrade request was reviewed and the original grade stands.',
      link: '/assignments', related_id: submission?.assignment_id,
    });
  }

  logAudit(req, {
    module: 'assignments', action: `regrade_${decision}`,
    description: `${req.user.name} ${decision} a regrade request`,
    newValue: { decision, new_grade, teacher_response },
  });

  res.json({ ok: true });
});

// --- Analytics ---

router.get('/:id/analytics', requireAuth, requireStaff, (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const scopeError = assertAssignmentInScope(req, assignment);
  if (scopeError) return res.status(scopeError.status).json({ error: scopeError.error });

  const totalStudents = db.prepare("SELECT COUNT(*) c FROM users WHERE role='student' AND class_level=? AND approval_status='approved'" + (assignment.section ? ' AND section=?' : ''))
    .get(...(assignment.section ? [assignment.class_level, assignment.section] : [assignment.class_level])).c;

  const submissions = db.prepare('SELECT * FROM submissions WHERE assignment_id = ?').all(req.params.id);
  const submittedCount = submissions.length;
  const lateCount = submissions.filter(s => s.is_late).length;
  const gradedSubs = submissions.filter(s => s.grade != null);
  const grades = gradedSubs.map(s => s.grade);
  const avg = grades.length ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10 : null;
  const high = grades.length ? Math.max(...grades) : null;
  const low = grades.length ? Math.min(...grades) : null;

  const missingStudents = db.prepare(`
    SELECT u.id, u.name FROM users u
    WHERE u.role='student' AND u.class_level = ? AND u.approval_status='approved'
    ${assignment.section ? 'AND u.section = ?' : ''}
    AND u.id NOT IN (SELECT student_id FROM submissions WHERE assignment_id = ?)
  `).all(...(assignment.section ? [assignment.class_level, assignment.section, req.params.id] : [assignment.class_level, req.params.id]));

  const resubmissionCount = submissions.filter(s => s.version_count > 1).length;
  const regradeRequestCount = db.prepare(`
    SELECT COUNT(*) c FROM regrade_requests rr JOIN submissions sub ON rr.submission_id = sub.id WHERE sub.assignment_id = ?
  `).get(req.params.id).c;

  // Simple grade-distribution buckets (0-59, 60-69, 70-79, 80-89, 90-100) scaled to max_score.
  const buckets = [0, 0, 0, 0, 0];
  for (const g of grades) {
    const pct = (g / (assignment.max_score || 100)) * 100;
    if (pct < 60) buckets[0]++;
    else if (pct < 70) buckets[1]++;
    else if (pct < 80) buckets[2]++;
    else if (pct < 90) buckets[3]++;
    else buckets[4]++;
  }

  res.json({
    totalStudents, submittedCount, submissionRatePct: totalStudents ? Math.round((submittedCount / totalStudents) * 100) : 0,
    missingStudents, lateCount, avgScore: avg, highScore: high, lowScore: low,
    gradeDistribution: [
      { label: '0-59%', count: buckets[0] }, { label: '60-69%', count: buckets[1] }, { label: '70-79%', count: buckets[2] },
      { label: '80-89%', count: buckets[3] }, { label: '90-100%', count: buckets[4] },
    ],
    resubmissionCount, regradeRequestCount,
  });
});

router.get('/:id/my-analytics', requireAuth, (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  const mySubmission = db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?').get(req.params.id, req.user.id);
  const allGrades = db.prepare('SELECT grade FROM submissions WHERE assignment_id = ? AND grade IS NOT NULL').all(req.params.id).map(r => r.grade);
  const classAvg = allGrades.length ? Math.round((allGrades.reduce((a, b) => a + b, 0) / allGrades.length) * 10) / 10 : null;

  // Improvement trend: this student's grade history across ALL assignments in this subject, chronologically.
  const trend = db.prepare(`
    SELECT sub.grade, sub.graded_at, a.title FROM submissions sub
    JOIN assignments a ON sub.assignment_id = a.id
    WHERE a.subject_id = ? AND sub.student_id = ? AND sub.grade IS NOT NULL
    ORDER BY sub.graded_at ASC
  `).all(assignment.subject_id, req.user.id);

  res.json({
    myGrade: mySubmission?.grade ?? null, maxScore: assignment.max_score, classAvg,
    myPct: mySubmission?.grade != null ? Math.round((mySubmission.grade / assignment.max_score) * 100) : null,
    trend,
  });
});

export default router;
