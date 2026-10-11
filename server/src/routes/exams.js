// Exams, marks, publish, and grading scales.
//   /api/exams/*                   staff. Permission per route (exams.view, exams.enter_marks, exams.manage, exams.publish).
//                                  Class and subject scope is enforced in services/exams/exams.js.
//   /api/guardian/children/:studentId/results   guardian portal. Published marks only, for a linked child with can_view_results.
// Business rules live in services/exams/exams.js and services/exams/grading.js.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, hasPermission } from '../services/permissions.js';
import { accessibleLink } from '../services/guardians.js';
import * as exams from '../services/exams/exams.js';
import { ExamError } from '../services/exams/exams.js';

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
