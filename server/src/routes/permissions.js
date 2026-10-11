import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/permissions — the full permission catalogue, grouped by module,
// for the Permission Matrix screen's row headers. System-Admin-only, same
// as everything else touching the RBAC configuration itself.
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const permissions = db.prepare('SELECT * FROM permissions ORDER BY module, key').all();
  res.json({ permissions });
});

export default router;
