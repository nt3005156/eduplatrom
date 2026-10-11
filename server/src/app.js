// Express application factory. Kept separate from the listen() call in
// index.js so the test suite can import the app without binding a port.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import './db/index.js';
import './db/seed.js';

import authRoutes from './routes/auth.js';
import subjectRoutes from './routes/subjects.js';
import materialRoutes from './routes/materials.js';
import assignmentRoutes from './routes/assignments.js';
import quizRoutes from './routes/quizzes.js';
import dashboardRoutes from './routes/dashboard.js';
import announcementRoutes from './routes/announcements.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import applicationRoutes from './routes/applications.js';
import teacherRoutes from './routes/teachers.js';
import coordinatorRoutes from './routes/coordinator.js';
import rolesRoutes from './routes/roles.js';
import permissionsRoutes from './routes/permissions.js';
import academicHeadRoutes from './routes/academicHead.js';
import attendanceRoutes from './routes/attendance.js';
import privacyRoutes from './routes/privacy.js';
import { adminRouter as guardianAdminRoutes, portalRouter as guardianPortalRoutes } from './routes/guardians.js';
import messageRoutes from './routes/messages.js';
import studentImportRoutes from './routes/studentImport.js';
import opsRoutes from './routes/ops.js';
import studentPhotoRoutes from './routes/studentPhotos.js';
import { feesRouter, feesPortalRouter } from './routes/fees.js';
import { examsRouter, examsPortalRouter } from './routes/exams.js';
import { captureError } from './services/errorLog.js';
import { requireFileAccess } from './middleware/auth.js';
import db from './db/index.js';
import { UPLOADS_DIR } from './config/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

export function createApp() {
  const app = express();

  // When deployed behind a reverse proxy / load balancer (Nginx, Render,
  // Cloudflare, etc.) the client IP arrives in X-Forwarded-For. Without this,
  // every student would share one rate-limit bucket. Set TRUST_PROXY=1 (or
  // "true") in production when a proxy sits in front of the app.
  if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set('trust proxy', v === 'true' ? true : Number.isNaN(Number(v)) ? v : Number(v));
  }

  // Security headers. The policy lists exactly what the app loads: its own
  // scripts, styles and fonts. Fonts are self-hosted in the Vite build, so no third-party origin is needed.
  // No inline scripts and no eval; the Vite build emits none.
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  }));
  // CORS is off by default: the web app is served from the same origin, so no
  // other website may call the API from a browser. Only origins listed in
  // CORS_ORIGINS (comma-separated) receive CORS headers.
  const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors(corsOrigins.length ? { origin: corsOrigins, credentials: true } : { origin: false }));
  // Production logs use the standard combined format, not the developer format.
  if (process.env.NODE_ENV !== 'test') app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '2mb' }));
  // Files: public only under uploads/public (branding). Everything else needs
  // a signed-in user (HttpOnly cookie for browser links, or a Bearer token).
  app.use('/uploads/public', express.static(path.join(UPLOADS_DIR, 'public'), { dotfiles: 'deny', index: false, maxAge: '1d' }));
  app.use('/uploads', (req, res, next) => {
    // Logos uploaded before the public folder existed keep working on the login page.
    if (/^\/brand-[\w.-]+$/.test(req.path)) return next();
    return requireFileAccess(req, res, next);
  }, express.static(UPLOADS_DIR, { dotfiles: 'deny', index: false }));
  // Missing or rejected files stop here, so they never fall through to the web app shell.
  app.use('/uploads', (req, res) => res.status(404).json({ error: 'File not found' }));

  // General API rate limit. Per IP, so a school whose staff share one office connection needs headroom.
  const API_LIMIT = Number(process.env.API_RATE_LIMIT_PER_15MIN || 2000);
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: API_LIMIT, standardHeaders: true, legacyHeaders: false }));

  // Sign-in limits count only FAILED attempts (successful sign-ins never count). Two layers:
  //  - per IP and email: 20 wrong passwords for one account from one connection;
  //  - per IP: a ceiling for guessing across many accounts. Higher, so a shared NAT does not lock out a whole school.
  // Refresh, /me, logout and permissions are not limited here; they are session calls, and the general limit covers them.
  const authMsg = { error: 'Too many attempts, please try again later.' };
  const loginFailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: authMsg,
    keyGenerator: req => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').trim().toLowerCase()}`,
  });
  const loginIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_IP_FAIL_LIMIT || 300), standardHeaders: true, legacyHeaders: false,
    skipSuccessfulRequests: true, message: authMsg, keyGenerator: req => ipKeyGenerator(req.ip),
  });
  app.post('/api/auth/login', loginIpLimiter, loginFailLimiter);
  app.post('/api/auth/setup', loginIpLimiter, loginFailLimiter);

  // Health check for the load balancer and uptime monitor. It runs a real query,
  // so a broken database returns 503 instead of a false "ok".
  app.get('/api/health', (req, res) => {
    let dbOk = false;
    try { db.prepare('SELECT 1').get(); dbOk = true; } catch { dbOk = false; }
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk, name: 'NITEX API', uptime_s: Math.round(process.uptime()) });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/subjects', subjectRoutes);
  app.use('/api/materials', materialRoutes);
  app.use('/api/assignments', assignmentRoutes);
  app.use('/api/quizzes', quizRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/users', studentPhotoRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/teachers', teacherRoutes);
  app.use('/api/coordinator', coordinatorRoutes);
  app.use('/api/roles', rolesRoutes);
  app.use('/api/permissions', permissionsRoutes);
  app.use('/api/academic-head', academicHeadRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/privacy', privacyRoutes);
  app.use('/api/guardians', guardianAdminRoutes);
  app.use('/api/guardian', guardianPortalRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/student-import', studentImportRoutes);
  app.use('/api/ops', opsRoutes);
  app.use('/api/fees', feesRouter);
  app.use('/api/guardian', feesPortalRouter);
  app.use('/api/exams', examsRouter);
  app.use('/api/guardian', examsPortalRouter);

  // Unknown API paths must return JSON 404, not the SPA shell.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built React app (client/dist) from the same origin, so the
  // browser's relative /api calls work in production with no proxy config.
  if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    if (process.env.NODE_ENV !== 'test') console.error(err);
    const status = err?.status || err?.statusCode || 500;
    if (status >= 500) captureError(err, { route: `${req.method} ${req.route?.path || req.path.split('/').slice(0, 4).join('/')}`, status });
    // Multer / our own upload validation errors carry a user-safe message.
    if (err?.name === 'MulterError' || /file type|not allowed|too large/i.test(err?.message || '')) {
      return res.status(400).json({ error: err.message });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
