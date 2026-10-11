// Fees, invoices, receipts, and online payment.
//   /api/fees/*            staff (permission checks per route), plus student self-view of an invoice
//   /api/fees/khalti/return   public. Khalti's browser redirect. Trusts only the lookup, never the query string.
//   /api/guardian/fees/*   guardian portal. Requires can_view_fees or can_pay_fees on the child.
// Every money action is audited in services/fees/ledger.js or online.js.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, hasPermission } from '../services/permissions.js';
import { accessibleLink, visibleChildren } from '../services/guardians.js';
import * as ledger from '../services/fees/ledger.js';
import { FeeError } from '../services/fees/ledger.js';
import { GatewayError } from '../services/fees/khalti.js';
import { startOnlinePayment, verifyKhaltiReturn } from '../services/fees/online.js';
import { runDailyFeeJob } from '../services/fees/dailyJob.js';
import db from '../db/index.js';
import { logAudit } from '../utils/audit.js';

export const feesRouter = Router();
export const feesPortalRouter = Router();

// Turns service errors into HTTP responses. Anything else goes to the app's error handler.
const wrap = fn => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof FeeError) return res.status(err.status).json({ error: err.message });
    if (err instanceof GatewayError) {
      if (err.code === 'not_configured') return res.status(503).json({ error: 'Online payment is not set up for this school yet', code: 'not_configured' });
      return res.status(503).json({ error: 'The payment provider did not respond. Try again shortly.', code: err.code });
    }
    return next(err);
  }
};

const idParam = req => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new FeeError(400, 'Invalid id');
  return n;
};

function requireGuardian(req, res, next) {
  if (req.user?.role !== 'guardian') return res.status(403).json({ error: 'Guardian accounts only' });
  next();
}

// ---------- staff ----------

feesRouter.get('/heads', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json({ heads: ledger.listFeeHeads() });
}));

feesRouter.post('/heads', requireAuth, requirePermission('fees.manage'), wrap((req, res) => {
  res.status(201).json(ledger.createFeeHead(req.body || {}, req));
}));

feesRouter.get('/structures', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json({ lines: ledger.listStructures(req.query) });
}));

feesRouter.put('/structures', requireAuth, requirePermission('fees.manage'), wrap((req, res) => {
  res.json({ lines: ledger.saveFeeStructure(req.body || {}, req) });
}));

feesRouter.post('/invoices/generate', requireAuth, requirePermission('fees.manage'), wrap((req, res) => {
  res.status(201).json(ledger.generateInvoices(req.body || {}, req));
}));

feesRouter.get('/invoices', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json({ invoices: ledger.listInvoices(req.query) });
}));

// Staff with fees.view, or the student the invoice belongs to.
feesRouter.get('/invoices/:id', requireAuth, wrap((req, res) => {
  const inv = ledger.invoiceDetail(idParam(req));
  if (!inv) throw new FeeError(404, 'Invoice not found');
  const isSelf = req.user.role === 'student' && inv.student_id === req.user.id;
  if (!isSelf && !hasPermission(req.user, 'fees.view')) throw new FeeError(403, 'Missing permission: fees.view');
  res.json(inv);
}));

feesRouter.post('/payments', requireAuth, requirePermission('fees.collect'), wrap((req, res) => {
  res.status(201).json(ledger.recordOfflinePayment(req.body || {}, req));
}));

feesRouter.post('/payments/:id/refund', requireAuth, requirePermission('fees.refund'), wrap((req, res) => {
  res.status(201).json(ledger.refundPayment(idParam(req), req.body || {}, req));
}));

feesRouter.get('/concessions', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json({ concessions: ledger.listConcessions(req.query) });
}));

feesRouter.post('/concessions', requireAuth, requirePermission('fees.manage'), wrap((req, res) => {
  const id = ledger.requestConcession(req.body || {}, req);
  res.status(201).json({ id, status: 'requested' });
}));

feesRouter.post('/concessions/:id/decision', requireAuth, requirePermission('fees.approve_concession'), wrap((req, res) => {
  res.json(ledger.decideConcession(idParam(req), req.body?.decision, req));
}));

feesRouter.get('/reports/dues', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  const asOf = req.query.as_of || ledger.todayNepal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new FeeError(400, 'as_of must be YYYY-MM-DD');
  res.json(ledger.duesReport(req.query, asOf));
}));

feesRouter.get('/reports/collection', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json(ledger.collectionReport(req.query));
}));

feesRouter.post('/reconcile', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json(ledger.reconcile(req.body || {}));
}));

// Khalti's browser return. Public on purpose: the browser may arrive without a session cookie.
// It writes only what the server-side lookup confirms, so a forged or repeated return does no harm.
feesRouter.get('/khalti/return', wrap(async (req, res) => {
  const result = await verifyKhaltiReturn(req.query.pidx);
  res.set('Cache-Control', 'no-store').json({ outcome: result.outcome, payment_id: result.payment_id, receipt_no: result.receipt_no, credit_added_paisa: result.credit_added_paisa });
}));

// Cash and bank payments waiting for a second person (fees.verify_payment). The recorder cannot verify their own.
feesRouter.get('/verifications', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json({ verifications: ledger.listVerifications(req.query) });
}));

feesRouter.post('/verifications/:id/decision', requireAuth, requirePermission('fees.verify_payment'), wrap((req, res) => {
  res.json(ledger.decideVerification(idParam(req), req.body || {}, req));
}));

// Credit (overpayments held on the account).
feesRouter.get('/students/:id/credit', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  res.json(ledger.creditStatement(idParam(req)));
}));

feesRouter.post('/students/:id/credit/refund', requireAuth, requirePermission('fees.refund'), wrap((req, res) => {
  res.status(201).json(ledger.refundCredit(idParam(req), req.body || {}, req));
}));

feesRouter.post('/invoices/:id/apply-credit', requireAuth, requirePermission('fees.collect'), wrap((req, res) => {
  res.json(ledger.applyCreditToInvoice(idParam(req), req));
}));

// Reconciliation exceptions. They stay open until someone resolves them with a note.
feesRouter.get('/reconciliation/exceptions', requireAuth, requirePermission('fees.view'), wrap((req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  res.json({ exceptions: db.prepare('SELECT * FROM reconciliation_exceptions WHERE status = ? ORDER BY id').all(status) });
}));

feesRouter.post('/reconciliation/exceptions/:id/resolve', requireAuth, requirePermission('fees.manage'), wrap((req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 3 || note.length > 500) throw new FeeError(400, 'A resolution note of 3 to 500 characters is required');
  const row = db.prepare('SELECT * FROM reconciliation_exceptions WHERE id = ?').get(idParam(req));
  if (!row) throw new FeeError(404, 'Exception not found');
  if (row.status !== 'open') throw new FeeError(409, 'Exception is already resolved');
  db.prepare("UPDATE reconciliation_exceptions SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE id = ?")
    .run(req.user.id, note, row.id);
  logAudit(req, { module: 'fees', action: 'reconciliation_resolved', description: `Exception ${row.id} resolved`, newValue: { type: row.type, note } });
  res.json({ id: row.id, status: 'resolved' });
}));

// Runs the daily job now. The job still runs only once per school date.
feesRouter.post('/jobs/daily/run', requireAuth, requirePermission('fees.manage'), wrap(async (req, res) => {
  res.json(await runDailyFeeJob({ force: true }));
}));

// ---------- guardian portal ----------

feesPortalRouter.get('/fees/invoices', requireAuth, requireGuardian, wrap((req, res) => {
  const children = visibleChildren(req.user.id).filter(c => accessibleLink(req.user.id, c.student_id, 'can_view_fees'));
  const invoices = children.flatMap(c => ledger.listInvoices({ student_id: c.student_id, session_id: req.query.session_id }));
  res.json({ invoices });
}));

feesPortalRouter.get('/fees/invoices/:id', requireAuth, requireGuardian, wrap((req, res) => {
  const inv = ledger.invoiceDetail(idParam(req));
  if (!inv || !accessibleLink(req.user.id, inv.student_id, 'can_view_fees')) throw new FeeError(404, 'Invoice not found');
  res.json(inv);
}));

feesPortalRouter.post('/fees/invoices/:id/pay-online', requireAuth, requireGuardian, wrap(async (req, res) => {
  const id = idParam(req);
  const inv = db.prepare('SELECT student_id FROM invoices WHERE id = ?').get(id);
  if (!inv || !accessibleLink(req.user.id, inv.student_id, 'can_pay_fees')) throw new FeeError(404, 'Invoice not found');
  const started = await startOnlinePayment({ invoice_id: id, amount_paisa: req.body?.amount_paisa }, req.user, req);
  res.status(201).json(started);
}));
