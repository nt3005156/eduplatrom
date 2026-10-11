import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('nitex_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('nitex_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then(({ data }) => {
      setUser(data.user);
      localStorage.setItem('nitex_user', JSON.stringify(data.user));
    }).catch(() => {
      localStorage.removeItem('nitex_token');
      localStorage.removeItem('nitex_user');
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('nitex_token', data.token);
    localStorage.setItem('nitex_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  // Registration no longer logs the student in immediately — new accounts
  // start in "pending" status until an admin approves them.
  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    return data; // { pending: true, user }
  };

  const logout = () => {
    // Best-effort audit log of the logout event; never block clearing local session on it.
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('nitex_token');
    localStorage.removeItem('nitex_user');
    setUser(null);
  };

  /** Merge a partial user update (e.g. new xp/streak after an action) into local state + storage. */
  const updateUser = (partial) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      localStorage.setItem('nitex_user', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
