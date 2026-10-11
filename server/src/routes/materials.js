import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import { notifyClass } from '../utils/notify.js';
import { awardXp, touchStreak } from '../utils/gamification.js';
import { logAudit } from '../utils/audit.js';
import { resolveScope, isWithinScope } from '../services/scope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'audio/mpeg',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Unsupported file type'));
    }
    cb(null, true);
  },
});

const router = Router();

router.get('/subject/:subjectId', requireAuth, (req, res) => {
  const materials = db.prepare('SELECT * FROM materials WHERE subject_id = ? ORDER BY created_at DESC').all(req.params.subjectId);
  if (req.user.role !== 'student') {
    const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.subjectId);
    const scope = resolveScope(req.user);
    if (subject && !scope.unrestricted && !isWithinScope(scope, { classLevel: subject.class_level, subjectId: subject.id })) {
      return res.status(403).json({ error: 'You are not assigned to this subject.' });
    }
  }
  res.json({ materials });
});

// CRITICAL FIX: previously returned every piece of content for a class to
// any staff member, regardless of subject assignment — a Math teacher for
// Class 10 could see (and, worse, the create endpoint below let them
// upload/delete) English/Science/Computer content for that same class.
router.get('/class/:cls', requireAuth, (req, res) => {
  const materials = db.prepare(`
    SELECT m.*, s.name as subject_name, s.color as subject_color
    FROM materials m JOIN subjects s ON m.subject_id = s.id
    WHERE m.class_level = ? ORDER BY m.created_at DESC
  `).all(req.params.cls);

  if (req.user.role === 'student') return res.json({ materials });

  const scope = resolveScope(req.user);
  const inScope = scope.unrestricted
    ? materials
    : materials.filter(m => isWithinScope(scope, { classLevel: m.class_level, subjectId: m.subject_id }));
  res.json({ materials: inScope });
});

router.post('/', requireAuth, requireStaff, requirePermission('content.create'), upload.single('file'), (req, res) => {
  const { subject_id, class_level, title, description, type, external_url, topic, difficulty } = req.body;
  if (!subject_id || !class_level || !title || !type) {
    return res.status(400).json({ error: 'subject_id, class_level, title, type required' });
  }

  const scope = resolveScope(req.user);
  if (!scope.unrestricted && !isWithinScope(scope, { classLevel: class_level, subjectId: subject_id })) {
    return res.status(403).json({ error: 'You can only create content for subjects assigned to you.' });
  }

  const filePath = req.file ? `/uploads/${req.file.filename}` : null;
  const info = db.prepare(`
    INSERT INTO materials (subject_id, class_level, title, description, type, file_path, external_url, topic, difficulty, uploaded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(subject_id, class_level, title, description || '', type, filePath, external_url || null, topic || null, difficulty || 'medium', req.user.id);
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid);

  const subject = db.prepare('SELECT name FROM subjects WHERE id = ?').get(subject_id);
  notifyClass({
    class_level: Number(class_level),
    type: 'material',
    title: `New material in ${subject?.name || 'a subject'}`,
    body: title,
    link: '/materials',
    related_id: material.id,
  });

  logAudit(req, {
    module: 'content', action: 'uploaded',
    description: `${req.user.name} uploaded "${title}" to ${subject?.name || 'a subject'} (Class ${class_level})`,
    newValue: { title, type, subject_id, class_level },
  });

  res.json({ material });
});

router.delete('/:id', requireAuth, requireStaff, requirePermission('content.archive'), (req, res) => {
  const mat = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!mat) return res.status(404).json({ error: 'Material not found' });
  const scope = resolveScope(req.user);
  if (!scope.unrestricted && !isWithinScope(scope, { classLevel: mat.class_level, subjectId: mat.subject_id })) {
    return res.status(403).json({ error: 'You can only delete content for subjects assigned to you.' });
  }
  if (mat?.file_path) {
    const p = path.join(UPLOAD_DIR, path.basename(mat.file_path));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);

  if (mat) {
    logAudit(req, {
      module: 'content', action: 'deleted',
      description: `${req.user.name} deleted material "${mat.title}"`,
      previousValue: { title: mat.title, type: mat.type },
    });
  }

  res.json({ ok: true });
});

// Track a view (for progress & recommendations)
router.post('/:id/view', requireAuth, (req, res) => {
  const alreadyViewed = db.prepare('SELECT id FROM material_views WHERE material_id = ? AND student_id = ?').get(req.params.id, req.user.id);
  db.prepare('INSERT INTO material_views (material_id, student_id) VALUES (?,?)').run(req.params.id, req.user.id);

  const streak = touchStreak(req.user.id);
  const xpResult = alreadyViewed ? null : awardXp(req.user.id, 'material_view', 'material', req.params.id);

  res.json({ ok: true, xp: xpResult, streak });
});

export default router;
