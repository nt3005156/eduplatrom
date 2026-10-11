import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { invalidateUserRoleCache, resolveAllPermissions } from '../services/permissions.js';
import { resolveScope } from '../services/scope.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

// Every route in this file is System-Admin-only, per the architecture doc
// §3.2/§12: "settings.permission_matrix" is intentionally not grantable to
// any other role, and the admin_only flag on that permission is enforced in
// services/permissions.js as a code-level backstop even if role_permissions
// were somehow misconfigured. requireAdmin here is the first line of
// defense; the admin_only permission check is the second.
router.use(requireAuth, requireAdmin);

// GET /api/roles — full role catalogue with permission counts, for the
// Permission Matrix screen's role column headers.
router.get('/', (req, res) => {
  const roles = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id AND rp.effect = 'allow') as allow_count,
      (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) as user_count
    FROM roles r ORDER BY r.rank
  `).all();
  res.json({ roles });
});

// POST /api/roles — create a custom role (e.g. "Vice Principal", "Librarian").
// This is the concrete mechanism proving the architecture's "new roles can
// be added without changing the architecture" claim — no code deploy needed.
router.post('/', (req, res) => {
  const { key, label, rank, description, clone_from_role_id } = req.body;
  if (!key || !label || rank == null) return res.status(400).json({ error: 'key, label, and rank are required' });
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return res.status(400).json({ error: 'key must be lowercase snake_case (e.g. vice_principal)' });

  const existing = db.prepare('SELECT id FROM roles WHERE key = ?').get(key);
  if (existing) return res.status(409).json({ error: 'A role with this key already exists' });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO roles (key, label, rank, is_system_role, description) VALUES (?,?,?,0,?)
    `).run(key, label, Number(rank), description || null);
    const newRoleId = info.lastInsertRowid;

    // Optionally clone another role's permission grants as a starting point,
    // so an admin doesn't have to configure 25 permissions from a blank slate.
    if (clone_from_role_id) {
      const sourceGrants = db.prepare('SELECT permission_id, effect FROM role_permissions WHERE role_id = ?').all(clone_from_role_id);
      const insertGrant = db.prepare('INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?,?,?)');
      for (const g of sourceGrants) insertGrant.run(newRoleId, g.permission_id, g.effect);
    }
    return newRoleId;
  });
  const newRoleId = tx();

  logAudit(req, {
    module: 'settings', action: 'role_created',
    description: `${req.user.name} created a new role "${label}" (${key})`,
    newValue: { key, label, rank, cloned_from: clone_from_role_id || null },
  });

  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(newRoleId);
  res.json({ role });
});

router.delete('/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.is_system_role) return res.status(400).json({ error: 'System roles cannot be deleted.' });

  const usersWithRole = db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ?').get(role.id).c;
  if (usersWithRole > 0) {
    return res.status(409).json({ error: `${usersWithRole} user(s) currently hold this role. Reassign them before deleting it.` });
  }

  db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  logAudit(req, { module: 'settings', action: 'role_deleted', description: `${req.user.name} deleted custom role "${role.label}"` });
  res.json({ ok: true });
});

// GET /api/roles/:id/permissions — one role's current grants (allow/deny/unset per permission).
router.get('/:id/permissions', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  const allPermissions = db.prepare('SELECT * FROM permissions ORDER BY module, key').all();
  const grants = db.prepare('SELECT permission_id, effect FROM role_permissions WHERE role_id = ?').all(role.id);
  const grantByPermId = Object.fromEntries(grants.map(g => [g.permission_id, g.effect]));

  const permissions = allPermissions.map(p => ({ ...p, effect: grantByPermId[p.id] || null })); // null = unset/inherit(deny)
  res.json({ role, permissions });
});

// PUT /api/roles/:id/permissions — bulk-save the matrix for one role.
// body: { grants: [{ permission_id, effect: 'allow'|'deny'|null }] }
// effect=null deletes the row (falls back to fail-closed deny at resolution time).
router.put('/:id/permissions', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const { grants } = req.body;
  if (!Array.isArray(grants)) return res.status(400).json({ error: 'grants must be an array' });

  // Defense-in-depth: even if someone tries to grant an admin_only permission
  // (teacher.manage, settings.permission_matrix) to a non-system role through
  // this endpoint, silently drop it — hasPermission() would ignore it anyway,
  // but rejecting it here keeps the stored matrix state honest/non-misleading.
  const adminOnlyKeys = new Set(
    db.prepare('SELECT id FROM permissions WHERE admin_only = 1').all().map(r => r.id)
  );

  const before = db.prepare('SELECT permission_id, effect FROM role_permissions WHERE role_id = ?').all(role.id);

  const tx = db.transaction(() => {
    for (const g of grants) {
      if (adminOnlyKeys.has(g.permission_id)) continue;
      if (g.effect === null || g.effect === undefined) {
        db.prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?').run(role.id, g.permission_id);
      } else if (['allow', 'deny'].includes(g.effect)) {
        db.prepare(`
          INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?,?,?)
          ON CONFLICT(role_id, permission_id) DO UPDATE SET effect = excluded.effect
        `).run(role.id, g.permission_id, g.effect);
      }
    }
  });
  tx();

  // Invalidate the in-process permission cache for every user holding this
  // role so the change takes effect on their very next request, not after
  // the cache TTL expires.
  const affectedUsers = db.prepare('SELECT id FROM users WHERE role_id = ?').all(role.id);
  for (const u of affectedUsers) invalidateUserRoleCache(u.id);

  const after = db.prepare('SELECT permission_id, effect FROM role_permissions WHERE role_id = ?').all(role.id);
  logAudit(req, {
    module: 'settings', action: 'permission_changed',
    description: `${req.user.name} updated the permission matrix for role "${role.label}"`,
    previousValue: before, newValue: after,
    metadata: { role_id: role.id, role_key: role.key, affected_user_count: affectedUsers.length },
  });

  res.json({ ok: true, affected_user_count: affectedUsers.length });
});

// GET /api/roles/users/:userId/effective-permissions — "Preview as this
// teacher" tool from the architecture doc §4.4, so an admin can verify a
// configuration before/after saving instead of guessing.
router.get('/users/:userId/effective-permissions', (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, role_id FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { role, permissions } = resolveAllPermissions(user);
  const scope = resolveScope(user);
  res.json({ user, role, permissions, scope });
});

// POST /api/roles/users/:userId/overrides — grant/deny a temporary or
// permanent per-user override. reason is required per the architecture
// doc's audit-transparency requirement.
router.post('/users/:userId/overrides', (req, res) => {
  const { permission_id, effect, reason, expires_at } = req.body;
  if (!permission_id || !['allow', 'deny'].includes(effect)) {
    return res.status(400).json({ error: 'permission_id and effect (allow|deny) are required' });
  }
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required for every permission override.' });

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const permission = db.prepare('SELECT * FROM permissions WHERE id = ?').get(permission_id);
  if (!permission) return res.status(404).json({ error: 'Permission not found' });
  if (permission.admin_only) return res.status(403).json({ error: 'This permission cannot be overridden — it is System Admin only.' });

  db.prepare(`
    INSERT INTO user_permission_overrides (user_id, permission_id, effect, reason, granted_by, expires_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id, permission_id) DO UPDATE SET effect = excluded.effect, reason = excluded.reason,
      granted_by = excluded.granted_by, expires_at = excluded.expires_at, created_at = datetime('now')
  `).run(user.id, permission_id, effect, reason.trim(), req.user.id, expires_at || null);

  invalidateUserRoleCache(user.id);

  logAudit(req, {
    module: 'settings', action: 'override_granted',
    description: `${req.user.name} ${effect === 'allow' ? 'granted' : 'denied'} "${permission.label}" for ${user.name}${expires_at ? ` until ${expires_at}` : ' (permanent)'}`,
    newValue: { permission_id, effect, reason, expires_at },
    metadata: { user_id: user.id },
  });

  res.json({ ok: true });
});

router.get('/users/:userId/overrides', (req, res) => {
  const overrides = db.prepare(`
    SELECT upo.*, p.key as permission_key, p.label as permission_label, p.module, g.name as granted_by_name
    FROM user_permission_overrides upo
    JOIN permissions p ON upo.permission_id = p.id
    LEFT JOIN users g ON upo.granted_by = g.id
    WHERE upo.user_id = ?
    ORDER BY upo.created_at DESC
  `).all(req.params.userId);
  res.json({ overrides });
});

router.delete('/overrides/:id', (req, res) => {
  const override = db.prepare('SELECT * FROM user_permission_overrides WHERE id = ?').get(req.params.id);
  if (!override) return res.status(404).json({ error: 'Override not found' });

  db.prepare('DELETE FROM user_permission_overrides WHERE id = ?').run(override.id);
  invalidateUserRoleCache(override.user_id);

  const permission = db.prepare('SELECT label FROM permissions WHERE id = ?').get(override.permission_id);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(override.user_id);
  logAudit(req, {
    module: 'settings', action: 'override_revoked',
    description: `${req.user.name} revoked the "${permission?.label || ''}" override for ${user?.name || ''}`,
    previousValue: override,
  });

  res.json({ ok: true });
});

export default router;
