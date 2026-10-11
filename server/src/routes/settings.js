import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { randomUUID } from 'crypto';
import { UPLOADS_DIR } from '../config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Branding (logo/favicon) is shown on the public login page, so it lives in a
// public folder. Everything else under /uploads requires sign-in.
const UPLOAD_DIR = path.join(UPLOADS_DIR, 'public');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'brand-' + randomUUID() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

// Public: any visitor / logged-in user can read branding to render the site
router.get('/', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.json({ settings });
});

// GET /api/settings/sessions — list academic sessions (for the session picker)
router.get('/sessions', requireAuth, (req, res) => {
  const sessions = db.prepare('SELECT * FROM academic_sessions ORDER BY start_date DESC').all();
  res.json({ sessions });
});

router.post('/sessions', requireAuth, requireAdmin, (req, res) => {
  const { name, start_date, end_date, is_active } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const tx = db.transaction(() => {
    if (is_active) db.prepare('UPDATE academic_sessions SET is_active = 0').run();
    const info = db.prepare('INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES (?,?,?,?)')
      .run(name, start_date || null, end_date || null, is_active ? 1 : 0);
    if (is_active) db.prepare('UPDATE settings SET active_session_id = ? WHERE id = 1').run(info.lastInsertRowid);
    return info.lastInsertRowid;
  });
  const id = tx();
  logAudit(req, { module: 'settings', action: 'updated', description: `${req.user.name} created academic session "${name}"`, newValue: { name, start_date, end_date, is_active } });
  const session = db.prepare('SELECT * FROM academic_sessions WHERE id = ?').get(id);
  res.json({ session });
});

router.put('/sessions/:id/activate', requireAuth, requireAdmin, (req, res) => {
  const tx = db.transaction(() => {
    db.prepare('UPDATE academic_sessions SET is_active = 0').run();
    db.prepare('UPDATE academic_sessions SET is_active = 1 WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE settings SET active_session_id = ? WHERE id = 1').run(req.params.id);
  });
  tx();
  const session = db.prepare('SELECT * FROM academic_sessions WHERE id = ?').get(req.params.id);
  logAudit(req, { module: 'settings', action: 'updated', description: `${req.user.name} activated academic session "${session?.name}"` });
  res.json({ session });
});

// GET /api/settings/sections — list of class sections (for global filters)
router.get('/sections', requireAuth, (req, res) => {
  const { class_level } = req.query;
  const sections = class_level
    ? db.prepare('SELECT * FROM sections WHERE class_level = ? ORDER BY name').all(class_level)
    : db.prepare('SELECT * FROM sections ORDER BY class_level, name').all();
  res.json({ sections });
});

router.post('/sections', requireAuth, requireAdmin, (req, res) => {
  const { class_level, name } = req.body;
  if (!class_level || !name) return res.status(400).json({ error: 'class_level and name are required' });
  try {
    const info = db.prepare('INSERT INTO sections (class_level, name) VALUES (?,?)').run(class_level, name);
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid);
    res.json({ section });
  } catch (e) {
    res.status(409).json({ error: 'This section already exists for this class' });
  }
});

router.delete('/sections/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

const ALLOWED_FIELDS = [
  // Branding
  'site_name', 'tagline', 'logo_url', 'favicon_url', 'hero_image_url',
  'primary_color', 'accent_color', 'font_family', 'body_font', 'ui_density', 'corner_style', 'default_theme',
  // Legacy footer/contact — retained for backward compatibility, no longer
  // surfaced in Branding & Settings (managed by the dedicated Footer & Contact module)
  'footer_about', 'contact_email', 'contact_phone', 'address',
  'social_facebook', 'social_twitter', 'social_instagram', 'social_youtube', 'social_linkedin',
  // Enterprise configuration
  'school_name', 'school_registration_no', 'school_address',
  'default_language', 'date_format', 'time_format', 'timezone',
  'homepage_headline', 'homepage_subheadline',
  'email_from_name', 'email_from_address', 'email_smtp_host', 'email_smtp_port',
  'notify_new_registration', 'notify_new_submission', 'notify_grading_complete',
  'gamification_enabled',
];

router.put('/', requireAuth, requireAdmin, (req, res) => {
  // SQLite stores 0/1, not true/false.
  if (req.body.gamification_enabled !== undefined) req.body.gamification_enabled = req.body.gamification_enabled ? 1 : 0;
  const updates = [];
  const values = [];
  const previous = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  for (const field of ALLOWED_FIELDS) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields provided' });
  updates.push("updated_at = datetime('now')");
  db.prepare(`UPDATE settings SET ${updates.join(', ')} WHERE id = 1`).run(...values);
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

  logAudit(req, {
    module: 'settings', action: 'updated',
    description: `${req.user.name} updated branding & site settings`,
    previousValue: previous,
    newValue: settings,
  });

  res.json({ settings });
});

// Upload a branding image (logo / favicon / hero) and get back a URL to save via PUT /settings
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/public/${req.file.filename}` });
});

// Student/any authenticated user: update their own theme preference
router.put('/theme', requireAuth, (req, res) => {
  const { theme } = req.body;
  if (!['light', 'dark'].includes(theme)) return res.status(400).json({ error: 'theme must be light or dark' });
  db.prepare('UPDATE users SET theme_preference = ? WHERE id = ?').run(theme, req.user.id);
  res.json({ ok: true, theme });
});

export default router;
