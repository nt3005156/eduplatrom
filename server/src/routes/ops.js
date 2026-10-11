// Phase 0: operations endpoints for administrators (error log and database status).
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { listErrors } from '../services/errorLog.js';

const router = Router();

// GET /api/ops/errors: distinct errors seen by the server, with counts. Admin only.
router.get('/errors', requireAuth, requireAdmin, (req, res) => {
  res.json({ errors: listErrors({ limit: Number(req.query.limit) || 100 }) });
});

// POST /api/ops/errors/clear-old: remove rows not seen in 90 days (retention). Admin only.
router.post('/errors/clear-old', requireAuth, requireAdmin, (req, res) => {
  const removed = db.prepare("DELETE FROM error_events WHERE last_seen < datetime('now', '-90 days')").run().changes;
  res.json({ removed });
});

export default router;
