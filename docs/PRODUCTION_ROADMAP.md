# NITEX: Production Roadmap (Phase 0 to Production-Ready)

Date: 2026-10-11. Scope: make NITEX production-ready and sell it to Nepali and international schools, with a target of **USD 10M per year** (USD 1 crore).

This is a plan, not a promise. Revenue depends on sales, pricing, and customers that do not exist yet. Effort figures are planning estimates, not commitments.

---

## 0. Read this first

### 0.1 What the target means

| Unit | Value |
|---|---|
| Target | USD 10,000,000 per year |
| In NPR at 140 per USD (assumption carried from `GO_TO_MARKET_PLAN.md`) | about NPR 1.4 billion, or **NPR 140 crore** |
| Previous plan in `GO_TO_MARKET_PLAN.md` | NPR 1 crore, about USD 70k (**about 1/143 of this target**) |

The earlier go-to-market document was written for NPR 1 crore. This roadmap replaces that target. The NPR 1 crore plan is still valid as a first-revenue milestone.

### 0.2 How many customers USD 10M needs

| Model | Price | Customers needed |
|---|---|---|
| School plan, mid-market | USD 1,188 per school per year (about USD 99/month) | **about 8,420 schools** |
| School plan, premium | USD 3,000 per school per year | **about 3,333 schools** |
| Per student | USD 5 per student per year | **about 2,000,000 students** |
| Per student | USD 10 per student per year | **about 1,000,000 students** |
| Nepal only at NPR 60,000 per school per year (about USD 430) | | **about 23,300 schools** |

**Nepal alone cannot reach the target at the old price.** Nepal has 8,941 institutional (private) schools ([Kathmandu Post, Economic Survey 2025-26](https://kathmandupost.com/national/2026/05/28/economic-survey-shows-falling-enrollment-in-community-schools-and-rapid-growth-in-public-health-facilities)). At USD 1,188 each, 100% of them would give about **USD 10.6M**. A realistic share of 10% gives about **USD 1.1M**. This is why the plan needs international customers, premium pricing, and add-on revenue.

### 0.3 Blended scenario (one of several possible)

| Segment | Customers | Price per year (USD) | Revenue (USD) |
|---|---|---|---|
| Nepal private schools | 1,000 | 1,188 | 1.19M |
| International small and mid-size schools | 2,000 | 1,200 | 2.40M |
| International premium schools or groups | 1,000 | 3,000 | 3.00M |
| **Subscription subtotal** | 4,000 | | **6.59M** |
| Add-ons still to be validated: payment processing margin, SMS and WhatsApp, setup and training, premium modules | | | about 3.4M needed |

The add-on line is the least certain part. Its rates have not been tested with any customer. The plan treats it as an assumption to validate in Phase 3 and Phase 8.

### 0.4 Illustrative ramp (not a forecast)

| Year | ARR target (USD) | Gate that must be passed |
|---|---|---|
| Year 1 | about 0.15M | Phase 0 to 3 complete. Paying Nepali pilots |
| Year 2 | about 1.2M | Phase 4 to 7 complete. Multi-tenant. First international pilots |
| Year 3 | about 3.5M | Phase 8 complete. International GA |
| Year 4 | about 7M | Phase 9 and 10 complete. SOC 2 Type II in progress |
| Year 5 | about 10M | Scale proven. Enterprise and district contracts |

These figures are illustrative. Each year's number depends on closing rate, churn, and pricing that have not been tested yet.

### 0.5 Corrections to earlier documents

- **Dockerfile:** an earlier note said one existed. The repo has **no Dockerfile, no CI config, and no `.env.example`**. Phase 0 creates them.
- **Fees and payments:** `GO_TO_MARKET_PLAN.md` ranks fee management as the top revenue lever. This roadmap keeps that ranking.
- **Demo accounts:** `README.md` says demo accounts are created only in development. `server/src/db/seed.js` enforces this, and a test covers it.

---

## 1. Current system baseline (verified)

Verified by reading the repo at commit `8fa0a90`.

| Area | What exists | Evidence |
|---|---|---|
| Backend | Express 5 API, `better-sqlite3` (synchronous SQLite), single process | `server/package.json`, `server/src/index.js` |
| Frontend | React 19, Vite, Recharts, single build served by the API | `client/package.json`, `server/src/app.js` (serves `CLIENT_DIST`) |
| Data | 38 tables in `schema.sql`, WAL mode, foreign keys on | `server/src/db/schema.sql`, `server/src/db/index.js` lines 13–14 |
| Roles and permissions | RBAC with 6 roles, 25 permissions, scope, overrides, audit | `server/src/services/permissions.js`, `scope.js`, `db/seedRbac.js` |
| Attendance | Daily and subject registers, edit window, absence notifications, reports, CSV export | `server/src/routes/attendance.js`, `server/test/attendance.test.js` |
| Academic work | Assignments with rubrics, versions, resubmission, regrade; quizzes; question banks; materials | `routes/assignments.js` (24 routes), `routes/quizzes.js` (31 routes) |
| Communication | Announcements; in-app notifications only | `routes/announcements.js`, `utils/notify.js` (inserts into `notifications` table) |
| Admissions | Online applications with documents | `routes/applications.js` |
| Privacy | Self and admin data export; erasure with confirmation; audit | `routes/privacy.js`, `server/test/privacy-uploads.test.js` |
| Files | Authenticated `/uploads` with file cookie or Bearer; public `uploads/public` for branding | `app.js` lines 58–66, `middleware/auth.js` |
| Gamification | XP events and streaks | `xp_events` table, `utils/gamification.js`, `GamificationContext.jsx` |
| Ads | Placeholder ad slot on the **student** dashboard | `client/src/components/AdSlot.jsx`, `pages/student/Dashboard.jsx` line 185 |
| Tests | 26 server tests in 3 files, all passing. No client tests. No CI. | `server/test/*.js` |
| Size | About 6,700 lines of server JS, 8,700 lines of client JSX/JS | `wc -l` |

### 1.1 Gaps found in this review (Phase 0 targets)

| # | Gap | Where | Risk |
|---|---|---|---|
| G1 | Login token stored in `localStorage`, readable by any injected script | `client/src/context/AuthContext.jsx` lines 8–29 | Session theft through any XSS |
| G2 | Content Security Policy disabled | `app.js` line 54: `contentSecurityPolicy: false` | No defence in depth against XSS |
| G3 | CORS allows every origin | `app.js` line 55: `app.use(cors())` | Cross-site API access from any site |
| G4 | Tokens last 7 days with no refresh or server-side revocation | `middleware/auth.js` line 47 | Stolen token works for a week |
| G5 | Minimum password length is 6 characters for teacher passwords; no stronger policy found | `routes/teachers.js` lines 97 and 185 | Weak passwords |
| G6 | Ads shown to students | `AdSlot` on student dashboard | Conflicts with child-privacy rules (COPPA, GDPR Art. 8) and with a paid, ad-free school product |
| G7 | Gamification on for every user, including minors | `xp_events`, streaks | Needs consent review for under-13 users |
| G8 | No Dockerfile, CI, `.env.example`, or documented backup | repo root | Cannot reproduce a deploy or recover data |
| G9 | SQLite on one machine, no tested backup or restore | `db/index.js` | Single point of failure; data loss on disk failure |
| G10 | HTTP access logs use the `dev` format in production | `app.js` line 56 | Noisy logs; no structured logging |
| G11 | No error tracking, uptime checks, or alerts | none | Failures are found by users first |
| G12 | Single school per deployment, no `school_id` | all tables | Each new school needs its own server |
| G13 | Notifications are in-app only; no SMS, WhatsApp, or email delivery | `utils/notify.js` | Parents without the app get no alerts |
| G14 | No parent or guardian role | `users.role` values | The paying customer cannot log in |
| G15 | Uses GitHub token pasted in chat earlier | git history of operations | Token must be revoked |

---

## 2. Architecture decisions

These decisions shape every phase. Each one is marked as a choice to confirm.

| Decision | Recommendation | Why | Status |
|---|---|---|---|
| Tenancy | Database per school. Each school has its own database file (SQLite in Phase 7; one PostgreSQL database per school in Phase 9). A control-plane database maps host to school. | Strongest isolation: one school's query cannot reach another school's rows. Costs more per-school work (migrations, backups), which Phase 7 automates. Chosen by the user on 2026-10-11, overriding the shared-database recommendation. | Decided |
| Database | Keep SQLite for pilots. Move to PostgreSQL in Phase 9. | SQLite is fine for a few schools. Shared multi-school load needs a server database. | Confirm |
| Sync vs async data access | Put a data-access layer in front of `better-sqlite3` before Phase 9. | The code calls `db.prepare()` synchronously in every route. Changing the database means changing every route. | Plan |
| Money | Store amounts as integers in minor units (paisa, cents). Never use floats. | Avoids rounding errors in fee and payment records. | Mandatory |
| Payments in Nepal | Khalti first, with the school as merchant of record. eSewa is deferred (premium integration). Do not hold school money in NITEX accounts. | Khalti is the first gateway the user chose. Avoids payment-licence obligations. Check the exact rules with counsel. | Decided (Khalti). Counsel to confirm |
| Payments abroad | Stripe for USD subscriptions and invoices (Phase 8). | Standard, supports invoices and tax. | Confirm |
| Messaging | Adapter per provider (SMS, WhatsApp, email). Outbox table with retries. | Lets us swap providers without rewriting features. | Plan |
| File storage | Phase 0–8: keep local disk with authenticated access. Phase 9: S3-compatible object storage with signed URLs. | Disk is fine for pilots. Object storage is needed for backups and scale. | Plan |
| Sessions | HttpOnly cookies with CSRF protection and short-lived access tokens (Phase 0). | Fixes G1 and G4. | Mandatory |
| Hosting | Phase 0–6: one VM in Nepal or Singapore with Docker. Phase 8: EU and US regions. | Data residency demanded by EU and US buyers. | Confirm |

---

## 3. The phases

Each phase is laid out the same way:
- **Goal:** what the phase achieves.
- **Why:** market evidence, with a pointer to `MARKET_RESEARCH_AND_MODULES.md` or `MODULE_RECOMMENDATIONS.md`.
- **Linked to the current system:** what the phase builds on, with file or table references.
- **What we build:** schema, API, UI, background jobs.
- **How it improves the system:** the concrete change for users and for the business.
- **Acceptance:** tests and checks that must pass before the phase is done.
- **Exit gate:** the milestone that unlocks the next commercial step.
- **Effort and team:** planning estimate.
- **Risks.**

Dependency order: Phase 0 blocks everything. Phase 1 blocks 2, 3, 6. Phase 3 blocks Phase 8's billing. Phase 7 blocks any scale-up beyond a handful of schools.

---

### Phase 0: Production hardening of the current system

**Goal.** Make the existing single-school app safe to run for a pilot school. No new features.

**Status (2026-10-11): in progress. Code items are built and tested; the exit gate is NOT met.** Done: session cookies with 15-minute access tokens and rotating refresh tokens, server-side revocation, lockout, password policy, CSP and self-hosted fonts, CORS, gamification switch, ads removed, in-app error log, backup and restore scripts with a one-machine drill, and the threat model. Not met: OWASP ZAP baseline (needs staging and Docker), Docker build in CI (no Docker here; CI push needs a `workflow`-scope token), a restore on a separate machine, and off-site, scheduled backups. Details: [PHASE0_STATUS.md](PHASE0_STATUS.md), [THREAT_MODEL.md](THREAT_MODEL.md), [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md), [RESTORE_DRILL_LOG.md](RESTORE_DRILL_LOG.md).

**Why.** Pilot schools will load real student data. Gaps G1–G11 would be found by the first security review a serious school asks for. Market research also found that international buyers look for encryption, access control, and documented data handling ([MARKET_RESEARCH_AND_MODULES.md](MARKET_RESEARCH_AND_MODULES.md), section 3.2 and FERPA/GDPR notes in `INTERNATIONAL_READINESS.md`).

**Linked to the current system.**
- `client/src/context/AuthContext.jsx` stores the token in `localStorage` (G1). The cookie mechanism already exists for files in `middleware/auth.js` (`setFileCookie`, `requireFileAccess`). Extend that pattern to all API calls.
- `app.js` line 54 disables CSP (G2). Line 55 allows all origins (G3).
- `middleware/auth.js` line 47 issues 7-day tokens (G4). The live account-status check added in the uploads work already rejects disabled users on every request.
- `client/src/components/AdSlot.jsx` and `pages/student/Dashboard.jsx` line 185 (G6).
- `utils/gamification.js` and `GamificationContext.jsx` (G7).
- `db/index.js` WAL mode (G9). `app.js` line 56 morgan (G10).
- `README.md` lists production environment variables. Its table should become `.env.example`.

**What we build.**
1. **Session model.** Login sets an HttpOnly, Secure, SameSite=Lax cookie. Add a CSRF token for state-changing requests. Access tokens last 15–30 minutes. A refresh token is stored server-side and can be revoked. Password change or account disable revokes all sessions.
2. **Security headers.** Turn on CSP with an allowlist for the Vite build, fonts, and API origin. Restrict CORS to the configured app origin. Add `Strict-Transport-Security` and `Referrer-Policy`.
3. **Password policy.** Minimum length 12. Reject common passwords. Lock an account for 15 minutes after 10 failed logins, on top of the existing rate limit (`app.js` line 70: 50 attempts per 15 minutes per IP).
4. **Remove student ads.** Delete the `AdSlot` from the student dashboard. Keep the component file but never render it for accounts under 18. Recommend deleting it before international launch.
5. **Gamification switch.** A per-school setting, off by default for pilots. Under-13 users are excluded when the setting is on.
6. **Packaging.** Add a `Dockerfile` (multi-stage: build client, run server), `docker-compose.yml` for local runs, and `.env.example`. Verify the image in CI, because Docker is not available in the current sandbox.
7. **CI pipeline.** On every push: server tests, client build, `npm audit`, `oxlint` on the client. Fails the build on high-severity advisories.
8. **Backups.** Continuous replication of the SQLite file to object storage (Litestream or a scheduled `sqlite3 .backup`). Document the restore procedure and run one restore drill before the first pilot.
9. **Logging and errors.** Structured JSON logs in production (replacing morgan `dev`). Error tracking (Sentry or equivalent). Uptime check on `/api/health`. The endpoint exists (`app.js` line 74) but returns a static OK and does not check the database. Extend it to test a database query.
10. **Secrets and demo.** Confirm `SEED_DEMO` is off in production (test already covers this). Rotate the GitHub token that was pasted in chat. Confirm `JWT_SECRET` is at least 32 characters (already enforced).
11. **Security review.** Run an automated scan (OWASP ZAP baseline) and fix high findings. Write a short threat model.

**How it improves the system.**
- A stolen browser session no longer exposes the token to page scripts (G1).
- A script injected by a compromised dependency is blocked by CSP (G2).
- Access from other websites is blocked (G3).
- Stolen tokens expire in minutes, not a week (G4).
- Backups and restores are tested, so a disk failure is an outage, not data loss (G9).
- Errors are seen before users report them (G11).
- Student ads are removed, which removes a child-privacy conflict (G6).

**Acceptance.**
- All 26 existing tests still pass. New tests cover: token not readable from JavaScript; CSRF rejected without the token; CORS rejects an unknown origin; CSP header present; lockout after 10 failures; refresh revocation on password change.
- Docker image builds in CI. `docker run` serves `/api/health` and the web app.
- One restore drill completed and recorded (restore to a new machine, log in, see the data).
- OWASP ZAP baseline: no high-severity findings.

**Exit gate.** Ready for a **pilot school** with a signed pilot agreement and a privacy notice. Pilots are free or discounted, in exchange for feedback and a case study.

**Effort and team.** About 4 engineer-weeks. One engineer.

**Risks.**
- Changing from localStorage to cookies can break the mobile or file flows. Test the uploads path from Phase 0 work.
- CSP can break the Vite build. Test in the production build, not only in dev.

---

### Phase 1: Guardian accounts and richer student profiles

**Status (2026-10-11): built and tested. The open items are closed in code: the `/uploads` ownership gap is fixed (files open only for the people their records allow), the student photo field is built as an API, and the 500-row import test passes. The 3-pilot-school exit gate is NOT met and cannot be measured without pilot schools.** See [PHASE1_STATUS.md](PHASE1_STATUS.md) for the rules, the decisions to confirm with the school, and the test results.

**Goal.** Add parents and guardians as users, linked to their children, with per-child permissions. Expand the student record to what schools and IEMIS need.

**Why.** Parents are the paying customer and the main user in every market. The research found that every platform has a parent portal ([MODULE_RECOMMENDATIONS.md](MODULE_RECOMMENDATIONS.md), section 3). This is blocker G14. Nepal's IEMIS requires student identity fields that the current `users` table does not hold ([MARKET_RESEARCH_AND_MODULES.md](MARKET_RESEARCH_AND_MODULES.md), section 3.4).

**Linked to the current system.**
- `users.role` has a CHECK constraint. Adding `guardian` needs the same table-rebuild migration pattern already used in `db/index.js` (lines 137–186, the `usersTableAllowsTeacherRole` migration).
- `services/scope.js` decides what each user can see. Add a guardian scope: only linked students.
- `db/seedRbac.js` adds a `guardian` role with view and pay permissions, using the existing `roles` and `role_permissions` tables.
- `routes/privacy.js` export must include guardian links. Erasure must remove the link.
- `utils/notify.js` and the `notifications` table already support per-user notifications. Guardians use them.
- `StudentProfileModal.jsx` (admin) is the place to add the new fields.

**What we build.**
- New table `guardian_students`: `guardian_id`, `student_id`, `relationship`, `is_primary`, `can_view_attendance`, `can_view_fees`, `can_pay_fees`, `can_pickup`, `created_by`, `created_at`.
- New fields on `users` (or a `student_profiles` table): date of birth (AD and BS), phone (with a verified flag), address, admission number, roll number, IEMIS ID, NEB registration number, blood group, emergency contact, photo.
- Guardian onboarding: admin creates the guardian and links students. Guardian sets a password on first login through a one-time link.
- Guardian portal (new client routes): child list, attendance, announcements, report cards (later), fees (Phase 3), profile.
- Bulk import from a CSV or Excel file with validation and a preview step.
- Each guardian-link change goes to the audit log.

**How it improves the system.**
- Parents can log in. This unlocks Phase 2 alerts and Phase 3 payments.
- A single guardian can see several children, which matches how Nepali families are structured.
- Student records are complete enough for IEMIS and for report cards.
- Scope is enforced in one place (`scope.js`), so a guardian can never see another family's data. The existing "fail closed" behaviour of `scope.js` applies.

**Acceptance.**
- Tests: guardian sees only linked children; guardian cannot read another child's data (403); guardian cannot change grades; unlinking takes effect on the next request; export and erasure cover guardian links.
- Bulk import of 500 students completes with a validation report.
- Guardian login works on mobile width.

**Exit gate.** At least 3 pilot schools have guardian accounts for at least 80% of students, with parents logging in weekly.

**Effort and team.** About 4 engineer-weeks.

**Risks.**
- Parent phone numbers are often wrong or shared. Phase 2 will need a verification step.
- A guardian's legal right to a child's data differs by family situation and by country. Add a "guardian record restriction" flag for custody cases before international launch.

---

### Phase 2: Alerts that reach parents (SMS, WhatsApp, email)

**Status (2026-10-11): complete in code and tested (full server suite 198 of 198), and run end to end on a live local server. No code is left except items that need a vendor account.** Adapters are written for Sparrow SMS (Nepal), the WhatsApp Cloud API (approved templates), and SMTP. A live run sent an attendance alert through the worker to the Sparrow protocol. See [PHASE2_STATUS.md](PHASE2_STATUS.md) for what exists, the tests, and what the school or vendor must supply. The exit gate (95% delivery in a pilot month) and the real-cost check need live vendor accounts and a pilot school, so they are not met yet. The production default still holds messages until a provider is configured.

**Goal.** Send attendance alerts, notices, and later fee reminders to parents by the channel they actually use, including parents with no app.

**Why.** Attendance is the most-used feature in school software ([GegoK12](https://gegok12.com/top-10-school-erp-features-schools-actually-use-in-2026/)). Nepali vendors say SMS is still needed for parents without a smartphone ([pdpspectra](https://pdpspectra.com/solutions/student-experience-nepal/)). Parent communication ranks among the top digital tools in US surveys ([K-12 Dive](https://www.k12dive.com/news/parent-survey-reveals-school-communication-preferences/428711/)).

**Linked to the current system.**
- `routes/attendance.js` already creates in-app absence notifications (test 11 in `attendance.test.js`). Those become outbox messages.
- `utils/notify.js` inserts into `notifications`. Keep that as the in-app channel and add the outbox alongside it.
- `routes/settings.js` already holds SMTP settings. Reuse them for email.
- `routes/announcements.js` gains a "send by SMS/WhatsApp" option.

**What we build.**
- `message_outbox` table: no `school_id` column. Under database per school (Phase 7), each school's outbox lives in its own database. Columns: `channel`, `recipient`, `template_id`, `body`, `status`, `attempts`, `provider_message_id`, `cost_units`, `created_at`, `sent_at`.
- Adapters: SMS aggregator for Nepal (provider to be chosen), WhatsApp Business API (requires approved message templates), SMTP or SES for email.
- Background worker: retries with backoff, marks failures, honours opt-outs.
- Per-school quota and monthly usage report (needed for billing in Phase 3).
- Bilingual templates (English and Nepali) for absence, late, fee due, and notice.
- Delivery reports on the admin dashboard.

**How it improves the system.**
- Absence alerts reach parents within minutes, which is the feature schools most often ask for.
- Announcements reach parents who have no app.
- Message usage is metered, which creates a clear add-on price (see section 0.3).

**Acceptance.**
- Tests with a fake provider: retries on failure; no duplicate sends on retry; opt-out respected; quota blocks sending when exhausted.
- Load test: 1,000 messages sent within 10 minutes without losing any.
- Cost check: real per-message cost recorded for at least one provider.

**Exit gate.** Parent alert delivery rate of at least 95% for valid numbers during a pilot month (proposed target).

**Effort and team.** About 3 engineer-weeks, plus provider onboarding time (often 2–6 weeks, depending on approvals).

**Risks.**
- WhatsApp templates need approval, and bulk SMS rules can change. Confirm current rules with each provider before pricing.
- Message cost can erase margin. Track cost per school from day one.

---

### Phase 3: Fees, invoices, receipts, and online payment

**Status (2026-10-11): backend complete in code and tested, including the bank-deposit verification queue, overpayment credit with automatic refund rules, and the daily reconciliation job (43 Phase 3 tests, full server suite 241 of 241). Exit gate not met:** needs a Khalti sandbox merchant account, a month of reconciled pilot data, and a first paying school. The parent payment screen, admin fee screens, dues reminders, and receipt PDF are not built. Details and the list of open items: [PHASE3_STATUS.md](PHASE3_STATUS.md).

**Goal.** Collect school fees through Khalti (the first gateway, chosen by the user; eSewa is deferred as a later premium integration), record every payment, and show dues to parents. This is the feature schools pay for.

**Why.** Fee management is in every platform's core list. In Nepal, vendors describe digital fee payment with eSewa, Khalti, ConnectIPS, and IME Pay as standard ([Nimble](https://nimble.com.np/school-college-software), [WebApp Nepal](https://webappnepal.com/service/payment-gateway)). Fee collection was ranked the top lever in `GO_TO_MARKET_PLAN.md`.

**Linked to the current system.**
- `academic_sessions` for the fee year.
- `users` (students) and the Phase 1 guardian links for who pays.
- `audit_logs` for every fee action.
- `notifications` and Phase 2 outbox for dues reminders.
- `permissions` for `fees.collect` and `fees.view`, through the existing RBAC.
- `privacy.js` export includes payment history; erasure keeps financial records (legal retention) and unlinks identity.

**What we build.**
- Tables: `fee_heads` (tuition, exam, transport, hostel, library, admission, uniform); `fee_structures` (per class and session); `invoices` and `invoice_items`; `payments` (append-only, never updated); `receipts` (gap-free sequential numbers per school); `concessions` (discounts and scholarships with approval); `gateway_transactions` (provider reference, webhook payload, idempotency key, status).
- Amounts in integer minor units.
- Gateway integration: create a payment order server-side, redirect the parent, verify the callback **and** query the provider's status API before marking as paid. Never trust a client-side success page.
- Webhook handler is idempotent (same event twice = one payment).
- Daily reconciliation job: compare provider settlements with our `payments` table; list mismatches.
- Dues report, aging buckets (0–30, 31–60, 61–90, 90+), collection rate by class.
- Cash and bank deposit recording for payments outside the gateway.
- Receipt PDF generation (Nepali and English).

**How it improves the system.**
- Parents pay from their phone. Schools see dues without chasing.
- Every payment is traceable: who paid, how, when, which invoice, which receipt.
- Dues reminders go out through Phase 2 automatically.
- This is the first module that brings in revenue from the school's own customers (add-on pricing in section 0.3).

**Acceptance.**
- Tests: duplicate webhook creates one payment; amount mismatch rejected; provider status check overrides a forged success; receipt numbers have no gaps under concurrent payments; concession needs approval; refund reverses cleanly and is audited.
- Sandbox payments on Khalti end to end, and reconciled. eSewa is out of scope until it is scheduled.
- Financial report reconciles to the penny with a sample month of data.

**Exit gate.** First paying school collecting fees through the gateway, with a month of reconciled data.

**Effort and team.** About 8 engineer-weeks. Gateway merchant approval can take weeks of calendar time, so start the application in Phase 0.

**Risks.**
- Payment rules for providers and for schools differ. Get written confirmation of the merchant model and any licence needs from counsel before go-live.
- Mistakes here cost trust quickly. Build the reconciliation report before the parent-facing payment button.

---

### Phase 4: Timetable, exams, marks, and report cards

**Goal.** Run the school's timetable, record exam marks, grade them under a configurable scale, and print report cards.

**Why.** Timetable and exams are in every core list. Exam and grading tools see the most use during exam season ([GegoK12](https://gegok12.com/top-10-school-erp-features-schools-actually-use-in-2026/)). Gradebook is the top-rated K-12 feature in buyer reviews ([Capterra, MySchool](https://www.capterra.com/p/114989/MySchool/)). Nepal's SEE uses a 4.0 letter scale per subject with NG below 35% ([Nepal News](https://english.nepalnews.com/s/explainers/see-everything-you-need-to-know-about-nepals-national-secondary-examination/), [Educate Nepal, 2083 directive](https://blog.educatenepal.com/2026/05/see-letter-grading-guidelines-system.html)). International schools use other scales (A–F, percentages, IB 1–7).

**Linked to the current system.**
- `subjects`, `sections`, `academic_sessions` already exist.
- `teacher_assignments` and `teacher_subjects` decide who may enter marks for which class (scope).
- Assignments, quizzes, and rubric scores (`submission_rubric_scores`) become **internal assessment** marks automatically. This reuses work the system already does.
- Attendance by period needs the timetable (Phase 4 timetable feeds `routes/attendance.js`).
- The regrade workflow (`regrade_requests`) applies to exam marks too.

**What we build.**
- Tables: `timetable_slots` (class, subject, teacher, day, period, room); `timetable_substitutions`; `exam_terms`; `exams` (term, subject, date, full marks, pass marks, theory and internal split); `exam_marks` (student, exam, theory, internal, total, grade, grade point, status); `grading_scales` (configurable: SEE 4.0 letter scale, percentage, A–F, IB 1–7, custom).
- Conflict detection: teacher or room double-booked; teacher over weekly limit.
- Marks entry grid for subject teachers, with scope checks and audit on each change.
- Grade calculation engine that reads the scale table. SEE mode applies the 75:25 theory and internal split.
- Report card templates with a PDF renderer (server-side, Nepali and English fonts). Parents see report cards in the guardian portal.
- Publish step: marks stay hidden until the exam controller publishes.

**How it improves the system.**
- Assignments and quizzes feed the report card automatically, so teachers enter internal marks once.
- Parents see results when published, not in a WhatsApp group.
- The grading engine is data-driven. Adding a country's scale is a configuration change, not a code change. This matters for international expansion.

**Acceptance.**
- Tests: timetable conflict rejected; subject teacher can enter marks only for their subject and class; grading engine produces correct SEE grades at each boundary (89.99, 90, 35, 34.99); 75:25 split computed correctly; unpublished marks invisible to guardians; report card PDF matches the stored marks.
- Golden-file tests for each grading scale.

**Exit gate.** One full term run in a pilot school: timetable, attendance by period, exams, and published report cards, with no manual spreadsheets.

**Effort and team.** About 8 engineer-weeks.

**Risks.**
- Timetable rules differ widely between schools. Start with a simple model and add options as pilots ask for them.
- Nepal's grading directives change. Keep the scale table versioned by academic year.

---

### Phase 5: Nepal localisation and government reporting

**Goal.** Make NITEX work the way Nepali schools operate: BS calendar, Nepali-language UI and documents, and IEMIS-ready exports.

**Why.** Nepali schools run on the Bikram Sambat (BS) calendar. IEMIS requires schools to update student status, exam results, and transfers, and sets a deadline each year ([EduSanjal, CEHRD IEMIS notice](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/)). NEB is moving to one registration number across grades 9–12 ([myRepublica](https://myrepublica.nagariknetwork.com/news/neb-to-implement-single-registration-system-for-students-of-grades-9-to12)). Nepali buyers have said this is a must-have ([GO_TO_MARKET_PLAN.md](GO_TO_MARKET_PLAN.md), blocker 6).

**Linked to the current system.**
- Phase 1 student fields (BS date of birth, IEMIS ID, NEB number).
- Phase 4 exam status for "passed, repeated, transfer, dropout".
- `settings` table for school code and branding (`routes/settings.js`).
- The client uses English only today. The UI strings need extracting.

**What we build.**
- BS calendar: store dates in AD internally, display and enter in BS. Use a tested conversion library after checking its licence. Cover the full range of years the school needs.
- i18n in the client (for example react-i18next) with English and Nepali. Extract all visible strings. Nepali translations reviewed by a native speaker.
- Devanagari fonts in PDFs (Noto Sans Devanagari, under the SIL Open Font License; confirm licence terms at build time).
- IEMIS export: obtain the current official template from CEHRD. Map each NITEX field to it. Validate before export, showing errors per student.
- NEB registration fields and school-code handling, including the mismatch between CEHRD and NEB codes ([myRepublica](https://myrepublica.nagariknetwork.com/news/neb-to-implement-single-registration-system-for-students-of-grades-9-to12)).
- Nepali-language SMS and WhatsApp templates (Phase 2).

**How it improves the system.**
- Staff can enter and see dates in BS, the way they are used to.
- Report cards and receipts can print in Nepali.
- The IEMIS export removes a manual data-entry task that schools currently do by hand.

**Acceptance.**
- BS conversion tests against a reference table for at least 10 years around the current date.
- IEMIS export validated against the official template on a sample of 200 students with zero format errors.
- Every screen in the main flows renders in both languages with no untranslated keys.

**Exit gate.** Nepal general availability: a school can run a full year, including its government reporting, inside NITEX.

**Effort and team.** About 5 engineer-weeks, plus translation review time.

**Risks.**
- The IEMIS template may change without notice. Confirm the version with the school before each export.
- Translation quality matters. Use a native reviewer.

---

### Phase 6: Transport, library, leave, and health records

**Goal.** Complete the operational modules that schools use every day and that bundle with fees.

**Why.** Transport and library are in most platforms' core lists ([Panoramic](https://www.panoramicinfotech.com/school-management-software)). Transport and hostel fees are common in Nepali fee structures ([Nimble](https://nimble.com.np/school-college-software)). Health records are required in some schools for safety ([MODULE_RECOMMENDATIONS.md](MODULE_RECOMMENDATIONS.md), item 11).

**Linked to the current system.**
- Phase 3 `fee_heads` and `invoice_items`: transport and library fees become normal fee heads.
- Existing `approval_requests` table: leave requests reuse the approval flow.
- Phase 1 guardian permissions: `can_pickup` controls who may collect a child.
- `privacy.js`: health data needs its own erasure and export rules.

**What we build.**
- Transport: `vehicles`, `drivers`, `routes`, `stops`, `student_stops`, transport fee per route. Route change requests with approval.
- Library: `books`, `copies`, `loans`, `fines` (fines become Phase 3 invoice items). Barcode scanning on the web.
- Leave: `leave_requests` with approval through `approval_requests`; student and staff leave; parent request for a student.
- Health: `health_records` (allergies, conditions, vaccinations, incident log). Field-level encryption for the most sensitive fields. Visible only to the class teacher, the school nurse role, and the guardian.

**How it improves the system.**
- Transport and library fees raise average revenue per student without new sales effort.
- Leave requests stop going through paper forms and WhatsApp.
- Health records are in one place, with access control. This is also a reason schools choose a system.

**Acceptance.**
- Tests: loan limits and due dates; fine creates a fee item; leave approval flow; health records invisible to subject teachers; health field encryption round-trip.
- DPIA (data protection impact assessment) written for health data before launch.

**Exit gate.** Two pilot schools using transport and library with fees collected through Phase 3.

**Effort and team.** About 7 engineer-weeks.

**Risks.**
- Health data is sensitive in every jurisdiction. Get legal review before any international use.

---

### Phase 7: Multi-tenant architecture (one database per school)

**Goal.** One NITEX deployment serves many schools. Each school's data lives in its own database file. One school's rows never share a file, a table, or a connection with another school's rows. Schools onboard themselves.

**Why.** Single-school deployments do not scale. `GO_TO_MARKET_PLAN.md` says one managed instance per school is fine for about 20 schools, then multi-tenant is needed. For USD 10M, a school must cost almost nothing to add. Market leaders all run multi-school systems (Infinite Campus, PowerSchool, Fedena, Toddle).

The tenancy path is **database per school**. The user chose it on 2026-10-11, which overrides the earlier shared-database recommendation. The reason is isolation. In a shared database, one missed `WHERE school_id` exposes another school's data. In a database per school, the other school's rows are not in the file the connection opens. The cost is more operational work: provisioning, migrations, and backups across many files. This phase automates that work.

**Linked to the current system.**
- The current system is single-school. `server/src/db/index.js` opens one SQLite file, and about 20 route files and services import that module-level handle. This import is the main refactor. Each request must receive its school's database handle instead.
- `services/scope.js` and `services/permissions.js` keep deciding who may do what inside one school. They no longer need a school filter, because one database holds one school. This is simpler than the shared-database plan.
- `settings` stays a single-row table, because each school database holds one school. The earlier plan to add `school_id` to every table is withdrawn.
- Uploads (`app.js`, `server/src/uploads/`) move to one directory per school (for example `uploads/<school-slug>/`). This is a partial mitigation only. The ownership gap in [PHASE1_STATUS.md](PHASE1_STATUS.md), section 5, must still be fixed by checking owner and scope on every read.
- The startup migrations in `db/index.js` (`addColumnIfMissing` and the table rebuilds) must run once per school database, with a version recorded in each file.
- The existing test pattern (`security.test.js`) gets a cross-school test for every route.

**What we build.**
- **Control-plane database.** One small database, separate from every school's data (SQLite now, PostgreSQL in Phase 9). It holds `schools` (id, slug, custom domain, region, database path, status, plan, created_at), `platform_operators`, and `provisioning_log`. It holds no student or staff data.
- **Tenant resolution middleware.** Reads the request host (a subdomain such as `school.nitex.app`, or a custom domain), finds the school in the control plane, and attaches `req.school` and `req.db`. An unknown host returns 404 before any route runs.
- **Connection manager.** Opens each school's database once and caches the handle. The cache has a size cap, so 1,000 schools do not exhaust file handles. Each connection sets WAL mode and foreign keys on open. Idle handles are closed.
- **Per-school login.** Login is resolved by host, so the same email can exist in two schools. Each token carries the school id. A token from school A presented on school B's host is refused.
- **Routing rule.** Routes and services may not import the global database handle. A lint rule enforces this, and a test fails the build if a route imports it. This rule replaces the "WHERE school_id" rule from the shared plan.
- **Provisioning script.** Creates a school's database from the template schema, seeds roles, permissions, the default session, and default sections, and writes the control-plane row. Target: under one minute.
- **Migration runner.** Applies pending migrations to every school database in order. It stops at the first failure and reports it. Each school's schema version is recorded.
- **Backup and restore per school.** One school can be restored without changing any other school.
- **Migration of the pilot data.** The existing database becomes school 1's database file, with the same content, verified by a checksum of every table.
- **Onboarding wizard.** Create school, set branding, import classes and sections, import staff, import students, invite guardians, configure fee heads.
- **Self-service school admin.** Branding, grading scales, fee structures, message templates, user roles.
- **Per-school billing record (Phase 8).** Kept in the control plane, not in the school's database.

**How it improves the system.**
- Isolation is structural. The main risk of the shared plan, one missed filter, cannot expose another school's rows, because those rows are in another file.
- A school can be backed up, restored, exported (for data portability), or deleted as one unit. Schools ask for exactly this in contracts, and it simplifies the Nepal and EU obligations in Phases 5 and 8.
- A bad import or a corrupt file in one school does not affect any other school.
- Adding a school is still a configuration change plus one database file. It is not a new server.
- Trade-off: platform-wide reporting (usage, billing, cost to serve) reads control-plane counters, not school rows. Any cross-school analytics must be an explicit, opt-in aggregate job.

**Acceptance.**
- Cross-school tests pass for every route. A user from school B who calls school A's host gets 401 or 404. A spy on opened database paths confirms that school A's file is never opened for that request.
- The pilot database migrates to school 1 with zero data loss. Checksums match for every table.
- The migration runner applies to 20 test databases. A failure on one school leaves the other 19 untouched.
- A single school is restored from backup, and the other schools' data does not change (tested).
- A non-engineer onboards a new school in under 60 minutes, timed in a test session.
- Load test: 20 schools on one deployment, peak morning attendance and exam-result publish, with no page above 2 seconds (proposed target).

**Exit gate.** 20 active schools, each on its own database, with zero cross-school access incidents and at least one tested single-school restore.

**Effort and team.** About 12 engineer-weeks. This is an estimate. The shared-database plan was 10 weeks. The extra time covers provisioning, per-school migrations, and the connection manager. The route refactor is the same size either way.

**Risks.**
- File and connection limits when hundreds of schools share one VM. Mitigate with the handle cache now, and with PostgreSQL in Phase 9, where each school becomes a database on a managed server.
- A migration that works on school 1 and fails on school 40. Mitigate with the stop-and-report runner and a staged rollout (5 schools, then all).
- A parent with children in two schools needs two logins. This is the Phase 1 default. A single parent identity across schools needs a central identity service. Decide this before the first multi-school parent asks (roadmap section 4).
- Email is the login per school, so a staff member who works at two schools has two accounts. State this to schools at sale.

---

### Phase 8: International readiness

**Goal.** Sell to schools in the US, EU, UK, and other regions with USD billing, the right consent and data-processing documents, and an interface in their languages.

**Why.** International buyers ask for FERPA, COPPA, and GDPR compliance, data residency, and documented security ([INTERNATIONAL_READINESS.md](INTERNATIONAL_READINESS.md), section 5). Higher prices depend on this. Toddle's IB focus shows that some international segments pay for specialised modules ([Toddle](https://www.toddleapp.com/ib-pyp/)). Accessibility is also a common procurement requirement for public schools.

**Linked to the current system.**
- Phase 0 consent and age rules.
- Phase 1 guardian and consent records.
- Phase 3 payment structure (USD added as a currency).
- Phase 4 grading scales (A–F, IB 1–7).
- Phase 5 i18n framework (add more languages).
- Phase 7 tenant isolation, which every compliance claim depends on.

**What we build.**
- **Languages.** English, then Spanish, French, Arabic (right-to-left layout), and others as buyers name them. Date, number, and currency formats per locale.
- **Billing.** Stripe subscriptions in USD, annual prepaid option, invoices, and tax handling through Stripe Tax or an equivalent. Confirm VAT and sales tax rules per market with an accountant.
- **Data regions.** EU hosting for EU schools. US hosting for US schools. The tenant record stores the region. Data does not leave the region without a documented transfer mechanism.
- **Under-13 mode.** For accounts under 13: no ads (already removed), no gamification, parental consent record before account activation, minimal data collection. Based on COPPA and the GDPR Art. 8 age rules.
- **Documents.** Data processing agreement (DPA) template, standard contractual clauses (SCCs) for transfers, sub-processor list, privacy notice per region, records of processing, data breach runbook (GDPR requires notification within 72 hours of awareness), data retention policy per school.
- **FERPA.** Written "school official" terms: NITEX uses data only for the school's purposes, does not re-disclose, and deletes on request.
- **Accessibility.** WCAG 2.1 AA audit and fixes for the main flows. US public-school buyers increasingly require this. Confirm current federal and state rules with counsel.
- **Trust centre page.** Public page with security practices, sub-processors, data regions, and a contact for security reports.

**How it improves the system.**
- USD billing and regional hosting open the market that carries the target.
- Under-13 mode and consent records make the product safe for younger students everywhere.
- Accessibility work helps every user, not only international buyers.

**Acceptance.**
- Locale tests for each supported language: no untranslated keys, correct date and currency formats, RTL layout checked for Arabic.
- Stripe test-mode subscription, invoice, and tax calculation for at least one EU and one US address.
- Under-13 test: no gamification or ads; consent required before activation.
- Accessibility audit: no critical or serious issues on main flows.
- Legal review of DPA, SCCs, privacy notice, and FERPA terms completed by counsel in each target market.

**Exit gate.** First three international pilots signed with a DPA. Then first international paying customers.

**Effort and team.** About 7 engineer-weeks, plus legal review time.

**Risks.**
- Each country adds legal work. Start with two markets.
- Tax rules are complex. Use a merchant-of-record or tax service rather than building tax logic.

---

### Phase 9: Scale, reliability, and operations

**Goal.** Run many schools with predictable performance, recovery, and monitoring. Meet a published uptime target.

**Why.** Demand peaks in predictable windows: morning attendance, fee deadlines, exam-result publishing. Enterprise and district buyers ask for SLAs. SQLite on one machine cannot meet these reliably at scale.

**Linked to the current system.**
- Synchronous `better-sqlite3` calls throughout the routes. These block the Node event loop at peak times. This is the main technical risk.
- Local `uploads/` folder (Phase 0 backups do not cover it yet).
- Single process with `app.listen` in `index.js`.
- Phase 2 outbox and Phase 3 reconciliation need background workers.

**What we build.**
- **Data layer.** Repository layer in front of every query (started in Phase 7). Then move to PostgreSQL behind it, one school database at a time. Migrate data with a verified copy and a rollback plan. Consider this carefully: it is a large change. Alternative: keep SQLite with one database file per school (SQLite can work for many small databases). Decision needed (section 4).
- **Files.** S3-compatible object storage with signed URLs. Keep the authentication check on every request. Lifecycle rules for deleted files.
- **Workers.** A queue (for example pg-boss on PostgreSQL, or BullMQ with Redis) for messages, reports, PDF generation, imports, and reconciliation.
- **Caching and CDN.** Static assets through a CDN. Long cache headers for hashed build files.
- **Observability.** Structured logs, metrics (request latency, error rate, queue depth, message delivery), distributed traces for the payment and message paths. Dashboards and alerts.
- **Backup and disaster recovery.** Point-in-time recovery of the database (RPO 15 minutes or less, proposed). Restore to a standby region (RTO 4 hours or less, proposed). Restore drill every quarter.
- **Load and capacity.** Load test profiles for peak morning attendance, fee deadline, and results day. Autoscaling rules. Capacity plan per 10 schools.
- **Status page and incident process.** Public status page. Incident commander role. Post-incident review template.
- **SLOs.** Published targets, for example 99.9% monthly availability for the API and the parent portal (proposed). Credits in enterprise contracts when missed.

**How it improves the system.**
- Peak loads do not slow every school down.
- Lost servers and disks become incidents with a known recovery time, not lost data.
- Schools see uptime and incident history, which builds trust.

**Acceptance.**
- Load test at 10× expected peak with error rate under 0.5% and p95 latency under 1 second (proposed targets to validate).
- Full restore into a new environment in under 4 hours, measured.
- Alert fired and acknowledged in a fire drill.
- Migration to PostgreSQL (if chosen): row counts and checksums match for every table, and rollback tested.

**Exit gate.** Enterprise-ready operations: published SLOs, status page, DR tested, 99.9% availability for one full month.

**Effort and team.** About 8 engineer-weeks, plus infrastructure cost. Platform hire recommended.

**Risks.**
- PostgreSQL migration can break reports and queries written for SQLite. Keep a full test suite and run both in parallel for one release.

---

### Phase 10: Enterprise, integrations, and trust

**Goal.** Win district, group, and enterprise contracts. Offer single sign-on, integrations, an API, and third-party audit reports.

**Why.** Districts and large groups ask for single sign-on (SSO), data export APIs, and SOC 2 or ISO 27001 reports before they sign. Integration with Google Classroom and Microsoft is common in the market ([Panoramic](https://www.panoramicinfotech.com/school-management-software), [Toddle integrations](https://www.toddleapp.com/ib-pyp/)). LTI 1.3 is the standard for connecting LMS tools.

**Linked to the current system.**
- `middleware/auth.js` handles login. Add SSO as another way to get a session.
- Phase 0 sessions and CSRF apply to SSO too.
- Phase 7 tenant context applies to SSO (each school has its own identity provider).
- Phase 9 audit and observability support compliance reports.

**What we build.**
- **SSO.** SAML 2.0 and OpenID Connect for Google Workspace and Microsoft Entra ID. Just-in-time user provisioning with role mapping. SCIM provisioning later.
- **Public API.** Versioned REST API with API keys, scopes, rate limits, and documentation. Webhooks for attendance, marks published, and payment received.
- **LTI 1.3 launch.** Lets schools open NITEX from their existing LMS.
- **Mobile.** Progressive Web App first (installable, offline-friendly for attendance). Native apps (React Native) only if usage justifies the cost.
- **Compliance.** SOC 2 Type I, then Type II after an observation period (usually 6–12 months). Or ISO 27001 if buyers prefer it. Annual penetration test. Bug bounty programme after the first pen test.
- **Contract pack.** Enterprise terms, SLA, security questionnaire library (pre-filled answers), data-deletion certificate.

**How it improves the system.**
- Large contracts become possible, with higher prices per customer.
- Integrations reduce switching cost for schools that already use Google or Microsoft.
- The API lets partners build on NITEX, which extends reach without extra sales staff.

**Acceptance.**
- SSO tested with a real Google Workspace tenant and a real Microsoft tenant.
- API contract tests; API keys revocable; rate limits enforced.
- SOC 2 Type I report issued (calendar time, not engineering time).
- Penetration test with no open high or critical findings at sign-off.

**Exit gate.** First district or group contract signed. Security questionnaire answered in under 5 working days.

**Effort and team.** About 10 engineer-weeks, plus audit calendar time (3–12 months, depending on the report).

**Risks.**
- SOC 2 and ISO audits are expensive and slow. Start readiness work early, but do not expect them to be finished before Year 2.

---

## 4. Decisions needed before Phase 0 starts

1. **Team and budget.** Planning assumes 3 engineers, 1 product and sales lead, and 1 support person. Confirm the budget and hiring plan.
2. **Hosting.** Nepal or Singapore for Phases 0–6. Confirm, and confirm when EU and US regions are needed.
3. **Payment gateway. Decided: Khalti first.** eSewa is deferred because it is a premium integration. Start the Khalti merchant application in Phase 0.
4. **SMS and WhatsApp provider.** Start the approval process in Phase 1, because it can take weeks.
5. **Tenancy path. Decided: database per school** (user, 2026-10-11). The shared-database recommendation is withdrawn. Phase 7 is rewritten to match. Phase 9 moves each school to its own PostgreSQL database.
6. **Database.** Stay on SQLite until Phase 9, or move to PostgreSQL earlier.
7. **Gamification for pilots.** On or off by default.
8. **Legal counsel.** Confirm a lawyer for Nepal payments and privacy (Phase 3 and 5), and for the US and EU (Phase 8).
9. **Market order.** Nepal first, then international, or both in parallel from Phase 8. This plan assumes Nepal first.
10. **Revoke the GitHub token** pasted in chat (G15), if not already done.

---

## 5. Production-ready definition (the gate)

NITEX is production-ready for a given market when every item below is true for that market.

**Security and privacy**
- [x] Sessions in HttpOnly cookies; CSRF protection; short-lived tokens; server-side revocation.
- [ ] CSP, HSTS, restricted CORS; OWASP ZAP baseline clean at high severity.
- [x] Password policy and lockout; no demo accounts in production.
- [x] All file access authenticated (or signed URLs with short expiry).
- [ ] Cross-tenant tests pass for every route (Phase 7).
- [ ] Privacy export and erasure work for every data type, including guardians, payments, and health records.
- [ ] Penetration test completed with no open high or critical findings.

**Reliability and operations**
- [ ] Docker image built in CI; one-command deploy.
- [ ] Automated backups with a restore drill completed in the last 90 days.
- [ ] Monitoring, alerts, and error tracking in place; on-call rota defined.
- [ ] Load test at 10× expected peak passed.
- [ ] Published SLO and status page.

**Product**
- [ ] Guardian portal, alerts, fees, timetable, exams, and report cards working end to end.
- [ ] Nepal: BS calendar, Nepali UI, IEMIS export validated.
- [ ] International: at least two languages (English plus one), USD billing, Stripe Tax handled.
- [ ] Onboarding wizard completes in under 60 minutes for a new school.

**Compliance and contracts**
- [ ] Privacy notice, DPA, sub-processor list, data retention policy published.
- [ ] Under-13 consent and mode in place for international deployments.
- [ ] FERPA school-official terms in place for US customers.
- [ ] GDPR records of processing, DPIA for health and student data, breach runbook.
- [ ] Legal review done in each market where we sell.

**Commercial**
- [ ] Pricing page and contract templates published.
- [ ] Support hours and response times published per plan.
- [ ] At least 10 paying schools with reference permission.

---

## 6. Go-to-market track (runs alongside the engineering)

This track starts in Phase 0 and runs in parallel.

| When | Milestone | Measure |
|---|---|---|
| Phase 0 | 5 pilot schools in Bagmati, signed pilot agreements | Pilots signed |
| Phase 1–2 | Parent alerts and guardian logins live in pilots | Weekly active parents (proposed target: 50% of guardians) |
| Phase 3 | First paying schools collecting fees | Collection rate; paying schools |
| Phase 4–5 | Full-year Nepal product; IEMIS export | Schools renewing for the next year |
| Phase 7 | 20 schools, each on its own database, on one deployment | Onboarding time; support tickets per school |
| Phase 8 | 3 international pilots with DPA | International pilots signed |
| Phase 10 | First district contract | Contract value |

Sales and marketing capacity must match the phases. A realistic first step is a Nepal sales lead in Phase 3 and an international partner or sales lead in Phase 8.

Metrics to track from day one: trial-to-paid rate; monthly churn; net revenue retention; cost to serve per school (hosting, SMS, support); gross margin per plan; time to onboard; support tickets per school per month.

---

## 7. Risks to the whole plan

| Risk | Impact | Mitigation |
|---|---|---|
| Target needs customers that do not exist yet | Plan does not reach USD 10M | Track the ramp in section 0.4 each quarter. Adjust price and segments early |
| Nepal private market is too small at good prices | Revenue ceiling | International track from Phase 8. Premium plans. Add-on revenue |
| Payment provider approval takes longer than planned | Phase 3 delayed | Start applications in Phase 0 |
| Cross-school data leak | Loss of trust, legal exposure | Phase 7 per-school databases (a query cannot reach another school's rows); a rule that routes may not import the global database; generated cross-school tests; external pen test |
| SQLite cannot keep up at scale | Slow peaks; outages | Phase 9 data layer; decision on database by Phase 7 |
| Regulation changes (privacy, SMS, payments, IEMIS format) | Rework | Versioned rules and templates; monitor official sources; counsel review each year |
| Key-person dependency on one engineer | Delay or outage | Documentation, code review, second engineer by Phase 2 |
| Competitors with free tiers (ClassDojo, Google Classroom) | Price pressure | Compete on fee collection, Nepali payments, local compliance, and parent alerts, not on core free features |
| Support load grows faster than revenue | Margin loss | Self-service onboarding, in-app help, support tiers, cost per school tracked |

---

## 8. Sources

- [Kathmandu Post: Economic Survey 2025-26 school counts](https://kathmandupost.com/national/2026/05/28/economic-survey-shows-falling-enrollment-in-community-schools-and-rapid-growth-in-public-health-facilities)
- [Vietnam News: community schools shrink as private education expands](https://vietnamnews.vn/world/1782624/community-schools-shrink-as-private-education-expands-in-nepal.html)
- [EduSanjal: education levels in Nepal](https://edusanjal.com/blog/education-levels-nepal/)
- [EduSanjal: CEHRD IEMIS update notice](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/)
- [myRepublica: NEB single registration system](https://myrepublica.nagariknetwork.com/news/neb-to-implement-single-registration-system-for-students-of-grades-9-to12)
- [Nepal News: SEE explainer](https://english.nepalnews.com/s/explainers/see-everything-you-need-to-know-about-nepals-national-secondary-examination/)
- [Educate Nepal: SEE letter grading directive 2083](https://blog.educatenepal.com/2026/05/see-letter-grading-guidelines-system.html)
- [GegoK12: top school ERP features schools use in 2026](https://gegok12.com/top-10-school-erp-features-schools-actually-use-in-2026/)
- [Capterra: MySchool features and buyer priorities](https://www.capterra.com/p/114989/MySchool/)
- [K-12 Dive: parent communication preferences](https://www.k12dive.com/news/parent-survey-reveals-school-communication-preferences/428711/)
- [Nimble: school and college ERP, Nepal](https://nimble.com.np/school-college-software)
- [WebApp Nepal: payment gateway integration](https://webappnepal.com/service/payment-gateway)
- [pdpspectra: student experience app, Nepal](https://pdpspectra.com/solutions/student-experience-nepal/)
- [Toddle: IB PYP platform](https://www.toddleapp.com/ib-pyp/)
- [Panoramic Infotech: school management software modules](https://www.panoramicinfotech.com/school-management-software)

Internal documents referenced: `GO_TO_MARKET_PLAN.md`, `INTERNATIONAL_READINESS.md`, `MARKET_RESEARCH_AND_MODULES.md`, `MODULE_RECOMMENDATIONS.md`, `IMPLEMENTATION_STATUS.md`, `RBAC_ENTERPRISE_ARCHITECTURE.md`.

Figures marked "proposed" are planning targets to validate, not measured results. Exchange rate of NPR 140 per USD is carried from the earlier plan and must be updated before any pricing decision.
