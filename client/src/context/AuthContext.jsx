import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';
import { applyLanguage } from '../i18n/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('nitex_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Tokens saved by older builds are no longer used. Remove them.
    localStorage.removeItem('nitex_token');
    // The session cookie is checked by the server. A stored profile alone proves nothing.
    if (!localStorage.getItem('nitex_user')) { setLoading(false); return; }
    api.get('/auth/me').then(({ data }) => {
      setUser(data.user);
      localStorage.setItem('nitex_user', JSON.stringify(data.user));
      // A saved account language overrides this device's choice. An unset value keeps the device choice.
      if (data.user?.language) applyLanguage(data.user.language);
    }).catch(() => {
      localStorage.removeItem('nitex_user');
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('nitex_user', JSON.stringify(data.user));
    setUser(data.user);
    if (data.user?.language) applyLanguage(data.user.language);
    return data.user;
  };

  // Registration no longer logs the student in immediately — new accounts
  // start in "pending" status until an admin approves them.
  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    return data; // { pending: true, user }
  };

  const logout = async () => {
    // The server clears the session cookie and writes the audit entry. Local state is cleared even if the call fails.
    await api.post('/auth/logout').catch(() => {});
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
