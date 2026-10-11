// Data-subject rights: access/export (GDPR Art. 15 / 20, FERPA parent-and-student
// access) and erasure (GDPR Art. 17). Every request is written to the audit log.
//
// Retention rule for erasure: the person's identity is removed (name, email,
// password, avatar, notifications, uploaded files). Academic records (grades,
// attendance) are kept with the link to the person removed, because schools
// must keep them for legal reporting. The school's retention policy decides how
// long; this endpoint does not delete academic history.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const PROFILE_FIELDS = `id, name, email, role, class_level, section, gender, approval_status,
  account_status, staff_role, created_at`;

/** Everything the platform holds about one person, in a portable JSON shape. */
export function buildExport(userId) {
  const profile = db.prepare(`SELECT ${PROFILE_FIELDS} FROM users WHERE id = ?`).get(userId);
  if (!profile) return null;
  return {
    format_version: 1,
    exported_at: new Date().toISOString(),
    profile,
    attendance: db.prepare(`
      SELECT a.date, a.status, a.remarks, a.class_level, a.section, s.name AS subject
      FROM attendance_records a LEFT JOIN subjects s ON s.id = a.subject_id
      WHERE a.student_id = ? ORDER BY a.date`).all(userId),
    submissions: db.prepare(`
      SELECT assignment_id, status, grade, feedback, is_late, version_count, submitted_at, graded_at, note
      FROM submissions WHERE student_id = ? ORDER BY submitted_at`).all(userId),
    quiz_attempts: db.prepare(`
      SELECT quiz_id, attempt_number, score, total, status, attempted_at
      FROM quiz_attempts WHERE student_id = ? ORDER BY attempted_at`).all(userId),
    notifications: db.prepare(`
      SELECT type, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at`).all(userId),
    // Actions this person performed (their audit trail as an actor).
    audit_trail: db.prepare(`
      SELECT module, action, description, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5000`).all(userId),
  };
}

// Students export their own data.
router.get('/me/export', requireAuth, (req, res) => {
  const data = buildExport(req.user.id);
  if (!data) return res.status(404).json({ error: 'Account not found' });
  logAudit(req, { module: 'privacy', action: 'exported', description: `${req.user.name} exported their own data` });
  res.setHeader('Content-Disposition', `attachment; filename="my-data-${req.user.id}.json"`);
  res.json(data);
});

// Admins export any person's data (for an access request from a parent, student or regulator).
router.get('/users/:id/export', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const data = Number.isInteger(id) ? buildExport(id) : null;
  if (!data) return res.status(404).json({ error: 'Account not found' });
  logAudit(req, { module: 'privacy', action: 'exported', description: `${req.user.name} exported data for user #${id}`, newValue: { user_id: id } });
  res.setHeader('Content-Disposition', `attachment; filename="user-${id}-data.json"`);
  res.json(data);
});

/** Remove an uploaded file, but only if it really lives in the uploads folder. */
function deleteUpload(storedPath) {
  if (!storedPath) return false;
  const file = path.join(UPLOADS_DIR, path.basename(String(storedPath)));
  if (!file.startsWith(UPLOADS_DIR + path.sep)) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

// Erasure: anonymize a person. Requires the admin to type the word ANONYMIZE.
router.post('/users/:id/anonymize', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot anonymize your own account' });
  if (req.body?.confirm !== 'ANONYMIZE') return res.status(400).json({ error: 'Type ANONYMIZE to confirm' });

  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Account not found' });

  let filesRemoved = 0;
  const tx = db.transaction(() => {
    const subs = db.prepare('SELECT id, file_path, attachments FROM submissions WHERE student_id = ?').all(id);
    for (const s of subs) {
      if (deleteUpload(s.file_path)) filesRemoved++;
      let list = [];
      try { list = JSON.parse(s.attachments || '[]'); } catch { list = []; }
      for (const a of list) if (deleteUpload(a.path)) filesRemoved++;
      db.prepare('UPDATE submissions SET file_path = NULL, attachments = NULL WHERE id = ?').run(s.id);
    }
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
    // Actor name on their own audit rows (the descriptions are kept for the record).
    db.prepare("UPDATE audit_logs SET user_name = 'Former user' WHERE user_id = ?").run(id);
    db.prepare(`UPDATE users SET name = ?, email = ?, password_hash = '!disabled', gender = NULL,
        avatar_color = '#B2BEC3', account_status = 'archived', pref_class_level = NULL, pref_section = NULL,
        pref_subject_id = NULL WHERE id = ?`)
      .run(`Former ${user.role} #${id}`, `anonymized-${id}@deleted.invalid`, id);
  });
  tx();

  logAudit(req, {
    module: 'privacy', action: 'anonymized',
    description: `${req.user.name} anonymized user #${id} (erasure request); ${filesRemoved} file(s) removed`,
    newValue: { user_id: id, files_removed: filesRemoved },
  });
  res.json({ ok: true, user_id: id, files_removed: filesRemoved, retained: ['grades', 'attendance', 'quiz results (unlinked from identity)'] });
});

export default router;
