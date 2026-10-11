# NITEX — School LMS Platform

A Node/Express + SQLite backend with a React/Vite frontend, providing a Student
Portal and a Staff (Teacher/Admin) Console.

## Quick Start

### 1. Backend
```bash
cd server
npm install
npm run dev        # or: node src/index.js
```
The API runs on `http://localhost:4000`. On first boot with no existing
database file, it automatically creates and seeds `server/src/db/nitex.db`
with demo data (see credentials below). Uploaded files are written to
`server/src/uploads/` (created automatically at runtime).

### 2. Frontend
```bash
cd client
npm install
npm run dev
```
The app runs on `http://localhost:5173` (Vite dev server) and talks to the
API at `http://localhost:4000`.

### Demo credentials (seeded automatically in development only)
| Role    | Email                | Password      |
|---------|-----------------------|---------------|
| Admin   | admin@nitex.com       | Admin@123     |
| Teacher | teacher@nitex.com     | Teacher@123   |
| Student | student@nitex.com     | Student@123   |

To reseed from scratch, stop the server and delete
`server/src/db/nitex.db*`, then start the server again.

---

## Production deployment (environment variables)

Set these on your host. Never commit real values.

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | yes | `production` disables demo accounts and enforces the checks below |
| `JWT_SECRET` | yes in production | 32+ random characters used to sign login tokens |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first deploy | Creates the first admin when the database is empty (password 10+ chars) |
| `DB_PATH` | recommended | Absolute path to the SQLite file on a persistent disk |
| `TRUST_PROXY` | behind a proxy | `1` or `true`, so rate limits see real student IPs |
| `PORT` | optional | Defaults to `4000` |
| `SEED_DEMO` | optional | `true` creates the demo accounts even in production (not for real schools) |
| `ATTENDANCE_EDIT_WINDOW_DAYS` | optional | Days back a teacher may edit a register (default 7) |

Build and run (one process serves the API and the web app):

```bash
cd client && npm ci && npm run build
cd ../server && npm ci && NODE_ENV=production JWT_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node src/index.js
```

Tests: `cd server && npm test` (server, 259 tests) and the browser checks in `e2e/` (for example `python3 e2e/session_e2e.py`, `python3 e2e/refresh_e2e.py`) against a running server.

## Attendance (new)

- **Daily register** (Class Teacher, homeroom) and **subject register** (Subject Teacher, per class).
- Bulk marking for a whole class in one save; re-saving updates, never duplicates.
- Statuses: Present, Absent, Late, Excused, Half day, with optional remarks.
- Percentage = (present + late + excused + 0.5 × half day) ÷ days marked. Below 75% is flagged as at risk.
- Teachers can edit only the last 7 days; Academic Heads and Admins can correct older records. Every change is audited.
- Absent students get an in-app notification.
- Reports per class with CSV export. Students see their own overall and per-subject attendance.

## What's included

This build delivers the full requested scope across two work sessions:

### Foundations
- **Real Teacher role**, separate from Admin, with its own permission tier
  (`requireStaff` = teacher + admin) for day-to-day operations, while
  admin-only actions (branding, audit log, teacher account management,
  subject deletion) remain admin-gated.
- **Sitewide sticky footer fix** — the footer always sits at the bottom of
  the viewport on every page.
- **Reorganized Branding & Settings** — 6-tab interface (General / Theme /
  School Info / Localization / Homepage / Email & Notifications). The old
  "Footer & Contact" card was removed (a separate Footer/Contact module
  already exists elsewhere in the product).
- **Global Class/Subject/Section filters** — every staff academic module
  (Assignments, Quizzes, Manage Content, Announcements) uses a shared
  `<GlobalFilterBar/>` + `useModuleFilters()` hook, defaulting to
  **All Classes / All Sections / All Subjects**, with a personal default
  savable via **My Preferences**.
- **Enterprise Audit Log** (`/admin/audit-log`) — search, module/action
  filters, table + timeline views, CSV export, IP/user-agent/before-after
  diff per record.
- **Academic Sessions** admin page (create/activate school years).

### Application Review, Rejection & Reapplication Workflow
- Every registration becomes a permanent, versioned row in `applications`
  (v1, v2, v3...). **Rejected applications are never deleted.**
- Admin review actions: Approve / Reject (with a required reason + optional
  comments) from the **Registry** page (`/admin/registry`).
- **Reapply flow**: a rejected applicant sees a "Reapply" button right on the
  Login screen (they can't log in to reach an authenticated page, so a
  dedicated `POST /api/applications/reapply-public` endpoint re-verifies
  their email+password and creates the next version). Previous data and
  uploaded documents are copied forward; only edited fields change.
- **Admin Comparison View**: side-by-side diff between any two versions,
  highlighting changed fields and added/removed documents.
- **Full History view**: every version, its status, reviewer, reason, and
  timestamp, permanently available.

### Registry Module
- Default view shows only **Active/Valid** records (excludes rejected and
  archived). Dedicated filter tabs: Active/Valid, Pending, Approved,
  Rejected, Archived — rejected records only ever appear when explicitly
  filtered for.
- **Archive/Restore** accounts without deleting their application history.

### Assignment Management System (enterprise redesign)
- Creation with **Draft / Scheduled / Published / Archived** status,
  Duplicate, Edit, Delete.
- Fields: Title, Subject, Chapter, Class, Section, rich-text Description
  (sanitized both client- and server-side), Instructions, multiple
  Attachments, Reference Links, Due Date/Time, Max/Passing Marks, Late
  Submission + Penalty %, Allow Resubmission + max count, Allow Regrade
  Requests, allowed file types, max upload size.
- Student view: countdown timer, full status set (Draft, Not Started,
  Submitted, Under Review, Graded, Late, Missing, Resubmission Requested,
  Resubmitted, Regraded, Closed, Invalid), Save Draft, multi-file upload,
  submission version history (every version kept, never overwritten),
  feedback display, and a Regrade Request form.
- Teacher review: per-submission Grade / Save Draft Grade / Publish Grade,
  Request Resubmission (with a fixed reason list + optional new deadline),
  Mark Invalid, Mark Late, full version history viewer, full grade history.
- **Regrade workflow**: student submits a reason (+ optional attachment);
  teacher Approves (with a new grade) or Rejects; every grading event is
  permanently recorded in `grade_history`.
- **Analytics** (teacher): submission rate, missing students, late count,
  avg/high/low score, grade distribution, resubmission & regrade counts.
  **Analytics** (student): personal score vs class average, progress trend.

### Quiz Management System (enterprise redesign)
- **Question Bank** (`/admin/quizzes` → Question Bank) for reusable
  questions across quizzes.
- **13 question types**: MCQ (single), Multiple Choice (multi-select),
  True/False, Fill in the Blank, Short Answer, Essay, Numerical, Matching,
  Ordering, Code, Image/Audio/Video response.
- Shuffle Questions, Shuffle Answers, random question subset, configurable
  Max Attempts, Grading Strategy (highest/latest/average), Passing %.
- **Auto-save + Resume**: in-progress attempts are saved periodically and
  can be resumed later.
- **Auto-grading** for objective types; **manual grading UI** for
  essay/short-answer/media types, with automatic score recomputation.
- **Review Mode**: students can review their answers vs correct answers
  after submitting (if enabled per quiz).
- **Analytics**: participation %, average/pass rate, per-question difficulty
  statistics, weak-topic analysis across the subject.

### Security & Code Quality (this session)
- `helmet` security headers + `express-rate-limit` (general API + a tighter
  limit on auth endpoints).
- Assignment description HTML is sanitized both server-side
  (`sanitize-html`, allowlisted tags) and client-side (`DOMPurify`) before
  rendering.
- Upload file-type blocklist (blocks `.exe/.bat/.sh/.js/.jar/...` etc.
  regardless of an assignment's configured allowed types) plus per-assignment
  allowed-file-type and max-size enforcement on student submissions.
- All new tables/columns were added via additive, backward-compatible
  migrations in `server/src/db/index.js` — verified against both fresh and
  pre-existing (pre-redesign) databases; **no existing data is ever dropped**.

### Explicitly out of scope (by design)
- Live email/push notification delivery (in-app notifications are fully
  wired for every new event; SMTP fields exist in Settings but no live
  sending integration is included).
- Virus scanning hooks, IP geolocation, anti-cheat browser lockdown — not
  implemented (flagged as a follow-up integration step in earlier scoping).

## Project structure
```
server/            Node/Express + better-sqlite3 API
  src/db/          schema.sql, seed.js, index.js (schema + migrations)
  src/routes/      one file per resource — auth, users, applications, assignments,
                   quizzes, materials, subjects, announcements, settings,
                   notifications, audit
  src/middleware/  requireAuth / requireStaff / requireAdmin
  src/utils/       notify.js (in-app notifications), audit.js (audit logging),
                   gamification.js (XP/streaks)
client/            React 19 + Vite + React Router
  src/pages/       admin/ (staff console) and student/ (student portal)
  src/components/  shared UI (AppLayout, Sidebar, GlobalFilterBar, Modal, ...)
  src/context/     Auth / Settings / Toast / Gamification providers
  src/hooks/       useModuleFilters.js
```

## Notes
- Uploaded files are written to `server/src/uploads/` (not included in this
  archive — the folder is created automatically at runtime).
- The SQLite database file is not included in this archive; it is generated
  and seeded automatically the first time the server starts.
- If you have an existing `nitex.db` from an earlier version of this project,
  just drop it into `server/src/db/` before starting the server — the app
  will automatically run the necessary schema migrations (including a safe
  table-rebuild for the `teacher` role and the expanded assignment/quiz
  status values) without losing any existing data.

## Phase 0 deployment notes

- Sessions use an HttpOnly cookie that lasts 15 minutes and renews itself in the background with a refresh cookie. A browser left idle for 8 hours must sign in again. Every sign-in ends after 30 days at most (set `SESSION_MAX_DAYS` to change it). Admin password resets, disabling and archiving end a user's sessions immediately.
- Accounts lock for 15 minutes after 10 wrong passwords.
- Student files open only for the people their records allow. Admins can open any file.
- XP and streaks are off by default. Turn them on in Branding settings; only students aged 13 or older earn them.
- Fonts are served from the app itself. No request goes to Google.
- Backups: `cd server && node scripts/backup.js`. Restore: `node scripts/restore.js <archive> --db <path> --uploads <dir>`. See `docs/RESTORE_RUNBOOK.md`. Set `UPLOADS_DIR` and `BACKUP_DIR` for production.
- Errors are recorded in-app and listed at `GET /api/ops/errors` for admins.
- The API accepts no cross-origin browser calls by default. To allow another site, set `CORS_ORIGINS` (comma-separated).
- Passwords need at least 12 characters.
- Docker: `docker compose up --build` after copying `.env.example` to `.env`.
- Health check: `GET /api/health` (returns 503 if the database is unreachable).
