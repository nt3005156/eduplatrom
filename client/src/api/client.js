import axios from 'axios';

// The session is an HttpOnly cookie set by the server. The page never reads or
// stores the token. The custom header marks requests as coming from this app,
// which the server requires for cookie-authenticated writes (CSRF defence).
const api = axios.create({
  baseURL: '/api',
  headers: { 'X-NITEX-Client': 'web' },
});

// Access tokens last 15 minutes. When one expires, renew it once with the refresh cookie and retry the request.
// Concurrent requests share one renewal, so a burst of 401s causes one refresh call, not many.
let renewing = null;
function renewSession() {
  if (!renewing) {
    renewing = api.post('/auth/refresh', {}).finally(() => { renewing = null; });
  }
  return renewing;
}

const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/setup'];

function endSession() {
  localStorage.removeItem('nitex_user');
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config || {};
    const isUnauthorized = err.response?.status === 401;
    const isAuthCall = AUTH_PATHS.some(p => String(cfg.url || '').includes(p));
    if (isUnauthorized && !cfg._retried && !isAuthCall) {
      try {
        await renewSession();
        return api.request({ ...cfg, _retried: true });
      } catch {
        // The refresh was refused (signed out elsewhere, password changed, account disabled). Fall through.
      }
    }
    if (isUnauthorized) endSession();
    return Promise.reject(err);
  }
);

export default api;
