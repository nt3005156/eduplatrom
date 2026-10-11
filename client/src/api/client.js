import axios from 'axios';

// The session is an HttpOnly cookie set by the server. The page never reads or
// stores the token. The custom header marks requests as coming from this app,
// which the server requires for cookie-authenticated writes (CSRF defence).
const api = axios.create({
  baseURL: '/api',
  headers: { 'X-NITEX-Client': 'web' },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('nitex_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
