// Exams, marks, publish, and grading scales.
//   /api/exams/*                   staff. Permission per route (exams.view, exams.enter_marks, exams.manage, exams.publish).
//                                  Class and subject scope is enforced in services/exams/exams.js.
//   /api/guardian/children/:studentId/results   guardian portal. Published marks only, for a linked child with can_view_results.
//   .../marksheet.pdf                 PDF built from the publication snapshots. 409 while any subject is unpublished.
// Business rules live in services/exams/exams.js and services/exams/grading.js.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, hasPermission } from '../services/permissions.js';
import { accessibleLink } from '../services/guardians.js';
import * as exams from '../services/exams/exams.js';
import { ExamError } from '../services/exams/exams.js';
import { renderMarksheetPdf } from '../services/exams/marksheetPdf.js';
import { logAudit } from '../utils/audit.js';
import db from '../db/index.js';

export const examsRouter = Router();
export const examsPortalRouter = Router();

// Passes if the user holds any one of the listed permissions.
function requireAnyPermission(...keys) {
  return (req, res, next) => {
    if (keys.some(k => hasPermission(req.user, k))) return next();
    return res.status(403).json({ error: `Missing permission: one of ${keys.join(', ')}` });
  };
}

const wrap = fn => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ExamError) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
};

// ---------- grading scales ----------
examsRouter.get('/grading-scales', requireAuth, requirePermission('exams.view'), wrap((req, res) => {
  res.json({ scales: exams.listScales() });
}));

examsRouter.post('/grading-scales', requireAuth, requirePermission('exams.manage'), wrap((req, res) => {
  res.status(201).json({ scale: exams.createScale(req, req.body) });
}));

// ---------- terms ----------
examsRouter.get('/terms', requireAuth, requirePermission('exams.view'), wrap((req, res) => {
  res.json({ terms: exams.listTerms() });
}));

examsRouter.post('/terms', requireAuth, requirePermission('exams.manage'), wrap((req, res) => {
  res.status(201).json({ term: exams.createTerm(req, req.body) });
}));

// ---------- exams ----------
examsRouter.get('/', requireAuth, requirePermission('exams.view'), wrap((req, res) => {
  res.json({ exams: exams.listExams(req, req.query) });
}));

examsRouter.post('/', requireAuth, requirePermission('exams.manage'), wrap((req, res) => {
  res.status(201).json({ exam: exams.createExam(req, req.body) });
}));

// Queue of correction requests. Declared before '/:id' so 'unpublish-requests' is not read as an exam id.
examsRouter.get('/unpublish-requests', requireAuth, requirePermission('exams.publish'), wrap((req, res) => {
  res.json({ requests: exams.listUnpublishRequests({ status: req.query.status }) });
}));

examsRouter.get('/:id', requireAuth, requirePermission('exams.view'), wrap((req, res) => {
  res.json(exams.getExam(req, Number(req.params.id)));
}));

// Bulk upsert. Body: { marks: [{ student_id, theory, internal } | { student_id, mark } | { student_id, absent: true }] }
examsRouter.put('/:id/marks', requireAuth, requirePermission('exams.enter_marks'), wrap((req, res) => {
  res.json(exams.enterMarks(req, Number(req.params.id), req.body));
}));

examsRouter.post('/:id/publish', requireAuth, requirePermission('exams.publish'), wrap((req, res) => {
  res.json({ exam: exams.publishExam(req, Number(req.params.id)) });
}));

// ---------- corrections to published results ----------
// Teacher (in scope) or admin asks for a correction. Body: { reason } (3 to 500 characters).
examsRouter.post('/:id/unpublish-requests', requireAuth, requireAnyPermission('exams.enter_marks', 'exams.publish'), wrap((req, res) => {
  res.status(201).json({ request: exams.requestUnpublish(req, Number(req.params.id), req.body) });
}));

// Someone other than the requester approves (unpublishes) or rejects. Body: { decision: 'approve'|'reject', note? }
examsRouter.post('/unpublish-requests/:rid/decision', requireAuth, requirePermission('exams.publish'), wrap((req, res) => {
  res.json({ request: exams.decideUnpublishRequest(req, Number(req.params.rid), req.body) });
}));

// ---------- marksheet PDF ----------
const schoolName = () => db.prepare('SELECT school_name, site_name FROM settings WHERE id = 1').get()?.school_name || 'School';
// Built only from the publication snapshots (marksheetFor), never from live marks.
async function sendMarksheet(req, res, studentId, termId, schoolName) {
  const data = exams.marksheetFor(studentId, termId);
  const pdf = await renderMarksheetPdf(data, { verifiedAt: new Date(), schoolName });
  const versions = data.footer.version_labels;
  logAudit(req, { module: 'exams', action: 'marksheet_issued',
    description: `Issued marksheet for student #${studentId}, term #${termId}, ${versions.join(', ')}`,
    newValue: { student_id: studentId, term_id: termId, versions, summary_status: data.summary.status, gpa: data.summary.gpa } });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="marksheet-${studentId}-${termId}.pdf"`, 'Cache-Control': 'no-store' });
  res.send(pdf);
}

examsRouter.get('/terms/:termId/students/:studentId/marksheet.pdf', requireAuth, requirePermission('exams.manage'), wrap((req, res) => {
  const termId = Number(req.params.termId);
  const studentId = Number(req.params.studentId);
  if (!Number.isInteger(termId) || !Number.isInteger(studentId) || termId <= 0 || studentId <= 0) throw new ExamError(400, 'Invalid id');
  return sendMarksheet(req, res, studentId, termId, schoolName());
}));

// ---------- guardian portal ----------
function requireGuardian(req, res, next) {
  if (req.user?.role !== 'guardian') return res.status(403).json({ error: 'Guardian accounts only' });
  next();
}

// Returns only published results. A child with no link, a restricted link, or no can_view_results gets 404.
examsPortalRouter.get('/children/:studentId/results', requireAuth, requireGuardian, wrap((req, res) => {
  const studentId = Number(req.params.studentId);
  if (!Number.isInteger(studentId) || studentId <= 0 || !accessibleLink(req.user.id, studentId, 'can_view_results')) {
    throw new ExamError(404, 'Results not found');
  }
  const { results, terms } = exams.publishedResultsFor(studentId);
  res.json({ student_id: studentId, results, terms });
}));

// Guardian copy of the same marksheet. Needs a link with can_view_results. Otherwise 404.
examsPortalRouter.get('/children/:studentId/terms/:termId/marksheet.pdf', requireAuth, requireGuardian, wrap((req, res) => {
  const studentId = Number(req.params.studentId);
  const termId = Number(req.params.termId);
  if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(termId) || termId <= 0
      || !accessibleLink(req.user.id, studentId, 'can_view_results')) {
    throw new ExamError(404, 'Results not found');
  }
  return sendMarksheet(req, res, studentId, termId, schoolName());
}));
