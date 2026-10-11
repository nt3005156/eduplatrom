# NITEX threat model

Status: written 2026-10-11, Phase 0. Covers the system as it runs today: one Express server, one SQLite database, local `uploads/` folder, one React web app. It is a working model for the pilot, not a certification. It must be reviewed when the tenancy model (database per school, Phase 7), storage (Phase 9), or payments (Phase 3) change.

What is not done: the OWASP ZAP baseline scan has **not** been run. It needs a running staging deployment and Docker, neither of which this sandbox has. The scan is required by the Phase 0 exit gate and is listed as not met in `docs/PHASE0_STATUS.md`.

## 1. What we protect

| Asset | Why it matters | Where it lives |
|---|---|---|
| Student records (name, class, date of birth, admission and roll numbers, contact details, emergency contacts) | Personal data of minors. Breach has legal and reputational cost. | `users`, `student` fields in `server/src/db/schema.sql` |
| Guardian links and guardian contact details | Who may see a child's data. Wrong link = a stranger sees a child. | `guardian_students`, `users` |
| Academic records (assignments, submissions, quiz scores, attendance) | Integrity of grades and reports. | `submissions`, `quiz_attempts`, `attendance_*` |
| Uploaded files (materials, submissions, application documents, photos) | Often more sensitive than the database rows that point at them. | `server/src/uploads/` (default) or `UPLOADS_DIR` |
| Credentials and session state | Account takeover. | `users.password_hash`, `refresh_tokens` (hashed), `JWT_SECRET` |
| Parent-alert outbox (phone numbers, message text, child's name) | Personal data sent to third parties. | `message_outbox` |
| Audit log | Evidence for disputes and for regulators. | `audit_logs` |
| Provider credentials (SMS, WhatsApp, SMTP) | Could send messages as the school. | environment variables only |

## 2. Who can attack, and how

| Actor | Capability assumed | Examples |
|---|---|---|
| Anonymous internet user | Can reach every public route | Login page, public branding files, health check |
| Signed-in student | Holds a valid account of their own | Tries to read another class's files, change grades |
| Signed-in guardian | Holds an account linked to one or more children | Tries to reach another family's data or school files |
| Teacher or staff | Holds an account with scoped permissions | Tries to read files outside their assignments |
| Admin | Full access inside one school | Misuse, or a compromised admin account |
| Other website | Can make a visitor's browser send requests | Cross-site request forgery, data exfiltration through injected scripts |
| Compromised dependency | Runs code inside the build or server | Malicious npm package |
| Operator or insider with server access | Can read the database file and the uploads folder | Backup copies left in the wrong place |

## 3. Trust boundaries

1. **Browser to API.** Session in an HttpOnly cookie; writes need the `X-NITEX-Client` header (CSRF defence); CORS allowlist; strict CSP.
2. **Browser to uploads.** Files are served by the API, never directly; each read is checked against the record that owns the file (`server/src/services/fileAccess.js`).
3. **API to database.** Parameterised queries (better-sqlite3 prepared statements). The database file is not reachable over the network.
4. **API to providers** (Sparrow SMS, WhatsApp Cloud API, SMTP). Outbound only, credentials from environment variables, provider responses treated as untrusted data.
5. **Build to production.** Docker image built from the repository; CI runs tests and audits. Image build is not yet verified here (no Docker).

## 4. Threats, controls, and status

Status key: **Built** (in code with a test or check), **Partly** (in code, with a gap), **Open** (not in code).

### 4.1 Spoofing and session

| Threat | Control | Where | Status |
|---|---|---|---|
| Stolen token read by injected script | Token is an HttpOnly cookie. The web app never reads a token. | `server/src/middleware/auth.js`; `e2e/session_e2e.py` checks no token in `localStorage` | Built |
| Stolen access token used for a long time | Access token lasts 15 minutes. Renewal uses a refresh cookie (`Path=/api/auth`). | `auth.js`, `routes/auth.js` (`/refresh`), `client/src/api/client.js` | Built; browser-tested (`e2e/refresh_e2e.py`) |
| Replayed refresh token | Refresh tokens rotate on every use. Reuse after the 30-second grace window ends the whole family. Only a SHA-256 hash is stored. | `server/src/services/sessions.js` | Built; tests in `session-lifecycle.test.js` |
| Session kept alive indefinitely by renewal | Absolute maximum of 30 days per sign-in (`SESSION_MAX_DAYS`); after that the family ends and the user signs in again. An idle browser loses its session after 8 hours. | `sessions.js` `SESSION_MAX_SECONDS` | Built; tested |
| Two tabs refreshing at the same moment log the user out | 30-second grace window: a near-simultaneous reuse is refused without ending the session. | `sessions.js` | Built; tested |
| Old sessions survive a password change or account disable | Password reset, disable, archive, and anonymize revoke all access and refresh tokens. | `auth.js` `revokeSessions`, `sessions.js` `revokeAllRefreshTokens` | Built; tested |
| Password guessing | 10 failed logins lock the account for 15 minutes; the correct password is refused during the lock. The lock is per account and is audited. Also a per-IP limit (50 per 15 minutes on auth routes). | `routes/auth.js`, `app.js` | Built; tested |
| Weak passwords | At least 12 characters; common-password list. | `utils/passwordPolicy.js` | Built; tested |
| Distributed guessing across many accounts | Only the per-IP limit applies. | `app.js` | Partly: no CAPTCHA or device signal yet |

### 4.2 Tampering and cross-site attacks

| Threat | Control | Where | Status |
|---|---|---|---|
| Cross-site form or script changes data using the visitor's cookie | Cookie-authenticated writes must send `X-NITEX-Client: web`. Cross-site pages cannot add it without a CORS preflight, which is not allowed. | `app.js`, `phase0-hardening.test.js` | Built; tested and browser-checked |
| Injected script loads code from elsewhere | CSP: scripts from the same origin only, no `unsafe-eval`, `object-src 'none'`. | `app.js` (helmet) | Built; tested. Styles still allow `'unsafe-inline'` for React inline styles. |
| Third-party script or font leaks visitor IP | Fonts are self-hosted (Fontsource). Google Fonts removed from the CSP. | `client/src/fonts/fontLoaders.js`, `client/src/main.jsx` | Built; tested |
| Clickjacking | `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`. | helmet | Built |
| Another website reads API responses | CORS allowlist from `CORS_ORIGINS`; off by default. | `app.js` | Built; tested |
| Malformed or oversized request | JSON body capped at 2 MB; uploads capped per route. | `app.js`, route files | Built |
| Dependency with a known flaw | `npm audit` in CI; server and client audits clean for production dependencies at the last check. | `.github/workflows/ci.yml` | Partly: CI not yet run on GitHub (push needs a `workflow`-scope token) |

### 4.3 Information disclosure

| Threat | Control | Where | Status |
|---|---|---|---|
| Student opens another class's file by guessing its path | Every file read is checked against the record that owns it: class, section, subject, owner, or assignment. A file no record refers to is admin-only. Denied and missing files give the same 404, so names are not revealed. | `server/src/services/fileAccess.js`, `middleware/auth.js` | Built; `uploads-ownership.test.js` (11 tests) |
| Path traversal to other files | Names with `/`, `\`, `..`, or a leading dot are refused before any lookup. | `fileAccess.js`, `path-traversal` test | Built; tested |
| Upload is something other than an image (for example HTML served as a photo) | Photos are checked by their leading bytes (JPEG, PNG, WebP only), capped at 2 MB, and stored under random names. | `server/src/routes/studentPhotos.js` | Built; tested |
| Guardian sees another family's child or school files | Guardians have no file access at all. Data access is limited to linked children. | `auth.js`, `guardian-isolation.test.js` | Built; tested |
| Personal data in logs | Error log stores a redacted message (email, token, and password-like values removed), the route, and a count. It never stores request bodies, headers, or cookies. Production access log uses the combined format, which records paths and IPs. | `server/src/services/errorLog.js` | Built; tested. Access-log retention is not yet set. |
| Admin or staff reads a student's whole record without need | Permission checks per route. No field-level minimisation yet. | `services/permissions.js` | Partly |
| Backup copies leak data | Backups hold personal data. The backup folder is git-ignored. Encryption at rest and off-site storage are not set up. | `server/scripts/backup.js`, `docs/RESTORE_RUNBOOK.md` | Partly: encryption and access control of the backup host are open |
| Stack traces shown to users | Unhandled errors return a generic 500 message. | `app.js` error handler | Built |
| Public branding folder exposes a private file | Only `uploads/public` and legacy `brand-*` files are unauthenticated, and branding is meant to be public. | `app.js` | Built; tested |

### 4.4 Denial of service and availability

| Threat | Control | Where | Status |
|---|---|---|---|
| Request flood | Rate limits: 600 requests per 15 minutes per IP on `/api`; 50 per 15 minutes on auth. | `app.js` | Built. Limits are per IP and do not stop distributed traffic. |
| Bulk import locks the system | Import validates every row first and writes all-or-nothing; 500-row import is tested to finish in under 5 seconds. Maximum 2,000 rows. | `routes/studentImport.js`, `student-import.test.js` | Built; tested |
| Database loss | Daily backup script with integrity check and hash manifest; restore script verifies the hash before writing. A drill was run on 2026-10-11 on one machine. | `server/scripts/`, `docs/RESTORE_DRILL_LOG.md` | Partly: no off-site copy, no schedule on a real host, drill not repeated on a separate machine |
| Outage not noticed | `/api/health` runs a database query and returns 503 on failure. No external uptime monitor is configured. | `app.js` | Partly |
| Failing requests not noticed | In-app error log with counts; admin endpoint `/api/ops/errors`. No external alerting. | `services/errorLog.js`, `routes/ops.js` | Partly |
| Disk full or corrupted file | Backups as above. WAL mode with `VACUUM INTO` backups. | `db/index.js`, `scripts/backup.js` | Partly |

### 4.5 Elevation of privilege

| Threat | Control | Where | Status |
|---|---|---|---|
| Student changes another student's photo or record | Photo changes: the student themselves or an admin only. | `studentPhotos.js` | Built; tested |
| Teacher opens admission documents | Application documents: the applicant, academic head, coordinator. | `fileAccess.js` | Built; tested |
| Role is changed in the token | Role and scope are re-read from the database on file reads. Sessions carry a version number that changes on password reset. | `fileAccess.js`, `auth.js` `sessionIsCurrent` | Built |
| Admin-only actions done by others | `requireAdmin`, and an admin-only permission backstop in code. | `middleware/auth.js`, `services/permissions.js` | Built |
| Gamification shows XP to under-13s | Off by default. When on, only students aged 13 or older (by date of birth) earn XP; missing date of birth is excluded. | `utils/gamification.js` | Built; tested |

### 4.6 Repudiation

| Threat | Control | Where | Status |
|---|---|---|---|
| Admin denies changing a record | Audit log for privacy actions, photo changes, lockouts, imports (one summary entry per import), logins. | `utils/audit.js`, `audit_logs` | Built |
| Audit log altered | Audit rows are inserted by the app; no edit endpoint. Tamper-evidence (hash chain) is not built. | `utils/audit.js` | Partly |

## 5. Known gaps that matter before a pilot

1. **OWASP ZAP baseline not run.** Needs staging and Docker. Exit gate not met.
2. **Backups are not off-site.** The drill used one machine. A real pilot needs a copy on another host, with encryption, and a restore on a separate machine.
3. **External alerting and uptime monitoring.** Needs a chosen provider (Sentry or equivalent; UptimeRobot or equivalent). Choice is open.
4. **Access-log retention** for the server log (personal data in IPs and paths). Not set.
5. **Provider secrets.** Pasted GitHub tokens must be revoked by the owner. Provider credentials must be kept in the host's secret store, never in the repository.
6. **Nepal and international data-protection review.** Legal counsel has not reviewed the processing. See the roadmap, open decision 8.

## 6. Review schedule

- Before every pilot school goes live.
- When any of these change: tenancy (Phase 7), storage (Phase 9), payments (Phase 3), a new role, or a new file type.
- At least once a year after launch, and after any incident.
