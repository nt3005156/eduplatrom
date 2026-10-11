# RBAC Redesign — What Was Actually Built vs. Designed-Only

Companion to `RBAC_ENTERPRISE_ARCHITECTURE.md`. That document describes the full target
architecture for all 20 requested deliverable categories. This file is the honest, concrete
record of what was implemented and verified working in this session vs. what remains a design
only. Every "Built & Tested" item below was exercised live (curl and/or Playwright against a
booted dev server), not just written and assumed correct.

## ✅ Built & Tested This Session

### RBAC Core Engine
- **Schema**: `roles`, `permissions`, `role_permissions`, `user_permission_overrides`,
  `scope_assignments` tables (additive, migrated cleanly on both fresh and existing DBs).
- **Seed data** (`server/src/db/seedRbac.js`): 6 roles (System Admin, Academic Head, Coordinator,
  Exam Coordinator, Class Teacher, Subject Teacher), 25 permissions across 8 modules, full
  role-default grant matrix — idempotent on every boot, auto-backfills `users.role_id` from
  existing `role`/`staff_role` columns so no manual admin migration step is required.
- **`services/permissions.js`**: `hasPermission(user, key)`, `resolveAllPermissions(user)`,
  `requirePermission(key)` Express middleware. Verified via direct unit-style calls and live API
  tests: Subject Teacher gets `assignment.create=true, teacher.manage=false`; Coordinator gets
  `audit.view=true, assignment.create=false`; System Admin bypasses everything; `admin_only`
  permissions (`teacher.manage`, `settings.permission_matrix`) are hard-locked in code regardless
  of role_permissions state.
- **`services/scope.js`**: `resolveScope(user)`, `scopeWhereClause()`, fail-closed by design.
  Verified: a teacher with zero `teacher_assignments` rows sees 0 rows, not everything.
- **`GET /api/auth/me/permissions`**: resolved permission set + scope, live-tested for both a
  Subject Teacher and System Admin.

### Critical Bug Fix: Unscoped Staff Data Access
This was the most important fix and the direct cause of the redesign request. Before this
session, `GET /api/dashboard/admin` and its `/details/*`, `/students`, `/students/:id`
sub-routes queried **every** student/material/assignment/quiz/submission in the database
regardless of who was logged in.

**Live-verified fix**: with a teacher scoped only to Class 10 Section A Mathematics and a second
student created in Class 7 Section B:
- Teacher's `/api/dashboard/admin` → `totalStudents: 1` (their own), scope reported as
  `{unrestricted: false, roleKey: 'subject_teacher'}`.
- Admin's `/api/dashboard/admin` → `totalStudents: 2` (whole school), scope `{unrestricted: true}`.
- Teacher's `GET /api/dashboard/admin/students` → returns only the in-scope student.
- Teacher's `GET /api/dashboard/admin/students/:id` on the **out-of-scope** Class 7 student →
  **403** ("This student is outside your assigned classes/sections.").
- Same call on their **in-scope** student → **200**.

### Coordinator Role (fully working, not just a label)
- **Backend** (`server/src/routes/coordinator.js`, mounted at `/api/coordinator`): `/overview`,
  `/teacher-workload`, `/login-activity`, `/pending-reviews`, `/inactive-teachers` — all gated by
  `requirePermission('analytics.view_school_wide')`, not a hardcoded role check.
- **Audit Log opened up to Coordinators**: `server/src/routes/audit.js`'s 4 routes switched from
  `requireAdmin` to `requirePermission('audit.view')` — live-verified a Coordinator can open
  `/admin/audit-log` and see real data (a "Coord Person logged in" entry), while a Subject
  Teacher hitting the same route client-side is redirected away, and hits 403 server-side.
- **Frontend** (`client/src/pages/coordinator/CoordinatorDashboard.jsx`): stat cards, inactive
  teacher alert, teacher workload table, pending reviews table, embedded recent-audit feed with a
  link to the full Audit Log — screenshotted and confirmed rendering correctly with real data.
- **Completely different sidebar** (`Sidebar.jsx`): a Coordinator (any teacher holding
  `analytics.view_school_wide` but not `assignment.create`) gets a nav of just "Coordinator
  Dashboard" + "Audit Log" — no content/assignment/quiz creation links at all. Screenshotted
  side-by-side against a Subject Teacher's full teaching sidebar to confirm the difference is
  real, not cosmetic.
- **`PermissionContext` + `RequirePermission` + `RequirePermissionRoute`**: fetch
  `/api/auth/me/permissions` once after login, gate both sidebar links and route access. Verified
  a Subject Teacher manually navigating to `/coordinator` or `/admin/audit-log` gets redirected
  back to `/admin` client-side, and gets a real 403 if they call the API directly.
- **Teacher Management sync**: creating/editing a teacher's `staff_role` via the existing
  `/api/teachers` endpoints now also updates `users.role_id` and invalidates the permission cache,
  so a role change takes effect immediately — verified by creating a Coordinator account through
  Teacher Management and confirming its permission set was already correct on first login.

### Real Bug Found & Fixed During Regression Testing
While running a full click-through regression across all three roles (a requirement of the
"targeted QA" pattern established earlier in this project), a genuine **pre-existing** bug (not
introduced by this session's RBAC work) was found: `AdminStudents.jsx` (shared by admin and
teacher) called the admin-only `GET /api/users/pending` unconditionally with no `.catch()`,
producing an uncaught 403 promise rejection for every teacher who opened the Students page. Fixed
by gating that call on `user.role === 'admin'` and adding `.catch()` defensively to both fetches.
Verified fixed via a before/after Playwright run (2 page errors → 0).

### Regression Coverage
Full click-through navigation (not just page loads) re-verified with zero console/500 errors for:
Admin (13 pages), Teacher (8 pages), Student (5 pages), Coordinator (dashboard + all 3 tabs +
audit log). All via real login + real permission resolution, not mocked.

## ✅ Built & Tested This Session (Round 2)

### Permission Matrix Admin UI (fully working, not just backend)
- **Backend** (`server/src/routes/roles.js`, `server/src/routes/permissions.js`, mounted at
  `/api/roles` and `/api/permissions`, all System-Admin-only): list roles with live allow-count
  and user-count; get/set a role's full permission grants in one bulk save; create a custom role
  (optionally cloning another role's grants — the concrete proof of "new roles without changing
  the architecture"); delete a role (blocked if any user still holds it); create/list/revoke
  per-user permission overrides with a mandatory `reason` field; a "preview effective permissions"
  endpoint for any user.
- **Live-verified via curl**: toggled `marks.export` from unset→allow for Subject Teacher role,
  confirmed a logged-in teacher's `/api/auth/me/permissions` reflected the change **immediately**
  (in-process permission cache invalidated on save, not just on TTL expiry) — then reverted it.
  Verified the `admin_only` defense-in-depth: attempting to grant `teacher.manage` to Subject
  Teacher through the matrix endpoint is silently dropped server-side; the affected teacher's
  resolved permission for that key stays `false` regardless. Verified temporary overrides
  (`expires_at` in the past → does not apply) vs. permanent overrides (applies immediately) vs.
  revocation (reverts immediately). Verified custom role creation with clone-from, then deletion.
- **Frontend** (`client/src/pages/admin/RolesPermissions.jsx`, at `/admin/roles-permissions`,
  admin-only): a role list sidebar (allow-count + user-count per role) next to a permission
  matrix grouped by module, with a 3-state toggle per permission (Allow / Deny / Inherit-deny),
  "Sensitive" and "System Admin only" badges, a "New Custom Role" modal (with clone-from), a
  "Preview As Teacher" tool that searches a real teacher and shows their exact resolved
  permissions + scope summary side-by-side. Live-tested end-to-end via Playwright: toggled "Can
  Export Marks" for Subject Teacher through the actual UI, saved, confirmed the toast ("applies
  immediately to 1 user(s)") and the sidebar's allow-count updating from 11→12, then reverted and
  re-verified via the Preview tool that Priya Sharma's resolved permission for `marks.export`
  correctly went back to denied.
- **Bug found and fixed during this build**: `permissions.admin_only` / `permissions.is_dangerous`
  are SQLite integers (0/1), not JS booleans — `p.admin_only && <Badge/>` rendered a literal `0`
  next to every non-dangerous permission label (the exact same falsy-integer JSX bug pattern
  fixed twice already in this project's history for `is_class_teacher` and rubric flags).
  Fixed with `!!p.admin_only` — screenshotted before/after to confirm.

## ✅ Built & Tested This Session (Round 3 — closing the "menu hiding only" gap)

The user correctly identified that Rounds 1-2 built the RBAC *engine* (roles, permissions, scope
resolution) and applied it to the Dashboard, but had **not yet applied scope enforcement to the
actual content modules** — Assignments, Quizzes, Content/Materials, Subjects, Question Banks, and
Announcements were all still completely unscoped at the API level. A live exploit test confirmed
this: a Subject Teacher scoped to only "Class 10 Section A Mathematics" could list, create, edit,
and delete assignments/quizzes/content for **any class or subject in the school**, and every
Class dropdown in the UI still hardcoded all of Class 6-12 regardless of the logged-in user's
actual assignments. This round closes that gap for real, with the exact backend enforcement (not
menu-hiding) the user asked for, verified live end-to-end for every case below.

### New scope-enforcement primitives (`server/src/services/scope.js`)
- `isWithinScope(scope, {classLevel, section, subjectId})` — validates a WRITE target (the
  class/section/subject a create/edit request is trying to touch) against the caller's actual
  `teacher_assignments` rows. Fail-closed: no match = rejected.
- `allowedSubjectIdsForClass(scope, classLevel)` — the exact subject_ids a user may see/act on for
  one class (`null` = every subject, for unrestricted roles or a Class Teacher's homeroom grant).
- `allowedClassLevels(scope)` — every class_level a user has any assignment in at all, used to
  build Class dropdowns that never even show an out-of-scope option.

### Assignments module (`server/src/routes/assignments.js`) — every route now scope-checked
`GET /` (cross-class listing), `GET /class/:cls` (staff branch), `GET /subject/:subjectId`,
`GET /:id`, `POST /` (create — validates target scope before insert), `PUT /:id` (validates both
current AND new target scope, blocking "reassign into my scope" tricks), `POST /:id/duplicate`,
`PUT /:id/archive`, `DELETE /:id`, `GET /:id/submissions`, `PUT /submissions/:subId/grade`,
`GET /submissions/:subId/grade-history`, `PUT /submissions/:subId/reject-invalid`,
`PUT /submissions/:subId/mark-late`, `POST /submissions/:subId/request-resubmission`,
`PUT /regrade-requests/:id/decide`, `GET /regrade-requests` (list), `GET /:id/analytics`.

**Live-verified exploit-then-fix**: created a Class 7 assignment as Admin; confirmed a Subject
Teacher scoped only to Class 10 Section A Mathematics (a) could see it in their listing (bug), (b)
could successfully `POST` a brand-new assignment with `class_level=7` (bug) — then after the fix,
both are blocked (`403 You can only create assignments for classes/sections/subjects assigned to
you.` / listing returns 0 results), while creating within their own scope and every other action
on their own assignments continues to work normally, and Admin remains fully unrestricted.

### Quizzes module (`server/src/routes/quizzes.js`) — same pattern applied
`GET /`, `GET /class/:cls` (staff branch), `GET /:id`, `POST /`, `PUT /:id` (current + new target),
`PUT /:id/archive`, `POST /:id/duplicate`, `DELETE /:id`, `GET /:id/pending-manual-grading`,
`GET /attempts/:attemptId/answers`, `PUT /attempt-answers/:id/grade`, `GET /:id/analytics`. Quizzes
have no `section` column (class-wide only) — `scopeWhereClause()` already supported a
`section: null` mode from an earlier session's fix, reused here correctly.

**Live-verified**: identical exploit-then-fix cycle as assignments — direct GET/DELETE by id on an
out-of-scope quiz returns 403, cross-class listing returns 0 for out-of-scope quizzes.

### Content Management (`server/src/routes/materials.js`, `server/src/routes/subjects.js`)
This is the fix that matters most for the user's specific complaint ("never even see English,
Science, Computer... in dropdowns"). **`GET /api/subjects` and `GET /api/subjects/class/:cls`
previously returned literally every subject in the school to every authenticated staff member —
this was the root cause of every subject dropdown throughout the app showing unrelated subjects.**
Now: a student still sees every subject for their own class (correct — a student needs to see all
their subjects); staff see only `allowedSubjectIdsForClass()` for each class they're assigned to,
or every subject in a class where they hold a Class Teacher homeroom grant. `materials.js`'s
`GET /class/:cls`, `GET /subject/:subjectId`, `POST /` (create), and `DELETE /:id` all now
scope-check the same way.

**Live-verified with the user's exact example scenario**: created a fresh, pure Subject Teacher
account ("John", Class 10 Section A **and** Section B Mathematics, no homeroom grant — the precise
`Teacher: John / Role: Subject Teacher / Class 10 A – Mathematics, Class 10 B – Mathematics`
example from the request):
- `GET /api/subjects` → `[('Mathematics', 10)]` only.
- `GET /api/subjects/class/10` → `['Mathematics']` only (Biology/Chemistry/Computer
  Science/English/Physics from the seed data are correctly hidden).
- `GET /api/subjects/class/7` (a class he has zero assignment in) → `[]`.
- `GET /api/dashboard/admin/students` → only his Class 10 student(s).
- `POST /api/materials` targeting English/Class 10 → **403**; targeting Mathematics/Class 10 →
  succeeds.
- `GET /api/materials/class/10` → only Mathematics content, even though English/Science/Computer
  content exists for that class.
- **Frontend**: screenshotted the real "New Assignment" modal and "Manage Content" page logged in
  as John — the Subject dropdown shows only "Mathematics", the Class dropdown defaults to Class 10
  (previously defaulted to Class 12, an unrelated class he isn't even assigned to), and Manage
  Content shows exactly one subject tab ("Mathematics") with no way to even navigate to another
  subject's content.

### Question Banks (`server/src/routes/quizzes.js`, question-bank routes)
Same unscoped-access bug existed here too: `GET /question-banks` returned every named bank in the
school, and any staff member could open/edit/delete/import-into/duplicate/generate-a-quiz-from any
bank regardless of its owning class/subject. Fixed via a new `assertBankInScope()` helper applied
to all 10 question-bank and question-bank-item routes, plus `generate-from-bank`'s explicit
`item_ids` path (which now re-validates every selected item's bank is in scope, not just the
target quiz's class/subject — closing a "pick items by id from someone else's bank" bypass).
General-purpose banks with no `class_level`/`subject_id` set remain visible to everyone (unchanged
behavior — they're not owned by any specific subject).

**Live-verified**: created an "English Grammar" bank as Admin; confirmed John (Math-only) sees `[]`
when listing banks, gets 403 on direct GET and DELETE by id.

### Announcements (`server/src/routes/announcements.js`) — permission + scope, not just scope
This route needed both a permission check AND a scope check, matching the user's explicit
distinction between school-wide and class-level broadcast rights:
- `communication.broadcast_school` (send with `class_level=null`) — Academic Head / System Admin
  only (`hasPermission` check).
- `communication.broadcast_class` (send to a specific class) — granted to Subject Teacher, Class
  Teacher, Academic Head, System Admin by role default (added `subject_teacher` to this grant in
  `seedRbac.js` this round, since the user's spec explicitly lists "Announcements" among what a
  Subject Teacher may create) — but additionally scope-checked so the target class must actually
  be one they're assigned to.

**Live-verified**: John gets 403 attempting a school-wide announcement, 403 attempting a Class 7
announcement, 200 announcing to his own Class 10; Admin's school-wide announcement still succeeds.
**Frontend**: the "Target Class" field in the New Announcement form now only lists the user's
`allowedClasses`, hides the "All Classes" option entirely (and marks the field required) for users
without `communication.broadcast_school`, with an inline explanation of why.

### Frontend: every hardcoded `[6,7,8,9,10,11,12]` Class list replaced
This was the second half of the "no manual filtering, automatic everywhere" requirement — even
with the backend fixed, a teacher would still see every Class 6-12 option in every dropdown and
only discover the restriction after an API call failed. Added `allowedClasses` to
`PermissionContext` (derived from the already-fetched `/api/auth/me/permissions` scope, with a new
`scope.allowedClassLevels` field computed server-side via `allowedClassLevels()`), and threaded it
through: `GlobalFilterBar.jsx`, `ClassPicker.jsx`, `AdminAssignments.jsx`'s assignment form,
`AdminQuizzes.jsx`'s quiz form, `QuestionBanks.jsx`'s create-bank and generate-quiz forms,
`MyPreferences.jsx`, and `AdminAnnouncements.jsx`'s target-class field. `Registry.jsx` and
`TeacherManagement.jsx` were deliberately left with the full hardcoded list since those routes are
admin-only (`ProtectedRoute role="admin"`) — an admin manages the whole school and should see every
class there regardless.

### Regression coverage
Re-ran the full click-through regression (Admin 13 pages, Teacher/Priya 8 pages, Student 5 pages,
Coordinator dashboard + 3 tabs + audit log) — zero console/500 errors. Added a new regression run
specifically for "John" (the pure Subject Teacher persona) clicking through all 8 of his available
pages — zero errors.

## 📝 Still Not Enforced At The Scope Level (honest remaining gaps)

Being explicit about what this round did **not** reach, so it isn't mistaken for "done":

- **Gradebook subject-specific analytics** (user's point 5: "Mathematics average, Mathematics
  attendance, Mathematics weak chapters" as computed dashboard metrics) — the dashboard now
  correctly *counts only in-scope rows* (e.g. `totalAssignments` only counts a Subject Teacher's
  own assignments), but there is no per-subject breakdown widget yet (e.g. "your Mathematics
  average is 74%, up from 68% last month") — that requires new aggregation queries, not just
  scope-filtering existing ones, and wasn't built this round.
- **Attendance module** — schema exists (`attendance_records` table, from Round 2) but **zero API
  routes or UI were built**. The user's point 6 (Class Teacher sees "Attendance" for their class)
  and point 2 (Subject Teacher's dashboard should show "Mathematics attendance") cannot work at
  all yet because there is no way to mark or query attendance anywhere in the app.
- **Behaviour, Homework tracking, Parent communication** (Class Teacher, point 6) — `behaviour_records`
  table exists from Round 2; zero routes/UI.
- **Exam Coordinator module** (point 9: exam schedules, question papers, seating plans,
  invigilators, report cards) — `exams`/`exam_schedule`/`exam_invigilators`/`exam_seating`/
  `exam_results` tables exist from Round 2 design work; zero routes/UI built. An Exam Coordinator
  today is only a permission-tier label with quiz/grade permissions, not a real exam module.
- **Academic Head / Principal dashboard** (point 8: department/class/teacher comparison, grade
  override workflow, approval queues) — the role and its broad permission grants exist and are
  enforced (an Academic Head is `unrestricted` in `resolveScope()`, matching "should view every
  class/subject/teacher/student"), but there's no dedicated comparison/approval UI — an Academic
  Head today just sees the regular admin/teacher screens with full (unfiltered) data, not a
  purpose-built principal dashboard.
- **Per-user permission override UI** — backend fully built (Round 2) and still correctly enforced
  (verified again this round that scope + permission checks compose correctly for every module
  touched), but no frontend screen to manage a specific teacher's individual overrides.
- **Notifications module scoping** — `notifyClass`/`notifyTeachersForClass` already existed from
  earlier sessions and are used correctly by the routes fixed this round (e.g. an announcement to
  Class 10 only notifies Class 10 students), but the notification *read/list* endpoints themselves
  were not audited this round for any remaining unscoped queries.
- **Messages** (point 1's list: "Different notifications... Messages") — there is no direct
  messaging/inbox feature in this codebase at all (notifications are one-way system alerts, not a
  two-way message thread) — out of scope for a session focused on closing existing scope-leak bugs
  rather than building a new communication primitive.


- **User-level permission overrides UI** — the backend (list/grant/revoke) is fully built and
  live-tested via curl (see above), but there is no dedicated frontend screen yet for an admin to
  browse/manage a specific user's overrides outside of the API — this would naturally live as a
  new tab inside Teacher Management or a per-user detail view.
- **Academic Head, Exam Coordinator dashboards** — role/permission grants exist and are seeded
  correctly (verified via `resolveAllPermissions`), but no dedicated frontend dashboard pages were
  built for these two roles this session (only Coordinator got a full dashboard).
- **Class Teacher's expanded cross-subject dashboard** — the scope engine already correctly grants
  Class Teachers full visibility of their homeroom class (`classSections` in `resolveScope()`),
  and this was exercised indirectly via the dashboard scope fix, but no dedicated Class Teacher UI
  (attendance, behaviour, subject-teacher-monitor table) was built.
- **Attendance & Behaviour modules** — schema tables (`attendance_records`, `behaviour_records`)
  were created and migrate cleanly, but zero API routes or UI exist yet — these are pure schema
  scaffolding for a future session.
- **Exam Management module** — schema tables (`exams`, `exam_schedule`, `exam_invigilators`,
  `exam_seating`, `exam_results`) created and migrate cleanly; zero routes/UI built.
- **2FA, session/device management, IP allowlisting, account lockout, password policies** — fully
  designed in §12 of the architecture doc; none implemented this session (would require new
  dependencies like `otplib` and non-trivial auth-flow changes best done as a dedicated session).
- **AI features, reporting/scheduled-exports, multi-school/multi-campus** — designed only, per
  the architecture doc's own recommendation to defer these given everything else in scope.

## Verified Compatibility With Prior Sessions' Work
This session's changes are purely additive to the schema and did not modify or regress: Teacher
Management, Question Banks, Assignment rubrics, Audit Log filters (Role/Device/Status columns
added in a prior session still work — Coordinator access to the same page was added on top), or
any student-facing workflow. Confirmed via the full regression pass above.
