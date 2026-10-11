import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const PermissionContext = createContext(null);

/**
 * Fetches the current user's resolved permission set + scope summary once
 * after login (and again on-demand via refresh()), and exposes hasPermission()
 * so the rest of the app can gate UI on real backend-resolved permissions
 * instead of re-implementing role checks client-side. The server is always
 * the source of truth — this context never grants access on its own, it only
 * hides/shows UI; every underlying API call is independently permission- and
 * scope-checked server-side (see server/src/services/permissions.js, scope.js).
 */
export function PermissionProvider({ children }) {
  const { user } = useAuth();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) { setRole(null); setPermissions({}); setScope(null); setLoading(false); return; }
    setLoading(true);
    api.get('/auth/me/permissions').then(({ data }) => {
      setRole(data.role);
      setPermissions(data.permissions || {});
      setScope(data.scope);
    }).catch(() => {
      // Fail closed on the client too: if we can't resolve permissions,
      // show nothing rather than falling back to "show everything."
      setRole(null); setPermissions({}); setScope(null);
    }).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const hasPermission = (key) => !!permissions[key];

  // The exact list of class levels this user may ever select in a Class
  // dropdown (assignment/quiz/content creation, filters). null/undefined
  // scope.allowedClassLevels means "every class is selectable" (unrestricted
  // role); otherwise this is the precise, backend-computed list derived from
  // teacher_assignments — never hardcoded on the client.
  const ALL_CLASSES = [6, 7, 8, 9, 10, 11, 12];
  const allowedClasses = scope?.unrestricted || !scope?.allowedClassLevels
    ? ALL_CLASSES
    : ALL_CLASSES.filter(c => scope.allowedClassLevels.includes(c));

  return (
    <PermissionContext.Provider value={{ role, permissions, scope, allowedClasses, loading, hasPermission, refresh: load }}>
      {children}
    </PermissionContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionContext);
