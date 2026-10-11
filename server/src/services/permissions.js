// Permission resolution engine — the single source of truth for "can this
// user do X." See docs/RBAC_ENTERPRISE_ARCHITECTURE.md §4.1 for the design.
//
// Resolution order (first match wins):
//   1. system_admin role -> always true (still auditable at the call site).
//   2. active (non-expired) user_permission_overrides row -> its effect.
//   3. role_permissions default for the user's role_id -> its effect.
//   4. no grant anywhere -> false (fail-closed, never fail-open).
import db from '../db/index.js';

const getUserRole = db.prepare(`
  SELECT u.id, u.role as legacy_role, u.role_id, r.key as role_key, r.label as role_label, r.rank as role_rank
  FROM users u LEFT JOIN roles r ON u.role_id = r.id
  WHERE u.id = ?
`);

const getOverride = db.prepare(`
  SELECT upo.effect FROM user_permission_overrides upo
  JOIN permissions p ON upo.permission_id = p.id
  WHERE upo.user_id = ? AND p.key = ? AND (upo.expires_at IS NULL OR upo.expires_at > datetime('now'))
`);

const getRoleGrant = db.prepare(`
  SELECT rp.effect FROM role_permissions rp
  JOIN permissions p ON rp.permission_id = p.id
  WHERE rp.role_id = ? AND p.key = ?
`);

const getPermissionMeta = db.prepare('SELECT * FROM permissions WHERE key = ?');

/** Simple in-process cache: userId -> { expiresAt, resolvedRole } to avoid a
 * role lookup on every single permission check within one request. This is
 * NOT a permission-result cache (those are cheap prepared-statement lookups
 * already) — it just avoids re-joining users->roles repeatedly. Invalidated
 * naturally by TTL; explicit invalidation on role change is provided via
 * invalidateUserRoleCache() for immediate effect after an admin edits a role.
 */
const roleCache = new Map();
const ROLE_CACHE_TTL_MS = 60_000;

function resolveUserRole(userId) {
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;
  const role = getUserRole.get(userId);
  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return role;
}

export function invalidateUserRoleCache(userId) {
  if (userId) roleCache.delete(userId);
  else roleCache.clear();
}

/**
 * @param {{id:number}} user - req.user (JWT payload with at least `id`)
 * @param {string} permissionKey - e.g. 'assignment.create'
 * @returns {boolean}
 */
export function hasPermission(user, permissionKey) {
  if (!user?.id) return false;
  const role = resolveUserRole(user.id);
  if (!role) return false; // no role_id resolved at all — fail closed

  const meta = getPermissionMeta.get(permissionKey);
  // admin_only permissions are hard-locked to system_admin in code — this is
  // the defense-in-depth backstop described in the architecture doc §12,
  // independent of whatever role_permissions/overrides happen to contain.
  if (meta?.admin_only) return role.role_key === 'system_admin';

  if (role.role_key === 'system_admin') return true;

  const override = getOverride.get(user.id, permissionKey);
  if (override) return override.effect === 'allow';

  const roleGrant = getRoleGrant.get(role.role_id, permissionKey);
  if (roleGrant) return roleGrant.effect === 'allow';

  return false;
}

/** Returns the full resolved permission set for a user, for the
 * GET /api/auth/me/permissions endpoint and the frontend PermissionContext. */
export function resolveAllPermissions(user) {
  const role = resolveUserRole(user.id);
  const allPerms = db.prepare('SELECT * FROM permissions').all();
  const result = {};
  for (const p of allPerms) {
    result[p.key] = hasPermission(user, p.key);
  }
  return { role, permissions: result };
}

/** Express middleware factory: requirePermission('assignment.create') */
export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permissionKey)) {
      return res.status(403).json({ error: `Missing permission: ${permissionKey}` });
    }
    next();
  };
}
