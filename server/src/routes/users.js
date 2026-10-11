import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { notifyUser } from '../utils/notify.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

// List students awaiting approval
router.get('/pending', requireAuth, requireAdmin, (req, res) => {
  const pending = db.prepare(
    "SELECT id, name, email, class_level, section, created_at FROM users WHERE role='student' AND approval_status='pending' ORDER BY created_at ASC"
  ).all();
  res.json({ pending });
});

// Keep the permanent applications table in sync no matter which endpoint
// (this legacy one, or the dedicated /api/applications one) an admin uses.
function syncCurrentApplication(userId, { status, reviewerId, reviewerName, reason = null, comments = null }) {
  const current = db.prepare('SELECT * FROM applications WHERE applicant_user_id = ? AND is_current = 1').get(userId);
  if (!current) return;
  db.prepare(`
    UPDATE applications SET status = ?, reviewer_id = ?, reviewer_name = ?, rejection_reason = ?, reviewer_comments = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(status, reviewerId, reviewerName, reason, comments, current.id);
}

router.put('/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role='student'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Student not found' });

  db.prepare("UPDATE users SET approval_status = 'approved' WHERE id = ?").run(req.params.id);
  syncCurrentApplication(user.id, { status: 'approved', reviewerId: req.user.id, reviewerName: req.user.name });

  notifyUser({
    user_id: user.id,
    type: 'general',
    title: 'Your account has been approved! 🎉',
    body: 'Welcome aboard — you now have full access to your class resources.',
    link: '/dashboard',
  });

  logAudit(req, {
    module: 'applications', action: 'approved',
    description: `${req.user.name} approved ${user.name}'s registration`,
    previousValue: { approval_status: user.approval_status },
    newValue: { approval_status: 'approved' },
    metadata: { student_id: user.id },
  });

  res.json({ ok: true });
});

router.put('/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const { reason, comments } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role='student'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Student not found' });

  // Rejected applications are never deleted — only the account is flagged
  // rejected; the applications table keeps the permanent historical record.
  db.prepare("UPDATE users SET approval_status = 'rejected' WHERE id = ?").run(req.params.id);
  syncCurrentApplication(user.id, { status: 'rejected', reviewerId: req.user.id, reviewerName: req.user.name, reason: reason || 'Other', comments });

  logAudit(req, {
    module: 'applications', action: 'rejected',
    description: `${req.user.name} rejected ${user.name}'s registration${reason ? ` — ${reason}` : ''}`,
    previousValue: { approval_status: user.approval_status },
    newValue: { approval_status: 'rejected', reason, comments },
    metadata: { student_id: user.id },
  });

  res.json({ ok: true });
});

// Admin can revert a rejected or approved account back to pending, or re-approve
router.put('/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, approved, or rejected' });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role='student'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Student not found' });

  db.prepare('UPDATE users SET approval_status = ? WHERE id = ?').run(status, req.params.id);

  logAudit(req, {
    module: 'applications', action: status,
    description: `${req.user.name} changed ${user.name}'s status to ${status}`,
    previousValue: { approval_status: user.approval_status },
    newValue: { approval_status: status },
  });

  if (status === 'approved') {
    notifyUser({
      user_id: user.id,
      type: 'general',
      title: 'Your account has been approved! 🎉',
      body: 'Welcome aboard — you now have full access to your class resources.',
      link: '/dashboard',
    });
  }
  res.json({ ok: true });
});

// Archive / restore a student account (Registry "Archived" filter).
// Archiving never deletes the account or its application history.
router.put('/:id/archive', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role='student'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Student not found' });
  db.prepare("UPDATE users SET account_status = 'archived' WHERE id = ?").run(req.params.id);
  logAudit(req, {
    module: 'applications', action: 'archived',
    description: `${req.user.name} archived ${user.name}'s account`,
    previousValue: { account_status: user.account_status || 'active' }, newValue: { account_status: 'archived' },
  });
  res.json({ ok: true });
});

router.put('/:id/unarchive', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role='student'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Student not found' });
  db.prepare("UPDATE users SET account_status = 'active' WHERE id = ?").run(req.params.id);
  logAudit(req, {
    module: 'applications', action: 'unarchived',
    description: `${req.user.name} restored ${user.name}'s account from archive`,
    previousValue: { account_status: 'archived' }, newValue: { account_status: 'active' },
  });
  res.json({ ok: true });
});

// NOTE: Full Teacher Management (create/edit/disable/enable/reset-password/
// Class-Section-Subject assignment) now lives in the dedicated
// `server/src/routes/teachers.js` module, mounted at /api/teachers. The old
// flat /teachers endpoints that used to live here (with no section support,
// no role tiers, no disable, no password reset) have been removed in favor
// of that module so there is a single, complete source of truth.

export default router;
