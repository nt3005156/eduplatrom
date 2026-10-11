# Phase 1 status: guardian accounts and richer student profiles

Date: 2026-10-11. Plan reference: [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md), Phase 1.

**Status (2026-10-11): built and tested. The three open items from earlier are closed: the `/uploads` ownership gap is fixed, the photo field is built, and the 500-row import test exists and passes. The exit gate (3 pilot schools with guardian accounts for at least 80% of students) cannot be measured until a pilot school is live. It is not met.**

---

## 1. What was built

| Area | What exists now | Where |
|---|---|---|
| Guardian accounts | Admin creates a guardian (name, email, optional phone) and links children in one transaction. Guardians sign in with email and password. | `server/src/routes/guardians.js`, `server/src/services/guardians.js` |
| Child links | `guardian_students` table: relationship (father, mother, guardian, grandparent, other), primary flag, attendance, fees, pay-fees, pick-up, custody restriction flag, creator, timestamps. One row per guardian and child. | `server/src/db/schema.sql` |
| Access flags | Admin can change attendance visibility, restriction, and the other flags. A restriction hides the child on the next request. | `PATCH /api/guardians/:id/students/:studentId` |
| One-time setup links | Guardians and imported students set their own password from a link. Links expire after 7 days. Only SHA-256 hashes are stored. A new link voids the old one. | `services/accountSetup.js`, `routes/auth.js` (`GET` and `POST /api/auth/setup`) |
| Guardian portal | Child list, child attendance (daily and by subject, date range), school announcements from linked classes, and a read-only profile page (name, sign-in email, phone with verification state). | `/api/guardian/*`, client `pages/guardian/*` |
| Admin pages | Guardian list and editor, student bulk import with preview, CSV template, and setup-link CSV download. | client `pages/admin/Guardians.jsx`, `pages/admin/StudentImport.jsx` |
| Bulk import | CSV, up to 2,000 rows per file. Any bad row refuses the whole file (422) and writes nothing. Siblings sharing a guardian email are linked to one account. | `routes/studentImport.js`, `utils/validate.js` |
| Student profile fields | Phone (normalised to E.164), date of birth (AD and BS), address, admission number, roll number, IEMIS ID, NEB registration number, blood group, emergency contact name and phone. Admin-only `PATCH /api/users/:id/profile`, audited with before and after values. | `db/index.js` (`addColumnIfMissing`), `routes/users.js` |
| Privacy | Export includes guardian links in both directions. Erasure removes guardian links and setup tokens. The export `UNION` `ORDER BY` bug was fixed. | `routes/privacy.js` |
| Scope | Guardians hold no staff scope. The guardian check runs before the unrestricted check, so bad role data cannot grant whole-school access. | `services/scope.js` |
| Archived children | Archived and disabled children are hidden from the parent, even when the link row still exists. | `services/guardians.js` |

## 2. Verification

| Check | Result | Evidence |
|---|---|---|
| Full server suite | **198 of 198 pass** (at the 2026-10-11 Phase 0 and 1 close-out; was 93 at the first Phase 1 commit) | `cd server && npm test` (node:test) |
| File ownership rules (new) | 11 of 11 | `server/test/uploads-ownership.test.js` |
| Student photo (new) | 12 of 12 | `server/test/student-photo.test.js` |
| Guardian rules | 19 of 19 | `server/test/guardians.test.js` |
| Import rules | 10 of 10 | `server/test/student-import.test.js` |
| Isolation and scope | 10 of 10 | `server/test/guardian-isolation.test.js` |
| Validation | 9 of 9 | `server/test/validate.test.js` |
| Client build | Exit 0 | `cd client && npm run build` |
| Lint | 0 errors, 37 warnings | Same warning count as before Phase 1. |
| Browser run | **16 of 16 pass**, run four times on fresh databases (before the layout fix, after it, after the changes in section 3, and after the profile page was added) | `e2e/phase1_guardian_e2e.py`. Covers the parent's own profile on a phone with no children listed, admin guardian list, import preview blocking bad rows, template download, setup link (single use), portal showing only linked children, 390px no horizontal scroll, HttpOnly session cookie with no file cookie, attendance on a phone, guardian refused on staff, file and admin routes, admin URL redirect, empty state, no console errors. |
| Endpoints the browser run did not reach | Checked directly with HTTP calls | `PUT /api/guardians/:id`, `PATCH` and `DELETE` on guardian students, `POST /api/guardians/:id/students`, `POST /api/guardians/:id/setup-link`, `GET /api/guardians/student-search`. All return the shapes the pages read. Writes need the `X-NITEX-Client` header, and cross-site writes without it return 403. |

Response shapes the pages depend on (`children`, `daily`, `subjects`, `records`, `attendance_last_30_days`, `can_view_attendance`, `setup_url`, `setup_expires_in_days`, `setup_links`, `created`, `links`, `student_name`) were checked against the routes.

### Acceptance criteria from the roadmap

| Roadmap criterion | Status | Evidence |
|---|---|---|
| Guardian sees only linked children | Met | `guardians.test.js`, `guardian-isolation.test.js` |
| Guardian cannot read another child's data (403, no data in the body) | Met | `guardian-isolation.test.js` |
| Guardian cannot change grades | Met by design: every write outside the portal is refused | `guardians.test.js` (allowlist test) |
| Unlinking takes effect on the next request | Met | `guardians.test.js` (unlink), `guardian-isolation.test.js` (shared child) |
| Export and erasure cover guardian links | Met | `guardians.test.js` (privacy test) |
| Bulk import of 500 students with a validation report | Met. 500 rows with 250 shared guardians finished in about 240 ms. | `student-import.test.js` |
| Guardian login works at mobile width | Met (390px check) | `e2e/phase1_guardian_e2e.py` |
| Exit gate: 3 pilot schools, 80% of students with guardian accounts, weekly logins | **Not met.** No pilot school yet. | Needs a live pilot. |

## 3. Changes made after the browser run

These were made after the last browser run and are covered by the full suite:

1. `scope.js`: guardians return an empty scope before any other rule runs. `UNRESTRICTED_ROLE_KEYS` is exported and a test pins that `guardian` is not in it.
2. `services/guardians.js`: archived and disabled children are hidden from both the child list and direct child reads. Before this change, a linked archived child still appeared.
3. Guardian portal layout: child cards no longer wrap names onto three lines at 390px.

The browser suite was rerun against a restarted server with a fresh database after all changes, including the profile page: 16 of 16 pass.

## 4. Assumptions

**Parent account model (assumption, not yet confirmed).** This is one of the open decisions in the roadmap, section 4.

- Each guardian is one login, matched by email.
- A family with several children is one account linked to each child.
- Siblings sharing a guardian email are linked to one account by the import.
- Two parents with different emails are two accounts, and both can be linked to the same child. This is tested.
- Setup links are delivered by the admin (copy link or CSV). No email or SMS delivery exists yet. That is Phase 2.
- Phone numbers are stored in E.164 form but **not verified**. The `phone_verified` flag exists, but no Phase 1 flow sets it. Verification is Phase 2 work.

If the user chooses a different model (for example, one parent login across several schools), the schema and the link rules change.

## 5. `/uploads` ownership gap: fixed

**Before:** any signed-in non-guardian could open any upload by its path, including files from another class.

**Now:** every file is checked against the records that point at it (`server/src/services/fileAccess.js`, called from `requireFileAccess` in `middleware/auth.js`). Each record carries its owner and scope.

| File source | Who may open it |
|---|---|
| Material, quiz question media | Students in the class; teachers assigned to that class and subject; the uploader |
| Assignment attachment | Students in the class and section; teachers assigned to it; the creator |
| Submission (including multi-file lists, resubmissions, regrade requests) | The student who sent it; teachers assigned to that assignment |
| Question bank media | Teachers assigned to the subject; the creator |
| Application document | The applicant; academic head and coordinator |
| Student photo | The student; teachers of the student's class; admins |
| School branding (logo, favicon, hero image) | Any signed-in, non-guardian user |
| A file no record refers to | Admins only |
| Everyone | Guardians: no file access. Disabled or archived accounts: no access. |

Denied and missing files return the same 404, so the server does not reveal which file names exist. Names containing folders, `..`, or a leading dot are refused.

**Decisions to confirm with the school:**
1. Academic head and coordinator (staff roles) can open every school file. This matches their oversight role. If the school wants them limited to their classes, change `SCHOOL_WIDE_STAFF` in `fileAccess.js`.
2. Classmates cannot see one another's photos. Only the student, teachers of the class, and admins can.
3. Existing files with no record are admin-only. The first request for such a file by a student now returns 404 (a test was updated to say so).

## 6. Known limits and what is not in Phase 1

- No fee, invoice, or payment views for guardians (Phase 3).
- No report cards for guardians (Phase 4).
- Student photo: **built as an API** (`POST` and `DELETE /api/users/:id/photo`). Accepts JPEG, PNG or WebP only, checked by file content, up to 2 MB. Only the student or an admin may change it. The admin and student pages do not show or upload a photo yet; that screen is still to build.
- Guardians cannot edit their own name, email, or phone. The profile page is read-only, and the school office makes changes. Self-service edits need phone verification (Phase 2).
- No SMS, WhatsApp, or email delivery of setup links or notices (Phase 2).
- No legal review of guardian access rules, custody handling, or the Nepal data-protection position (open decision 8 in the roadmap).
- Two parent logins across two schools are not supported. Under the database-per-school decision (Phase 7), an account lives in one school's database.

## 7. Next steps

1. Pilot schools for the exit gate (3 schools, 80% guardian accounts).
2. Decide the parent account model (section 4) and the legal review of guardian access (roadmap open decision 8).
3. Build the photo screens (admin student page and the student's own profile) on top of the API above.
4. Confirm the two file-access decisions in section 5 with the school.

## 8. Credential note

Two fine-grained GitHub tokens were pasted in chat during this work. Neither was stored in a file, git config, or the remote. Both should be revoked. The current token also lacks the `workflow` scope.
