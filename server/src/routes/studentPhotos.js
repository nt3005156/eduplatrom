// Phase 1: student photo. A student's own photo, or any admin, can change it. Who may VIEW the photo is
// decided by services/fileAccess.js (the student, admins, and teachers of the student's class).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { UPLOADS_DIR } from '../config/paths.js';

const router = Router();
const MAX_BYTES = 2 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

/** Recognise JPEG, PNG and WebP by their leading bytes. The browser's declared type is not trusted. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function removeFile(storedPath) {
  if (!storedPath) return false;
  const file = path.join(UPLOADS_DIR, path.basename(String(storedPath)));
  if (!file.startsWith(UPLOADS_DIR + path.sep)) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

function canChangePhoto(req, targetId) {
  return req.user.role === 'admin' || req.user.id === targetId;
}

// POST /api/users/:id/photo (multipart field "photo")
router.post('/:id/photo', requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
  if (!canChangePhoto(req, id)) return res.status(403).json({ error: 'You can only change your own photo' });
  next();
}, upload.single('photo'), (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, name, role, photo_path FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  if (target.role !== 'student') return res.status(400).json({ error: 'Photos are kept for students only' });
  if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG or WebP image' });

  const ext = sniffImage(req.file.buffer);
  if (!ext) return res.status(400).json({ error: 'That file is not a JPEG, PNG or WebP image' });

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = `photo-${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), req.file.buffer, { mode: 0o600 });
  db.prepare('UPDATE users SET photo_path = ? WHERE id = ?').run(`/uploads/${name}`, id);
  removeFile(target.photo_path); // the old photo goes once the new one is saved

  logAudit(req, {
    module: 'users', action: 'photo_updated',
    description: `${req.user.name} ${target.photo_path ? 'replaced' : 'added'} the photo for ${target.name}`,
    newValue: { user_id: id },
  });
  res.json({ ok: true, photo_url: `/uploads/${name}` });
});

// DELETE /api/users/:id/photo
router.delete('/:id/photo', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
  if (!canChangePhoto(req, id)) return res.status(403).json({ error: 'You can only change your own photo' });
  const target = db.prepare('SELECT id, name, photo_path FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Account not found' });
  db.prepare('UPDATE users SET photo_path = NULL WHERE id = ?').run(id);
  removeFile(target.photo_path);
  logAudit(req, {
    module: 'users', action: 'photo_removed',
    description: `${req.user.name} removed the photo for ${target.name}`,
    newValue: { user_id: id },
  });
  res.json({ ok: true });
});

export default router;
