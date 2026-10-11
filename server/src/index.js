import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// Security headers. CSP/COEP disabled: this is an API + separately-served SPA,
// not a server-rendered HTML app, so a strict default CSP would only get in
// the way without providing meaningful protection here.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// General API rate limit — generous enough for normal interactive use, but
// blocks brute-force / scripted abuse.
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));

// Tighter limit specifically on auth endpoints (login/register) to slow down
// credential-stuffing / brute-force attempts.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, please try again later.' } });

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'NITEX API' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/academic-head', academicHeadRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  // Multer (file upload) validation errors and our own fileFilter rejections carry a
  // human-readable message that's safe to show the user (e.g. "file type not allowed",
  // "file too large") — surface those directly instead of a generic 500.
  if (err?.name === 'MulterError' || /file type|not allowed|too large/i.test(err?.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`NITEX API running on http://localhost:${PORT}`);
});
