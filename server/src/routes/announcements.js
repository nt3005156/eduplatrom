import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { notifyClass } from '../utils/notify.js';
import { logAudit } from '../utils/audit.js';
import { hasPermission } from '../services/permissions.js';
import { resolveScope, isWithinScope } from '../services/scope.js';
import { queueNotice } from '../services/messaging/alerts.js';
import { CHANNELS } from '../services/messaging/outbox.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const cls = req.user.role === 'student' ? req.user.class_level : req.query.class_level;
  let announcements;
  if (cls) {
    announcements = db.prepare('SELECT * FROM announcements WHERE class_level = ? OR class_level IS NULL ORDER BY created_at DESC LIMIT 20').all(cls);
  } else {
    announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50').all();
  }
  res.json({ announcements });
});

// CRITICAL FIX: previously any staff member (including a plain Subject
// Teacher) could publish a school-wide announcement (class_level=null) or
// target ANY class, not just their own. Per the RBAC design:
//   - 'communication.broadcast_school' (class_level = null / whole school)
//     is only granted to Academic Head / System Admin.
//   - 'communication.broadcast_class' (a specific class) additionally
//     requires that class to actually be within the caller's own scope —
//     a Subject/Class Teacher can only announce to a class they teach.
router.post('/', requireAuth, requireStaff, (req, res) => {
  const { class_level, title, body, parent_channels } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  // Optional: also send the announcement to parents by SMS, WhatsApp, or email. Validated before anything is saved.
  let parentChannels = null;
  if (parent_channels !== undefined && parent_channels !== null && parent_channels !== '') {
    if (!Array.isArray(parent_channels) || parent_channels.length === 0 || parent_channels.some(c => !CHANNELS.includes(c))) {
      return res.status(400).json({ error: 'parent_channels must be a list of sms, whatsapp, email' });
    }
    if (String(title).length > 100 || String(body || '').trim().length < 3 || String(body).length > 480) {
      return res.status(400).json({ error: 'To send to parents, the title must be up to 100 characters and the body 3 to 480 characters' });
    }
    parentChannels = [...new Set(parent_channels)];
  }

  if (!class_level) {
    if (!hasPermission(req.user, 'communication.broadcast_school')) {
      return res.status(403).json({ error: 'You do not have permission to send a school-wide announcement. Choose a specific class instead.' });
    }
  } else {
    if (!hasPermission(req.user, 'communication.broadcast_class')) {
      return res.status(403).json({ error: 'You do not have permission to publish announcements.' });
    }
    const scope = resolveScope(req.user);
    if (!scope.unrestricted && !isWithinScope(scope, { classLevel: class_level })) {
      return res.status(403).json({ error: 'You can only send announcements to classes you are assigned to.' });
    }
  }

  const info = db.prepare('INSERT INTO announcements (class_level, title, body, created_by) VALUES (?,?,?,?)')
    .run(class_level || null, title, body || '', req.user.id);
  const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid);

  notifyClass({
    class_level: class_level ? Number(class_level) : null,
    type: 'announcement',
    title: `📢 ${title}`,
    body: body || '',
    link: '/announcements',
    related_id: announcement.id,
  });

  let parentNotice = null;
  if (parentChannels) {
    parentNotice = queueNotice({
      class_level: class_level ? Number(class_level) : null,
      title: String(title).trim(), body: String(body).trim(),
      channels: parentChannels, idempotency_key: `announcement-${announcement.id}`,
    });
  }

  logAudit(req, {
    module: 'content', action: 'created',
    description: `${req.user.name} published announcement "${title}"${class_level ? ` for Class ${class_level}` : ' (all classes)'}`,
    newValue: { title, class_level, parent_channels: parentChannels },
  });

  res.json({ announcement, parent_messages: parentNotice });
});

router.delete('/:id', requireAuth, requireStaff, (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  if (a) logAudit(req, { module: 'content', action: 'deleted', description: `${req.user.name} deleted announcement "${a.title}"` });
  res.json({ ok: true });
});

export default router;
