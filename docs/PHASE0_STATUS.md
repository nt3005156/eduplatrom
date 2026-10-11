# Phase 0 status: production hardening

Date: 2026-10-11. Source of the plan: `docs/PRODUCTION_ROADMAP.md`, Phase 0.

## Done and tested

| Gap | Change | Evidence |
|---|---|---|
| G1 Token in localStorage | Session is now an HttpOnly, SameSite=Lax, Secure cookie (`nitex_session`). The web app no longer stores or reads the token. | `server/test/phase0-hardening.test.js`; `e2e/session_e2e.py` (no `nitex_token` in localStorage, cookie flags checked) |
| G4 7-day tokens, no revocation | Sessions last 8 hours. Each user has a `session_version` counter. Password reset, disable, archive, and anonymize bump it, which ends all of that user's sessions at once. | Tests: reset ends an open session; disabled user loses an open session; a login right after a reset still works (repeated 4x, stable) |
| CSRF (new surface from cookies) | Cookie-authenticated writes must send `X-NITEX-Client: web`. Cross-site pages cannot send it without a CORS preflight, and the API allows none. | Test and browser check: write without the header gets 403 |
| G2 CSP disabled | Strict CSP: scripts from the same origin only, no `unsafe-eval`, object-src none, frame-ancestors self. Google Fonts allowed for styles and fonts. | Test on headers; browser check: no violations on normal pages; a deliberate foreign request is blocked |
| G3 CORS open to all | CORS off by default. Origins listed in `CORS_ORIGINS` get headers. | Test: unlisted origin gets no header; listed origin does |
| G5 Weak passwords | Minimum 12 characters and a short common-password list, in one module (`utils/passwordPolicy.js`). Admin-chosen short passwords are refused, not silently replaced. | Test |
| G6 Ads for students | `AdSlot` deleted, removed from the student dashboard. | Test checks the file is gone and not referenced |
| G8 Packaging | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml` | `ci.yml` parses. Docker is not available in this sandbox, so the image is NOT built here. CI must build it. |
| G10 Logs | Production uses the combined access-log format | Code review |
| G11 Health | `/api/health` runs a database query and returns 503 if it fails | Test |
| Dependencies | Server and client production audits: 9 and 4 known vulnerabilities before, 0 after (non-breaking fixes) | `npm audit --omit=dev` clean on both |

Test results at this commit: 40 server tests pass (26 existing + 14 new), stable across 4 repeat runs. Client production build passes. Client lint: 0 errors, 37 warnings (down from 38).

Browser check (`e2e/session_e2e.py`) against a production-mode server with the built client: 9 of 9 checks pass. Screenshot confirms the admin dashboard renders.

## Behaviour change to tell users

Everyone signs in once after this upgrade. Tokens issued before the `session_version` claim are refused on purpose.

## Still open in Phase 0

| Item | Why it is open | Plan |
|---|---|---|
| Refresh tokens with 15–30 minute access tokens | 8-hour sessions with revocation cover the pilot. Rotation is more work and adds risk. | Next Phase 0 pass |
| Fonts are loaded from Google | Each page view sends the visitor's IP to Google. This matters for minors' data in the EU. | Self-host the fonts (Phase 8 privacy work) |
| Gamification off by default for pilots | Needs a per-school setting. Not built yet. | Per-school flag, next pass |
| Restore drill and backups | Needs a deployment target and object storage | Set up on the host, then run a restore drill |
| Error tracking (Sentry or similar) | Needs an account and a DSN | Set up on the host |
| OWASP ZAP scan | Needs a running staging deployment | Run against staging |
| Docker image build | Docker unavailable here | CI job `image` builds it on every push |
| Push to GitHub | No GitHub credentials stored in this environment | See below |

## Push

The commits are local. Push from your machine, or give a fresh token with `contents: write` and `workflow` scopes (the CI workflow file needs `workflow` to be pushed).
