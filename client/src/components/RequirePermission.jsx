import { usePermissions } from '../context/PermissionContext.jsx';

/**
 * Renders children only if the current user holds `perm` (or, when `any` is
 * given, at least one of the listed permissions). Purely a UI convenience —
 * the real enforcement always happens server-side via requirePermission()
 * middleware; this component exists so pages don't have to sprinkle
 * `hasPermission(...)` ternaries everywhere.
 */
export default function RequirePermission({ perm, any, fallback = null, children }) {
  const { hasPermission, loading } = usePermissions();
  if (loading) return null;
  const allowed = any ? any.some(p => hasPermission(p)) : hasPermission(perm);
  return allowed ? children : fallback;
}
