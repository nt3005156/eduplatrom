import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin, revokeSessions } from '../middleware/auth.js';
import { notifyUser } from '../utils/notify.js';
import { logAudit } from '../utils/audit.js';
import { normalizePhone, isIsoDate, BLOOD_GROUPS } from '../utils/validate.js';
import { schoolDate } from '../utils/schoolTime.js';

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
  revokeSessions(user.id);
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

// Phase 1: admin edits a student's profile fields (Nepal and international identity fields).
// Validation is the same as the bulk import. Every change is audited with before and after values.
const PROFILE_EDITABLE = ['phone', 'dob_ad', 'dob_bs', 'address', 'admission_no', 'roll_no', 'iemis_id', 'neb_reg_no',
  'blood_group', 'emergency_contact_name', 'emergency_contact_phone', 'gender', 'class_level', 'section'];
router.patch('/:id/profile', requireAuth, requireAdmin, (req, res) => {
  const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(Number(req.params.id));
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const body = req.body || {};
  const changes = {};
  for (const key of PROFILE_EDITABLE) {
    if (body[key] === undefined) continue;
    let v = body[key] === '' ? null : body[key];
    if (key === 'phone' || key === 'emergency_contact_phone') {
      const p = normalizePhone(v);
      if (!p.ok) return res.status(400).json({ error: p.error });
      v = p.value;
    } else if (key === 'dob_ad' && v !== null && !isIsoDate(v)) {
      return res.status(400).json({ error: 'dob_ad must be YYYY-MM-DD' });
    } else if (key === 'dob_ad' && v !== null && v > schoolDate()) {
      return res.status(400).json({ error: 'dob_ad cannot be in the future' });
    } else if (key === 'dob_bs' && v !== null && !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(v)) {
      return res.status(400).json({ error: 'dob_bs must be YYYY-MM-DD in the Bikram Sambat calendar' });
    } else if (key === 'blood_group' && v !== null && !BLOOD_GROUPS.includes(String(v).toUpperCase())) {
      return res.status(400).json({ error: `blood_group must be one of ${BLOOD_GROUPS.join(', ')}` });
    } else if (key === 'blood_group' && v !== null) {
      v = String(v).toUpperCase();
    } else if (key === 'class_level' && v !== null && (!Number.isInteger(Number(v)) || Number(v) < 6 || Number(v) > 12)) {
      return res.status(400).json({ error: 'class_level must be 6 to 12' });
    } else if (key === 'section' && v !== null && !/^[A-Z]{1,3}$/.test(String(v).toUpperCase())) {
      return res.status(400).json({ error: 'section must be 1 to 3 letters' });
    } else if (key === 'section' && v !== null) {
      v = String(v).toUpperCase();
    } else if (key === 'gender' && v !== null && !['male', 'female', 'other'].includes(v)) {
      return res.status(400).json({ error: 'gender must be male, female or other' });
    }
    if (key === 'class_level' && v !== null) v = Number(v);
    if (key === 'roll_no' || key === 'admission_no') {
      const val = v === null ? null : String(v).trim();
      if (val !== null && val.length > 20) return res.status(400).json({ error: `${key} is too long` });
      v = val;
      if (val && key === 'admission_no') {
        const clash = db.prepare("SELECT id FROM users WHERE admission_no = ? AND id != ? AND account_status != 'archived'").get(val, student.id);
        if (clash) return res.status(409).json({ error: 'This admission number belongs to another student' });
      }
    }
    if (String(student[key] ?? null) !== String(v ?? null)) changes[key] = v;
  }
  if (Object.keys(changes).length === 0) return res.json({ student: db.prepare('SELECT * FROM users WHERE id = ?').get(student.id), changed: [] });
  const sets = Object.keys(changes).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(changes), student.id);
  const previous = Object.fromEntries(Object.keys(changes).map(k => [k, student[k] ?? null]));
  logAudit(req, { module: 'users', action: 'updated', description: `Updated profile of ${student.name}: ${Object.keys(changes).join(', ')}`,
    previousValue: previous, newValue: changes });
  res.json({ student: db.prepare('SELECT * FROM users WHERE id = ?').get(student.id), changed: Object.keys(changes) });
});

export default router;
