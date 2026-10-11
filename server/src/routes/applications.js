import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { notifyAdmins, notifyUser } from '../utils/notify.js';
import { logAudit } from '../utils/audit.js';
import { randomUUID } from 'crypto';
import { UPLOADS_DIR } from '../config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = UPLOADS_DIR;
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'app-doc-' + randomUUID() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

const REJECTION_REASONS = [
  'Incomplete Information', 'Invalid Documents', 'Duplicate Application',
  'Ineligible Class/Age', 'Missing Required Uploads', 'Other',
];

function safeParse(json, fallback = {}) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function loadFullHistory(applicantUserId) {
  return db.prepare(
    'SELECT * FROM applications WHERE applicant_user_id = ? ORDER BY version ASC'
  ).all(applicantUserId).map(a => ({ ...a, data: safeParse(a.data) }));
}

const router = Router();

router.get('/reasons', requireAuth, requireAdmin, (req, res) => {
  res.json({ reasons: REJECTION_REASONS });
});

// --- REGISTRY: only active/current applications by default ---
// Query params: status=pending|approved|rejected|archived (optional; default = all EXCEPT rejected/archived are still shown unless explicitly filtered out)
// The key rule: rejected historical (superseded) versions NEVER show in the main registry list;
// only each applicant's CURRENT version appears, and only when explicitly filtering for "Rejected"
// does a currently-rejected application appear.
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const { status, search, class_level } = req.query;

  let sql = `
    SELECT a.*, u.name as applicant_name, u.email as applicant_email, u.class_level as applicant_class,
           u.section as applicant_section, u.account_status as applicant_account_status
    FROM applications a
    JOIN users u ON a.applicant_user_id = u.id
    WHERE a.is_current = 1
  `;
  const params = [];

  if (status === 'pending') { sql += " AND a.status = 'submitted'"; }
  else if (status === 'approved') { sql += " AND a.status = 'approved'"; }
  else if (status === 'rejected') { sql += " AND a.status = 'rejected'"; }
  else if (status === 'archived') { sql += " AND u.account_status = 'archived'"; }
  else {
    // Default "Active/Valid" registry view: everything except rejected & archived,
    // per "Registry should show only active/valid records by default; rejected
    // applications must NOT appear in main Registry list."
    sql += " AND a.status != 'rejected' AND u.account_status != 'archived'";
  }

  if (class_level) { sql += ' AND u.class_level = ?'; params.push(class_level); }
  if (search) {
    sql += ' AND (u.name LIKE ? OR u.email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY a.created_at DESC';
  const rows = db.prepare(sql).all(...params).map(r => ({ ...r, data: safeParse(r.data) }));
  res.json({ applications: rows });
});

// Full permanent version history for one applicant (never deleted)
router.get('/history/:applicantUserId', requireAuth, requireAdmin, (req, res) => {
  const history = loadFullHistory(req.params.applicantUserId);
  if (!history.length) return res.status(404).json({ error: 'No application history found' });
  res.json({ history });
});

// Admin comparison view: diff between two versions (defaults to previous vs current)
router.get('/compare/:applicantUserId', requireAuth, requireAdmin, (req, res) => {
  const history = loadFullHistory(req.params.applicantUserId);
  if (history.length < 1) return res.status(404).json({ error: 'No application history found' });

  const toVersion = req.query.to ? Number(req.query.to) : history[history.length - 1].version;
  const fromVersion = req.query.from ? Number(req.query.from) : Math.max(1, toVersion - 1);

  const from = history.find(h => h.version === fromVersion) || null;
  const to = history.find(h => h.version === toVersion) || history[history.length - 1];

  const fromData = from?.data || {};
  const toData = to?.data || {};
  const allKeys = new Set([...Object.keys(fromData), ...Object.keys(toData)]);
  const fieldDiffs = [];
  for (const key of allKeys) {
    if (key === 'documents') continue; // handled separately below
    const beforeVal = fromData[key];
    const afterVal = toData[key];
    const changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
    fieldDiffs.push({ field: key, before: beforeVal ?? null, after: afterVal ?? null, changed });
  }

  const beforeDocs = fromData.documents || [];
  const afterDocs = toData.documents || [];
  const beforeNames = new Set(beforeDocs.map(d => d.name));
  const afterNames = new Set(afterDocs.map(d => d.name));
  const addedDocs = afterDocs.filter(d => !beforeNames.has(d.name));
  const removedDocs = beforeDocs.filter(d => !afterNames.has(d.name));

  res.json({
    from: from ? { version: from.version, status: from.status, created_at: from.created_at } : null,
    to: { version: to.version, status: to.status, created_at: to.created_at },
    fieldDiffs,
    addedDocs,
    removedDocs,
    versions: history.map(h => ({ version: h.version, status: h.status, created_at: h.created_at })),
  });
});

// --- Review actions ---

router.put('/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!application) return res.status(404).json({ error: 'Application not found' });

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE applications SET status = 'approved', reviewer_id = ?, reviewer_name = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, req.user.name, application.id);
    db.prepare("UPDATE users SET approval_status = 'approved' WHERE id = ?").run(application.applicant_user_id);
  });
  tx();

  const applicant = db.prepare('SELECT id, name FROM users WHERE id = ?').get(application.applicant_user_id);
  notifyUser({
    user_id: application.applicant_user_id, type: 'general',
    title: 'Your application has been approved! 🎉',
    body: 'Welcome aboard — you now have full access to your class resources.',
    link: '/dashboard',
  });

  logAudit(req, {
    module: 'applications', action: 'approved',
    description: `${req.user.name} approved ${applicant?.name || 'an applicant'}'s application (v${application.version})`,
    previousValue: { status: application.status }, newValue: { status: 'approved' },
    metadata: { application_id: application.id, applicant_user_id: application.applicant_user_id },
  });

  res.json({ ok: true });
});

router.put('/:id/reject', requireAuth, requireAdmin, (req, res) => {
  const { reason, comments } = req.body;
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required' });

  const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!application) return res.status(404).json({ error: 'Application not found' });

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE applications SET status = 'rejected', reviewer_id = ?, reviewer_name = ?,
        rejection_reason = ?, reviewer_comments = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, req.user.name, reason, comments || null, application.id);
    // Rejected applications are NEVER deleted — only the account's approval_status flips
    // so the applicant is blocked from logging in until they reapply and get approved.
    db.prepare("UPDATE users SET approval_status = 'rejected' WHERE id = ?").run(application.applicant_user_id);
  });
  tx();

  const applicant = db.prepare('SELECT id, name FROM users WHERE id = ?').get(application.applicant_user_id);

  logAudit(req, {
    module: 'applications', action: 'rejected',
    description: `${req.user.name} rejected ${applicant?.name || 'an applicant'}'s application (v${application.version}) — ${reason}`,
    previousValue: { status: application.status },
    newValue: { status: 'rejected', reason, comments },
    metadata: { application_id: application.id, applicant_user_id: application.applicant_user_id },
  });

  res.json({ ok: true });
});

// --- Applicant-facing: reapply (creates a new version, copying previous data) ---

router.get('/mine', requireAuth, (req, res) => {
  const history = loadFullHistory(req.user.id);
  res.json({ history });
});

// A rejected applicant cannot log in (no JWT issued), so the "Reapply" flow on
// the public Login screen re-verifies their email+password directly instead
// of relying on requireAuth, then reuses the same versioning logic below.
router.post('/reapply-public', upload.array('documents', 10), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.approval_status !== 'rejected') {
    return res.status(400).json({ error: 'Reapplication is only available for rejected applications' });
  }
  req.user = { id: user.id, name: user.name, role: user.role };
  return handleReapply(req, res);
});

router.post('/reapply', requireAuth, upload.array('documents', 10), (req, res) => handleReapply(req, res));

function handleReapply(req, res) {
  const history = loadFullHistory(req.user.id);
  const current = history[history.length - 1];
  if (!current) return res.status(404).json({ error: 'No existing application found to reapply from' });
  if (current.status !== 'rejected') {
    return res.status(400).json({ error: 'You can only reapply after a rejection' });
  }

  // Copy all previous data/uploads, then apply only the edited fields —
  // "allowing edits only where needed (don't refill entire form)".
  const editable = ['name', 'class_level', 'section', 'gender'];
  const nextData = { ...current.data };
  for (const field of editable) {
    if (req.body[field] !== undefined && req.body[field] !== '') nextData[field] = req.body[field];
  }
  // Keep previous documents, then append any newly uploaded ones.
  const previousDocs = current.data.documents || [];
  const newDocs = (req.files || []).map(f => ({ name: f.originalname, path: `/uploads/${f.filename}` }));
  nextData.documents = [...previousDocs, ...newDocs];

  const nextVersion = current.version + 1;

  const tx = db.transaction(() => {
    db.prepare('UPDATE applications SET is_current = 0 WHERE applicant_user_id = ?').run(req.user.id);
    const info = db.prepare(`
      INSERT INTO applications (applicant_user_id, version, status, data, is_current)
      VALUES (?, ?, 'submitted', ?, 1)
    `).run(req.user.id, nextVersion, JSON.stringify(nextData));

    // Update the user's live profile fields to match the new submission, and
    // reset them back to pending review.
    db.prepare(`
      UPDATE users SET name = ?, class_level = ?, section = ?, gender = ?, approval_status = 'pending'
      WHERE id = ?
    `).run(
      nextData.name, nextData.class_level ? Number(nextData.class_level) : null,
      nextData.section || null, nextData.gender || null, req.user.id
    );
    return info.lastInsertRowid;
  });
  const newAppId = tx();

  notifyAdmins({
    type: 'general',
    title: 'Reapplication submitted',
    body: `${nextData.name} submitted a new application (v${nextVersion}) after a previous rejection`,
    link: '/admin/registry',
    related_id: newAppId,
  });

  logAudit(req, {
    module: 'applications', action: 'reapplied',
    description: `${nextData.name} reapplied (v${nextVersion}) after a previous rejection`,
    previousValue: { version: current.version, status: current.status },
    newValue: { version: nextVersion, status: 'submitted' },
    metadata: { applicant_user_id: req.user.id },
  });

  const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(newAppId);
  res.json({ application: { ...application, data: safeParse(application.data) } });
}

export default router;
