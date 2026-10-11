# Phase 0 status: production hardening

Date: 2026-10-11. Plan: `docs/PRODUCTION_ROADMAP.md`, Phase 0.

**Phase 0 is NOT complete.** Its exit gate needs a live deployment, a restore on a second machine, and an OWASP ZAP scan. Those cannot be done in this sandbox. The code items are done and tested, except where the table below says otherwise.

## 1. Roadmap items

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | Session model: HttpOnly cookie, CSRF header, 15-minute access token, rotating refresh token, 30-day absolute maximum per sign-in, revocation on password change or disable | **Done** | `server/src/services/sessions.js`, `routes/auth.js`, `middleware/auth.js`, `client/src/api/client.js`. Tests: `session-lifecycle.test.js` (17), `phase0-hardening.test.js`. Browser: `e2e/session_e2e.py` (9 of 9), `e2e/refresh_e2e.py` (6 of 6). |
| 2 | Security headers: CSP, CORS allowlist, HSTS, Referrer-Policy | **Done** | `app.js` (helmet). Tests: `phase0-hardening.test.js`. HSTS `max-age=31536000; includeSubDomains`, Referrer-Policy `no-referrer`, CSP self-only with self-hosted fonts. |
| 3 | Password policy and lockout (10 failures lock for 15 minutes) | **Done** | `utils/passwordPolicy.js`, `routes/auth.js`. Tests: lockout at 9 and 10 failures, locked correct password returns 429, expiry unlocks, success clears the count, per-account, audited (`session-lifecycle.test.js`). |
| 4 | Remove student ads | **Done** | `AdSlot` removed from the student dashboard. Test checks the file and references are gone. |
| 5 | Gamification switch (off by default; under-13 excluded when on) | **Done** | `utils/gamification.js` (`gamificationEligible`), `routes/settings.js`, admin toggle in `AdminBranding.jsx`, `gamification_enabled` on `/auth/me` and login. Tests: `gamification-switch.test.js` (9). Off by default; missing date of birth is excluded. |
| 6 | Packaging: Dockerfile, compose file, `.env.example` | **Written, not built here** | Docker is not available in this sandbox. CI job must build the image. |
| 7 | CI pipeline: tests, client build, `npm audit`, `oxlint` | **Written, not run on GitHub** | `.github/workflows/ci.yml` is untracked. Pushing it needs a token with `workflow` scope. |
| 8 | Backups with a restore drill | **Partly** | Backup and restore scripts built and tested (`server/scripts/`). Drill on one machine: `docs/RESTORE_DRILL_LOG.md`. Not scheduled on a host, no off-site copy, no second-machine restore. Procedure: `docs/RESTORE_RUNBOOK.md`. |
| 9 | Logging and errors | **Partly** | In-app error log with redaction, counts, admin view (`services/errorLog.js`, `routes/ops.js`; tests: `error-tracking.test.js`, 6). Unhandled exceptions are recorded. Production log is still the combined access format, not JSON. No external error-tracking service, no uptime monitor, and no alert routing: those need a vendor choice. |
| 10 | Health check runs a database query | **Done** | `/api/health` returns 503 when the query fails. |
| 11 | Secrets and demo data: `SEED_DEMO` off in production; `JWT_SECRET` at least 32 characters | **Done in code; token rotation is the owner's action** | Demo seed is off in production (tested). A GitHub token pasted in chat was used for one push and must be revoked by its owner. |
| 12 | Self-hosted fonts (no Google Fonts; no visitor IP to Google) | **Done** | `client/src/fonts/fontLoaders.js`, `client/src/main.jsx`, `client/src/index.css`. Fontsource packages; admin-chosen fonts load as separate chunks. Noto Sans Devanagari is bundled for Nepali text. Test: CSP has no Google origin. Browser check: no CSP violations. |
| 13 | Threat model | **Done** | `docs/THREAT_MODEL.md` |
| 14 | OWASP ZAP baseline, no high findings | **Not met** | Needs a running staging deployment and Docker. |

## 2. Exit gate

| Requirement | State |
|---|---|
| All existing tests still pass | **Met.** Server suite: 198 of 198 (`npm test`, 16 files). |
| Token not readable from JavaScript; CSRF refused without header; CORS rejects unknown origin; CSP present; lockout after 10 failures; refresh revocation on password change | **Met** (tests above) |
| Docker image builds in CI; `docker run` serves health and the web app | **Not met.** Docker unavailable here. |
| One restore drill recorded, on a separate machine | **Not met.** One drill on one machine is recorded. |
| OWASP ZAP baseline with no high findings | **Not met.** Not run. |
| Ready for a pilot school with a signed agreement and privacy notice | **Not met.** Agreement and notice are not written; legal review is open. |

## 3. Verification at this point

| Check | Result |
|---|---|
| `npm test` (server) | 198 of 198 pass |
| Client production build (`vite build`) | Passes. No Google Fonts references in the build. 153 font files emitted. |
| Client lint (`oxlint src`) | 0 errors, 37 warnings (all pre-existing; 3 in `SettingsContext.jsx`) |
| Browser: login, cookie flags, CSRF refusal, CSP, logout (`e2e/session_e2e.py`) | 9 of 9 pass on a production-mode server |
| Browser: silent renewal with an expired access cookie (`e2e/refresh_e2e.py`) | 6 of 6 pass |
| Client refresh logic under a burst, login 401, refused refresh, and repeated 401 | 11 of 11 pass (mock transport, run once; not committed because the client has no test runner) |
| Restore drill (one machine) | Pass. See `RESTORE_DRILL_LOG.md`. |

## 4. Behaviour changes to tell users

- Sessions now renew every 15 minutes in the background. A browser left idle for 8 hours signs in again. Every sign-in ends after 30 days, whatever the activity. A user who is signed out elsewhere (password change) is signed out here too.
- Accounts lock for 15 minutes after 10 wrong passwords. The school office can tell users to wait.
- Student files are visible only to the people the record allows (see Phase 1, section 5, now fixed).
- XP and streaks are off unless the school turns them on in Branding settings.

## 5. Still open in Phase 0

| Item | Why | Owner |
|---|---|---|
| OWASP ZAP baseline | Needs staging and Docker | Engineering, once a staging host exists |
| Docker build in CI | Needs CI to run on GitHub (`workflow` scope) | Owner: push with a suitable token |
| Restore on a separate machine; scheduled backups; off-site copy | Needs a host and storage | Owner: choose hosting region and provider |
| External error tracking and uptime alerts | Needs a vendor choice (Sentry or equivalent; uptime service) | Owner: decide |
| JSON logs in production | Small change, not yet made | Engineering |
| Revoke the pasted GitHub token | Owner action | Owner |
