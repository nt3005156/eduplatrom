import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import { parseDevice } from '../utils/audit.js';

const router = Router();

function withDevice(log) {
  return { ...log, device: parseDevice(log.user_agent) };
}

// GET /api/audit — search/filter/paginate the audit log
router.get('/', requireAuth, requirePermission('audit.view'), (req, res) => {
  const {
    module, action, user_id, role, status, search,
    from, to,
    page = 1, pageSize = 25,
  } = req.query;

  const conditions = [];
  const params = [];

  if (module) { conditions.push('module = ?'); params.push(module); }
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (user_id) { conditions.push('user_id = ?'); params.push(user_id); }
  if (role) { conditions.push('user_role = ?'); params.push(role); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (from) { conditions.push('created_at >= ?'); params.push(from); }
  if (to) { conditions.push('created_at <= ?'); params.push(to); }
  if (search) {
    conditions.push('(description LIKE ? OR user_name LIKE ? OR module LIKE ? OR action LIKE ? OR ip_address LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${where}`).get(...params).c;

  const limit = Math.min(Number(pageSize) || 25, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const logs = db.prepare(`
    SELECT * FROM audit_logs ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    logs: logs.map(withDevice),
    pagination: { total, page: Number(page) || 1, pageSize: limit, totalPages: Math.ceil(total / limit) || 1 },
  });
});

// GET /api/audit/modules — distinct module/action/role/status values for filter dropdowns
router.get('/facets', requireAuth, requirePermission('audit.view'), (req, res) => {
  const modules = db.prepare('SELECT DISTINCT module FROM audit_logs ORDER BY module').all().map(r => r.module);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all().map(r => r.action);
  const roles = db.prepare("SELECT DISTINCT user_role FROM audit_logs WHERE user_role IS NOT NULL ORDER BY user_role").all().map(r => r.user_role);
  const statuses = db.prepare("SELECT DISTINCT status FROM audit_logs WHERE status IS NOT NULL ORDER BY status").all().map(r => r.status);
  res.json({ modules, actions, roles, statuses });
});

// GET /api/audit/user/:id — full activity timeline for one user
router.get('/user/:id', requireAuth, requirePermission('audit.view'), (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(req.params.id);
  res.json({ logs: logs.map(withDevice) });
});

// GET /api/audit/export — CSV export honoring the same filters as the list endpoint
router.get('/export', requireAuth, requirePermission('audit.view'), (req, res) => {
  const { module, action, user_id, role, status, search, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (module) { conditions.push('module = ?'); params.push(module); }
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (user_id) { conditions.push('user_id = ?'); params.push(user_id); }
  if (role) { conditions.push('user_role = ?'); params.push(role); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (from) { conditions.push('created_at >= ?'); params.push(from); }
  if (to) { conditions.push('created_at <= ?'); params.push(to); }
  if (search) {
    conditions.push('(description LIKE ? OR user_name LIKE ? OR module LIKE ? OR action LIKE ? OR ip_address LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const logs = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 5000`).all(...params).map(withDevice);

  const headers = ['id', 'created_at', 'user_name', 'user_role', 'module', 'action', 'status', 'description', 'ip_address', 'device', 'user_agent'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(',')]
    .concat(logs.map(l => headers.map(h => escape(l[h])).join(',')))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
  res.send(csv);
});

export default router;

