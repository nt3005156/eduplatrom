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
import { validateBands, validateExamMarks, computeResult, GradingError } from './grading.js';

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
  const scales = db.prepare('SELECT id, name, created_at FROM grading_scales ORDER BY id').all();
  const bands = db.prepare('SELECT scale_id, min_percent, grade, grade_point, is_pass FROM grading_bands ORDER BY min_percent DESC').all();
  return scales.map(s => ({ ...s, bands: bands.filter(b => b.scale_id === s.id).map(({ scale_id, ...b }) => b) }));
}

export function createScale(req, body) {
  const name = text(body?.name, 'name', 2, 100);
  const bands = grading(() => validateBands(body?.bands));
  if (db.prepare('SELECT id FROM grading_scales WHERE name = ?').get(name)) throw new ExamError(409, 'A scale with this name already exists');
  const id = db.transaction(() => {
    const sid = Number(db.prepare('INSERT INTO grading_scales (name, created_by) VALUES (?, ?)').run(name, req.user.id).lastInsertRowid);
    const ins = db.prepare('INSERT INTO grading_bands (scale_id, min_percent, grade, grade_point, is_pass) VALUES (?,?,?,?,?)');
    for (const b of bands) ins.run(sid, b.min_percent, b.grade, b.grade_point, b.is_pass);
    return sid;
  })();
  logAudit(req, { module: 'exams', action: 'scale_created', description: `Created grading scale "${name}"`, newValue: { id, name, bands } });
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

  const id = Number(db.prepare(`INSERT INTO exams (term_id, class_level, section, subject_id, exam_date, full_marks, theory_full, internal_full, grading_scale_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(termId, classLevel, section, subjectId, examDate, cfg.full_marks, cfg.theory_full, cfg.internal_full, scaleId, req.user.id).lastInsertRowid);
  logAudit(req, { module: 'exams', action: 'exam_created', description: `Created exam #${id} (class ${classLevel}${section ? ` ${section}` : ''}, subject #${subjectId})`, newValue: { id, ...cfg, term_id: termId, class_level: classLevel, section, subject_id: subjectId } });
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

const MARK_SELECT = `SELECT student_id, is_absent, theory, internal, total, percent, grade, grade_point, is_pass, updated_at FROM exam_marks WHERE exam_id = ?`;

export function getExam(req, id) {
  const exam = getExamRow(id);
  const scope = resolveScope(req.user);
  if (!exam || !inScope(scope, exam)) throw new ExamError(404, 'Exam not found');
  const marks = new Map(db.prepare(MARK_SELECT).all(id).map(m => [m.student_id, m]));
  // A teacher sees only the students they may mark. Class-wide staff see the whole roster.
  const students = rosterFor(exam)
    .filter(s => isWithinScope(scope, { classLevel: exam.class_level, section: s.section, subjectId: exam.subject_id }))
    .map(s => ({ ...s, mark: marks.get(s.student_id) || null }));
  const bands = db.prepare('SELECT min_percent, grade, grade_point, is_pass FROM grading_bands WHERE scale_id = ? ORDER BY min_percent DESC').all(exam.grading_scale_id);
  return { exam, bands, students, can_edit_marks: exam.status === 'draft' };
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
  const bands = db.prepare('SELECT min_percent, grade, grade_point, is_pass FROM grading_bands WHERE scale_id = ? ORDER BY min_percent DESC').all(exam.grading_scale_id);
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
      return { student: st, result: computeResult(exam, e, bands) };
    } catch (err) {
      if (err instanceof GradingError) throw new ExamError(400, `${st.name}: ${err.message}`);
      throw err;
    }
  });

  const upsert = db.prepare(`INSERT INTO exam_marks (exam_id, student_id, is_absent, theory, internal, total, percent, grade, grade_point, is_pass, entered_by, entered_by_emp_no, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, (SELECT employee_no FROM users WHERE id = ?), datetime('now'))
    ON CONFLICT(exam_id, student_id) DO UPDATE SET is_absent = excluded.is_absent, theory = excluded.theory, internal = excluded.internal,
      total = excluded.total, percent = excluded.percent, grade = excluded.grade, grade_point = excluded.grade_point, is_pass = excluded.is_pass,
      entered_by = excluded.entered_by, entered_by_emp_no = excluded.entered_by_emp_no, updated_at = excluded.updated_at`);
  const summarise = m => m ? { is_absent: m.is_absent, theory: m.theory, internal: m.internal, total: m.total, grade: m.grade } : null;

  let changed = 0;
  db.transaction(() => {
    for (const p of planned) {
      const r = p.result;
      const before = prev.get(p.student.id) || null;
      const after = { is_absent: r.absent, theory: r.theory, internal: r.internal, total: r.total, grade: r.grade };
      const same = before && JSON.stringify(summarise(before)) === JSON.stringify(after);
      if (same) continue;
      upsert.run(id, p.student.id, r.absent, r.theory, r.internal, r.total, r.percent, r.grade, r.grade_point, r.is_pass, req.user.id, req.user.id);
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
  db.prepare(`UPDATE exams SET status = 'published', published_at = datetime('now'), published_by = ? WHERE id = ?`).run(req.user.id, id);
  logAudit(req, { module: 'exams', action: 'published', description: `Published exam #${id} (${exam.subject_name}, class ${exam.class_level}${exam.section ? ` ${exam.section}` : ''})`,
    previousValue: { status: 'draft' }, newValue: { status: 'published', students: roster.length } });
  return getExamRow(id);
}

export function unpublishExam(req, id, body) {
  const exam = getExamRow(id);
  if (!exam) throw new ExamError(404, 'Exam not found');
  if (exam.status !== 'published') throw new ExamError(409, 'Exam is not published');
  const reason = text(body?.reason, 'reason', 3, 500);
  db.prepare(`UPDATE exams SET status = 'draft', published_at = NULL, published_by = NULL WHERE id = ?`).run(id);
  logAudit(req, { module: 'exams', action: 'unpublished', description: `Unpublished exam #${id}: ${reason}`,
    previousValue: { status: 'published', published_at: exam.published_at }, newValue: { status: 'draft', reason } });
  return getExamRow(id);
}

// ---------- guardian view ----------

/** Published results for one child. The caller checks the guardian link first. */
export function publishedResultsFor(studentId) {
  return db.prepare(`SELECT e.id AS exam_id, t.name AS term_name, sub.name AS subject_name, e.exam_date, e.full_marks, e.theory_full, e.internal_full,
      m.is_absent, m.theory, m.internal, m.total, m.percent, m.grade, m.grade_point, m.is_pass, e.published_at
    FROM exam_marks m
    JOIN exams e ON e.id = m.exam_id
    JOIN exam_terms t ON t.id = e.term_id
    JOIN subjects sub ON sub.id = e.subject_id
    WHERE m.student_id = ? AND e.status = 'published'
    ORDER BY t.id, sub.name`).all(studentId).map(r => ({ ...r, is_absent: !!r.is_absent, is_pass: !!r.is_pass }));
}
