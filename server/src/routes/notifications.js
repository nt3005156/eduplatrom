import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const notifications = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(req.user.id, limit);
  const unreadCount = db.prepare(
    'SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0'
  ).get(req.user.id).c;
  res.json({ notifications, unreadCount });
});

router.put('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.put('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.json({ ok: true });
});

// Clear (permanently delete) all of the current user's notifications at once
router.delete('/all', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true, deleted: info.changes });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
