// Exams, marks entry, publish, and the guardian view of published results.
// Rules enforced here (routes only check permissions and shape the HTTP response):
//  - Staff see an exam only if isWithinScope() allows its class, section and subject (fail-closed for teachers).
//  - Marks are written only for students in the exam's class and section, and only when the teacher's
//    scope covers that student's section and the exam's subject. A batch is all-or-nothing.
//  - Marks are frozen while the exam is published. Correcting them means unpublish (with a reason), edit, publish again.
//  - Publish needs every student on the roster to have a mark or an absent flag.
//  - Guardians see only published exams, and only through accessibleLink(..., 'can_view_results').
//  - Every write is audited with previous and new values.
import db from '../../db/index.js';
import { logAudit } from '../../utils/audit.js';
import { resolveScope, isWithinScope } from '../scope.js';
import { isIsoDate } from '../../utils/validate.js';
import { notifyUser } from '../../utils/notify.js';
import { hasPermission } from '../permissions.js';
import { validateBands, validateExamMarks, validateComponentMins, computeResult, summarizeResults, GradingError } from './grading.js';

const versionLabel = v => `v1.${String(v).padStart(2, '0')}`;
export { versionLabel };

export class ExamError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_BATCH = 500;
const INACTIVE = "('archived','disabled')";

const int = (v, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ExamError(400, `${label} must be a positive whole number`);
  return n;
};
const text = (v, label, min, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new ExamError(400, `${label} must be ${min} to ${max} characters`);
  return s;
};
const grading = fn => {
  try { return fn(); } catch (err) {
    if (err instanceof GradingError) throw new ExamError(400, err.message);
    throw err;
  }
};

// ---------- scales ----------

export function listScales() {
  const scales = db.prepare('SELECT id, name, theory_min_percent, internal_min_percent, created_at FROM grading_scales ORDER BY id').all();
  const bands = db.prepare('SELECT scale_id, min_percent, grade, grade_point, is_pass FROM grading_bands ORDER BY min_percent DESC').all();
  return scales.map(s => ({ ...s, bands: bands.filter(b => b.scale_id === s.id).map(({ scale_id, ...b }) => b) }));
}

export function createScale(req, body) {
  const name = text(body?.name, 'name', 2, 100);
  const bands = grading(() => validateBands(body?.bands));
  const mins = grading(() => validateComponentMins(body ?? {}));
  if (db.prepare('SELECT id FROM grading_scales WHERE name = ?').get(name)) throw new ExamError(409, 'A scale with this name already exists');
  const id = db.transaction(() => {
    const sid = Number(db.prepare('INSERT INTO grading_scales (name, created_by, theory_min_percent, internal_min_percent) VALUES (?, ?, ?, ?)')
      .run(name, req.user.id, mins.theory_min_percent, mins.internal_min_percent).lastInsertRowid);
    const ins = db.prepare('INSERT INTO grading_bands (scale_id, min_percent, grade, grade_point, is_pass) VALUES (?,?,?,?,?)');
    for (const b of bands) ins.run(sid, b.min_percent, b.grade, b.grade_point, b.is_pass);
    return sid;
  })();
  logAudit(req, { module: 'exams', action: 'scale_created', description: `Created grading scale "${name}"`, newValue: { id, name, ...mins, bands } });
  return listScales().find(s => s.id === id);
}

// ---------- terms ----------

export function listTerms() {
  return db.prepare(`SELECT t.id, t.name, t.session_id, s.name AS session_name
    FROM exam_terms t JOIN academic_sessions s ON s.id = t.session_id ORDER BY s.start_date DESC, t.id`).all();
}

export function createTerm(req, body) {
  const sessionId = int(body?.session_id, 'session_id');
  const name = text(body?.name, 'name', 2, 60);
  if (!db.prepare('SELECT id FROM academic_sessions WHERE id = ?').get(sessionId)) throw new ExamError(404, 'Academic session not found');
  if (db.prepare('SELECT id FROM exam_terms WHERE session_id = ? AND name = ?').get(sessionId, name)) {
    throw new ExamError(409, 'This term already exists in the session');
  }
  const id = Number(db.prepare('INSERT INTO exam_terms (session_id, name, created_by) VALUES (?,?,?)').run(sessionId, name, req.user.id).lastInsertRowid);
  logAudit(req, { module: 'exams', action: 'term_created', description: `Created exam term "${name}"`, newValue: { id, session_id: sessionId, name } });
  return listTerms().find(t => t.id === id);
}

// ---------- exams ----------

const EXAM_SELECT = `SELECT e.*, t.name AS term_name, t.session_id, sub.name AS subject_name, sc.name AS scale_name,
  (SELECT COUNT(*) FROM exam_marks m WHERE m.exam_id = e.id) AS marks_count
  FROM exams e
  JOIN exam_terms t ON t.id = e.term_id
  JOIN subjects sub ON sub.id = e.subject_id
  JOIN grading_scales sc ON sc.id = e.grading_scale_id`;

const getExamRow = id => db.prepare(`${EXAM_SELECT} WHERE e.id = ?`).get(id);

function inScope(scope, exam) {
  return isWithinScope(scope, { classLevel: exam.class_level, section: exam.section, subjectId: exam.subject_id });
}

export function createExam(req, body) {
  const termId = int(body?.term_id, 'term_id');
  const classLevel = int(body?.class_level, 'class_level');
  if (classLevel > 12) throw new ExamError(400, 'class_level must be 1 to 12');
  const subjectId = int(body?.subject_id, 'subject_id');
  const section = body?.section === undefined || body?.section === null || body?.section === '' ? null : text(body.section, 'section', 1, 10);
  const examDate = body?.exam_date ?? null;
  if (examDate !== null && !isIsoDate(examDate)) throw new ExamError(400, 'exam_date must be YYYY-MM-DD');
  const scaleId = int(body?.grading_scale_id, 'grading_scale_id');
  const creditHours = body?.credit_hours === undefined || body?.credit_hours === null ? NaN : Number(body.credit_hours);
  if (!Number.isFinite(creditHours) || creditHours <= 0 || creditHours > 10 || Math.abs(creditHours * 100 - Math.round(creditHours * 100)) > 1e-6) {
    throw new ExamError(400, 'credit_hours is required: a number above 0 and up to 10, with at most 2 decimals');
  }
  const cfg = grading(() => validateExamMarks({
    full_marks: Number(body?.full_marks),
    theory_full: body?.theory_full ?? null,
    internal_full: body?.internal_full ?? null,
  }));

  if (!db.prepare('SELECT id FROM exam_terms WHERE id = ?').get(termId)) throw new ExamError(404, 'Exam term not found');
  const subject = db.prepare('SELECT id, class_level FROM subjects WHERE id = ?').get(subjectId);
  if (!subject || subject.class_level !== classLevel) throw new ExamError(400, 'That subject is not taught in this class');
  if (section && !db.prepare('SELECT id FROM sections WHERE class_level = ? AND name = ?').get(classLevel, section)) {
    throw new ExamError(400, 'That section does not exist for this class');
  }
  if (!db.prepare('SELECT id FROM grading_scales WHERE id = ?').get(scaleId)) throw new ExamError(400, 'grading_scale_id not found');
  const dup = db.prepare(`SELECT id FROM exams WHERE term_id = ? AND class_level = ? AND subject_id = ?
    AND ((section IS NULL AND ? IS NULL) OR section = ?)`).get(termId, classLevel, subjectId, section, section);
  if (dup) throw new ExamError(409, 'An exam for this subject, class and section already exists in this term');

  const id = Number(db.prepare(`INSERT INTO exams (term_id, class_level, section, subject_id, exam_date, full_marks, theory_full, internal_full, grading_scale_id, credit_hours, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(termId, classLevel, section, subjectId, examDate, cfg.full_marks, cfg.theory_full, cfg.internal_full, scaleId, creditHours, req.user.id).lastInsertRowid);
  logAudit(req, { module: 'exams', action: 'exam_created', description: `Created exam #${id} (class ${classLevel}${section ? ` ${section}` : ''}, subject #${subjectId})`, newValue: { id, ...cfg, credit_hours: creditHours, term_id: termId, class_level: classLevel, section, subject_id: subjectId } });
  return getExamRow(id);
}

export function listExams(req, filters = {}) {
  const scope = resolveScope(req.user);
  const where = []; const params = [];
  if (filters.term_id) { where.push('e.term_id = ?'); params.push(int(filters.term_id, 'term_id')); }
  if (filters.class_level) { where.push('e.class_level = ?'); params.push(int(filters.class_level, 'class_level')); }
  if (filters.status === 'draft' || filters.status === 'published') { where.push('e.status = ?'); params.push(filters.status); }
  const rows = db.prepare(`${EXAM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.class_level, e.section, sub.name`).all(...params);
  return rows.filter(e => inScope(scope, e));
}

/** Roster of students an exam applies to. Inactive accounts are excluded. */
function rosterFor(exam) {
  return db.prepare(`SELECT id AS student_id, name, roll_no, section FROM users
    WHERE role = 'student' AND class_level = ? AND (? IS NULL OR section = ?) AND account_status NOT IN ${INACTIVE}
    ORDER BY section, roll_no, name`).all(exam.class_level, exam.section, exam.section);
}

const MARK_SELECT = `SELECT student_id, is_absent, theory, internal, total, percent, grade, grade_point, is_pass, ng_reason, updated_at FROM exam_marks WHERE exam_id = ?`;

const scaleMins = scaleId => db.prepare('SELECT theory_min_percent, internal_min_percent FROM grading_scales WHERE id = ?').get(scaleId);
const scaleBands = scaleId => db.prepare('SELECT min_percent, grade, grade_point, is_pass FROM grading_bands WHERE scale_id = ? ORDER BY min_percent DESC').all(scaleId);

export function getExam(req, id) {
  const exam = getExamRow(id);
  const scope = resolveScope(req.user);
  if (!exam || !inScope(scope, exam)) throw new ExamError(404, 'Exam not found');
  const marks = new Map(db.prepare(MARK_SELECT).all(id).map(m => [m.student_id, m]));
  // A teacher sees only the students they may mark. Class-wide staff see the whole roster.
  const students = rosterFor(exam)
    .filter(s => isWithinScope(scope, { classLevel: exam.class_level, section: s.section, subjectId: exam.subject_id }))
    .map(s => ({ ...s, mark: marks.get(s.student_id) || null }));
  const mins = scaleMins(exam.grading_scale_id);
  return {
    exam, bands: scaleBands(exam.grading_scale_id),
    component_mins: { theory_min_percent: mins.theory_min_percent, internal_min_percent: mins.internal_min_percent },
    students, can_edit_marks: exam.status === 'draft',
  };
}

// ---------- marks ----------

export function enterMarks(req, id, body) {
  const exam = getExamRow(id);
  if (!exam) throw new ExamError(404, 'Exam not found');
  const scope = resolveScope(req.user);
  if (!inScope(scope, exam)) throw new ExamError(403, 'You can only enter marks for your own class, section and subject');
  if (exam.status === 'published') throw new ExamError(409, 'Marks are published and locked. Unpublish the exam with a reason to correct them.');

  const entries = body?.marks;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_BATCH) {
    throw new ExamError(400, `marks must be a list of 1 to ${MAX_BATCH} entries`);
  }
  const ids = entries.map(e => int(e?.student_id, 'student_id'));
  if (new Set(ids).size !== ids.length) throw new ExamError(400, 'Each student may appear only once in a batch');

  const students = new Map(db.prepare(`SELECT id, name, role, class_level, section, account_status FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids).map(s => [s.id, s]));
  const bands = scaleBands(exam.grading_scale_id);
  const mins = scaleMins(exam.grading_scale_id);
  const prev = new Map(db.prepare(`SELECT * FROM exam_marks WHERE exam_id = ? AND student_id IN (${ids.map(() => '?').join(',')})`).all(id, ...ids).map(m => [m.student_id, m]));

  // Validate the whole batch before writing anything.
  const planned = entries.map((e, i) => {
    const st = students.get(ids[i]);
    if (!st || st.role !== 'student' || st.class_level !== exam.class_level || (exam.section && st.section !== exam.section) || ['archived', 'disabled'].includes(st.account_status)) {
      throw new ExamError(400, `Student #${ids[i]} is not on this exam's roster`);
    }
    if (!isWithinScope(scope, { classLevel: exam.class_level, section: st.section, subjectId: exam.subject_id })) {
      throw new ExamError(403, `You are not assigned to ${st.name}'s section for this subject`);
    }
    try {
      return { student: st, result: computeResult(exam, e, bands, mins) };
    } catch (err) {
      if (err instanceof GradingError) throw new ExamError(400, `${st.name}: ${err.message}`);
      throw err;
    }
  });

  const upsert = db.prepare(`INSERT INTO exam_marks (exam_id, student_id, is_absent, theory, internal, total, percent, grade, grade_point, is_pass, ng_reason, entered_by, entered_by_emp_no, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, (SELECT employee_no FROM users WHERE id = ?), datetime('now'))
    ON CONFLICT(exam_id, student_id) DO UPDATE SET is_absent = excluded.is_absent, theory = excluded.theory, internal = excluded.internal,
      total = excluded.total, percent = excluded.percent, grade = excluded.grade, grade_point = excluded.grade_point, is_pass = excluded.is_pass,
      ng_reason = excluded.ng_reason, entered_by = excluded.entered_by, entered_by_emp_no = excluded.entered_by_emp_no, updated_at = excluded.updated_at`);
  const summarise = m => m ? { is_absent: m.is_absent, theory: m.theory, internal: m.internal, total: m.total, grade: m.grade, ng_reason: m.ng_reason ?? null } : null;

  let changed = 0;
  db.transaction(() => {
    for (const p of planned) {
      const r = p.result;
      const before = prev.get(p.student.id) || null;
      const after = { is_absent: r.absent, theory: r.theory, internal: r.internal, total: r.total, grade: r.grade, ng_reason: r.ng_reason };
      const same = before && JSON.stringify(summarise(before)) === JSON.stringify(after);
      if (same) continue;
      upsert.run(id, p.student.id, r.absent, r.theory, r.internal, r.total, r.percent, r.grade, r.grade_point, r.is_pass, r.ng_reason, req.user.id, req.user.id);
      changed++;
      logAudit(req, {
        module: 'exams', action: 'marks_saved',
        description: `Marks for ${p.student.name}, exam #${id}: ${r.absent ? 'absent' : `${r.total} (${r.grade})`}`,
        previousValue: before ? summarise(before) : null, newValue: after,
      });
    }
  })();
  return { exam_id: id, received: entries.length, changed };
}

// ---------- publish ----------

/** Staff who must hear about a re-publish after a correction: academic head, exam coordinators, and the class teacher. */
function correctionRecipients(exam) {
  const heads = db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.key IN ('academic_head', 'exam_coordinator') AND u.account_status = 'active'`).all().map(r => r.id);
  const classTeachers = db.prepare(`SELECT DISTINCT teacher_id AS id FROM teacher_assignments
    WHERE is_class_teacher = 1 AND class_level = ? AND (? IS NULL OR section IS NULL OR section = ?)`)
    .all(exam.class_level, exam.section, exam.section).map(r => r.id);
  return [...new Set([...heads, ...classTeachers])];
}

export function publishExam(req, id) {
  const exam = getExamRow(id);
  if (!exam) throw new ExamError(404, 'Exam not found');
  if (exam.status === 'published') throw new ExamError(409, 'Exam is already published');
  const roster = rosterFor(exam);
  if (roster.length === 0) throw new ExamError(409, 'No students are on this exam\'s roster yet');
  const marked = new Set(db.prepare('SELECT student_id FROM exam_marks WHERE exam_id = ?').all(id).map(r => r.student_id));
  const missing = roster.filter(s => !marked.has(s.student_id));
  if (missing.length) {
    const names = missing.slice(0, 5).map(s => s.name).join(', ');
    throw new ExamError(409, `${missing.length} student(s) have no mark or absent flag yet: ${names}${missing.length > 5 ? ', and others' : ''}`);
  }
  const version = exam.publish_version + 1;
  const mins = scaleMins(exam.grading_scale_id);
  // Publish, snapshot the publication, and snapshot every mark, all in one transaction.
  db.transaction(() => {
    db.prepare(`UPDATE exams SET status = 'published', published_at = datetime('now'), published_by = ?, publish_version = ? WHERE id = ?`)
      .run(req.user.id, version, id);
    db.prepare(`INSERT INTO exam_publications (exam_id, publish_version, subject_name, term_name, class_level, section, exam_date, credit_hours,
        full_marks, theory_full, internal_full, grading_scale_name, theory_min_percent, internal_min_percent, student_count, published_by, published_by_emp_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, (SELECT employee_no FROM users WHERE id = ?))`)
      .run(id, version, exam.subject_name, exam.term_name, exam.class_level, exam.section, exam.exam_date, exam.credit_hours,
        exam.full_marks, exam.theory_full, exam.internal_full, exam.scale_name, mins.theory_min_percent, mins.internal_min_percent,
        roster.length, req.user.id, req.user.id);
    db.prepare(`INSERT INTO exam_mark_versions (exam_id, publish_version, student_id, is_absent, theory, internal, total, percent, grade, grade_point, is_pass, ng_reason)
      SELECT exam_id, ?, student_id, is_absent, theory, internal, total, percent, grade, grade_point, is_pass, ng_reason FROM exam_marks WHERE exam_id = ?`)
      .run(version, id);
  })();
  const where = `${exam.subject_name}, class ${exam.class_level}${exam.section ? ` ${exam.section}` : ''}, ${exam.term_name}`;
  logAudit(req, { module: 'exams', action: 'published', description: `Published exam #${id} (${where}), version ${version}`,
    previousValue: { status: 'draft', publish_version: exam.publish_version }, newValue: { status: 'published', students: roster.length, publish_version: version } });

  // A re-publish after a correction is a change the school must see. Notify the people who oversee the class.
  if (exam.publish_version > 0) {
    for (const userId of correctionRecipients(exam)) {
      notifyUser({ user_id: userId, type: 'grade', title: `Results re-published: ${exam.subject_name}`,
        body: `${where}. Version ${version}, after a correction. Guardians with access see the updated marks.`, related_id: id });
    }
    logAudit(req, { module: 'exams', action: 'republished', description: `Re-published exam #${id} after a correction (version ${version})`,
      newValue: { exam_id: id, publish_version: version } });
  }
  return getExamRow(id);
}

// ---------- unpublish: request, then a second person approves ----------
// The teacher (or admin) who needs a correction submits a request with a reason. Someone else with
// exams.publish approves it, and approval is what unpublishes the exam. Nobody approves their own request.

const REQUEST_SELECT = `SELECT r.id, r.exam_id, r.reason, r.status, r.requested_by, r.requested_at, r.decided_by, r.decided_at, r.decision_note,
  u.name AS requested_by_name, d.name AS decided_by_name, e.class_level, e.section, sub.name AS subject_name, t.name AS term_name
  FROM exam_unpublish_requests r
  JOIN exams e ON e.id = r.exam_id
  JOIN subjects sub ON sub.id = e.subject_id
  JOIN exam_terms t ON t.id = e.term_id
  JOIN users u ON u.id = r.requested_by
  LEFT JOIN users d ON d.id = r.decided_by`;

export function requestUnpublish(req, id, body) {
  const exam = getExamRow(id);
  if (!exam) throw new ExamError(404, 'Exam not found');
  const scope = resolveScope(req.user);
  if (!hasPermission(req.user, 'exams.publish') && !inScope(scope, exam)) {
    throw new ExamError(403, 'You can only request a correction for your own exams');
  }
  if (exam.status !== 'published') throw new ExamError(409, 'Exam is not published');
  const reason = text(body?.reason, 'reason', 3, 500);
  if (db.prepare("SELECT id FROM exam_unpublish_requests WHERE exam_id = ? AND status = 'pending'").get(id)) {
    throw new ExamError(409, 'A correction request for this exam is already waiting for approval');
  }
  const rid = Number(db.prepare(`INSERT INTO exam_unpublish_requests (exam_id, reason, requested_by, requested_by_emp_no)
    VALUES (?, ?, ?, (SELECT employee_no FROM users WHERE id = ?))`).run(id, reason, req.user.id, req.user.id).lastInsertRowid);
  logAudit(req, { module: 'exams', action: 'unpublish_requested', description: `Requested a correction on exam #${id}: ${reason}`,
    newValue: { request_id: rid, exam_id: id, reason } });
  return db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(rid);
}

export function listUnpublishRequests({ status = 'pending' } = {}) {
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw new ExamError(400, 'status must be pending, approved, rejected, or all');
  const rows = status === 'all'
    ? db.prepare(`${REQUEST_SELECT} ORDER BY r.id DESC`).all()
    : db.prepare(`${REQUEST_SELECT} WHERE r.status = ? ORDER BY r.id DESC`).all(status);
  return rows;
}

export function decideUnpublishRequest(req, rid, body) {
  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'reject') throw new ExamError(400, 'decision must be approve or reject');
  const note = body?.note === undefined || body?.note === null || body?.note === '' ? null : text(body.note, 'note', 1, 500);
  const r = db.prepare('SELECT * FROM exam_unpublish_requests WHERE id = ?').get(rid);
  if (!r) throw new ExamError(404, 'Request not found');
  if (r.status !== 'pending') throw new ExamError(409, `This request is already ${r.status}`);
  if (r.requested_by === req.user.id) throw new ExamError(403, 'Another person must decide this request');

  const exam = getExamRow(r.exam_id);
  const where = `${exam.subject_name}, class ${exam.class_level}${exam.section ? ` ${exam.section}` : ''}, ${exam.term_name}`;
  if (decision === 'approve') {
    if (exam.status !== 'published') throw new ExamError(409, 'The exam is no longer published');
    db.transaction(() => {
      db.prepare(`UPDATE exam_unpublish_requests SET status = 'approved', decided_by = ?, decided_by_emp_no = (SELECT employee_no FROM users WHERE id = ?), decided_at = datetime('now'), decision_note = ? WHERE id = ?`)
        .run(req.user.id, req.user.id, note, rid);
      db.prepare(`UPDATE exams SET status = 'draft', published_at = NULL, published_by = NULL WHERE id = ?`).run(r.exam_id);
    })();
    logAudit(req, { module: 'exams', action: 'unpublished',
      description: `Unpublished exam #${r.exam_id} (${where}) on approval: ${r.reason}`,
      previousValue: { status: 'published', publish_version: exam.publish_version },
      newValue: { status: 'draft', request_id: rid, requested_by: r.requested_by, approved_by: req.user.id, reason: r.reason, note } });
  } else {
    db.prepare(`UPDATE exam_unpublish_requests SET status = 'rejected', decided_by = ?, decided_by_emp_no = (SELECT employee_no FROM users WHERE id = ?), decided_at = datetime('now'), decision_note = ? WHERE id = ?`)
      .run(req.user.id, req.user.id, note, rid);
    logAudit(req, { module: 'exams', action: 'unpublish_rejected', description: `Rejected correction request #${rid} on exam #${r.exam_id}${note ? `: ${note}` : ''}`,
      newValue: { request_id: rid, decision_note: note } });
  }
  return db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(rid);
}

// ---------- guardian view ----------

// Rows from the snapshot at each exam's current publish_version. Only published exams.
function snapshotRows(studentId, termId = null) {
  const params = termId ? [studentId, termId] : [studentId];
  return db.prepare(`SELECT e.id AS exam_id, e.publish_version, e.term_id, p.term_name, p.subject_name, p.exam_date,
      p.credit_hours, p.full_marks, p.theory_full, p.internal_full, p.published_at, p.published_by, p.published_by_emp_no,
      v.is_absent, v.theory, v.internal, v.total, v.percent, v.grade, v.grade_point, v.is_pass, v.ng_reason
    FROM exams e
    JOIN exam_publications p ON p.exam_id = e.id AND p.publish_version = e.publish_version
    JOIN exam_mark_versions v ON v.exam_id = e.id AND v.publish_version = e.publish_version AND v.student_id = ?
    JOIN exam_terms t ON t.id = e.term_id
    JOIN subjects sub ON sub.id = e.subject_id
    WHERE e.status = 'published' ${termId ? 'AND e.term_id = ?' : ''}
    ORDER BY t.id, p.subject_name`).all(...params).map(r => ({ ...r, is_absent: !!r.is_absent, is_pass: !!r.is_pass }));
}

/**
 * Published results for one child, with a term summary (GPA withheld when incomplete).
 * The caller checks the guardian link first.
 */
export function publishedResultsFor(studentId) {
  const results = snapshotRows(studentId);
  const byTerm = new Map();
  for (const r of results) {
    if (!byTerm.has(r.term_id)) byTerm.set(r.term_id, { term_id: r.term_id, term_name: r.term_name, rows: [] });
    byTerm.get(r.term_id).rows.push(r);
  }
  return {
    results,
    terms: [...byTerm.values()].map(t => ({ term_id: t.term_id, term_name: t.term_name, summary: summarizeResults(t.rows) })),
  };
}

const signOffId = r => r.published_by_emp_no || `USR-${r.published_by}`;

/**
 * Everything a marksheet prints, read from the publication snapshots only.
 * Refuses (409) while any subject for this student is still unpublished, so a partial marksheet
 * is never issued. Also refuses if a published subject has no snapshot mark for the student.
 */
export function marksheetFor(studentId, termId) {
  const student = db.prepare("SELECT id, name, roll_no, class_level, section FROM users WHERE id = ? AND role = 'student'").get(studentId);
  if (!student) throw new ExamError(404, 'Student not found');
  const term = db.prepare(`SELECT t.id, t.name, s.name AS session_name FROM exam_terms t
    JOIN academic_sessions s ON s.id = t.session_id WHERE t.id = ?`).get(termId);
  if (!term) throw new ExamError(404, 'Exam term not found');

  const exams = db.prepare(`SELECT id, status, publish_version FROM exams
    WHERE term_id = ? AND class_level = ? AND (section IS NULL OR section = ?)`).all(termId, student.class_level, student.section);
  if (exams.length === 0) throw new ExamError(404, 'No exams for this student in this term');
  const pending = exams.filter(e => e.status !== 'published').length;
  if (pending) throw new ExamError(409, `Not every subject is published yet (${pending} pending). A marksheet is issued only when all are published.`);

  const rows = snapshotRows(studentId, termId);
  if (rows.length !== exams.length) throw new ExamError(409, 'A published subject has no mark for this student. Check the roster.');

  return {
    student, term,
    rows: rows.map(r => ({ ...r, version_label: versionLabel(r.publish_version) })),
    summary: summarizeResults(rows),
    footer: {
      version_labels: [...new Set(rows.map(r => versionLabel(r.publish_version)))],
      sign_off_ids: [...new Set(rows.map(signOffId))],
      published_at: [...new Set(rows.map(r => r.published_at))],
    },
  };
}
