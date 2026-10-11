# NITEX LMS — Enterprise RBAC, Academic Hierarchy & Multi-Role Architecture

**Status:** Architecture + partial reference implementation (this session).
**Grounded in:** the actual NITEX codebase (Express + better-sqlite3 + React/Vite), not a generic template.
**Companion:** see `IMPLEMENTATION_STATUS.md` for exactly what was built vs. designed-only this session.

---

## 0. Current-State Audit (why this redesign is necessary)

Before designing, here is what a code audit of the existing system found — this is the actual gap list this
architecture closes:

| Area | Current reality | Problem |
|---|---|---|
| Role model | `users.role` ∈ {admin, teacher, student} + `users.staff_role` ∈ {class_teacher, subject_teacher, coordinator, exam_controller, academic_head} | `staff_role` is a **label only**. `requireStaff` treats every teacher identically. Coordinator/Exam Controller/Academic Head have zero behavioral difference from Subject Teacher today. |
| Permission checks | Hardcoded `requireAdmin` / `requireStaff` / `requireElevatedStaff` in Express middleware | Not configurable. Admin cannot grant/revoke a single permission without a code change and redeploy. |
| Data scoping | `GET /api/dashboard/admin`, `GET /api/assignments`, `GET /api/quizzes` etc. query **all rows in the school** for any staff member | A Subject Teacher assigned only to "Class 10 Section A Mathematics" currently sees every class, every subject, every student. This directly violates the core requirement of this spec. |
| Attendance | **Does not exist** | Required by Class Teacher, Coordinator, Academic Head dashboards. |
| Behaviour / discipline | **Does not exist** | Required by Class Teacher dashboard. |
| Exam management (schedule, seating, admit cards, merit list) | **Does not exist** | Required by Exam Coordinator role to be meaningful (today Exam Controller = Subject Teacher + a badge). |
| Audit log | Exists (`audit_logs` table, `/api/audit`), append-only, has IP/device/status | Good foundation — this doc extends it, doesn't replace it. |
| Multi-school / multi-campus | **Not modeled at all** — single implicit school | Deferred in this session (see §17); schema is designed to bolt on cleanly. |

Everything below is designed to close these gaps **incrementally**, without a rip-and-replace, because the
existing `teacher_assignments`, `audit_logs`, `notifications`, and role-tier columns are sound primitives to
build the real permission engine on top of.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (React 19 + Vite)                    │
│  Role-aware Shell (AppLayout) → Sidebar built from PERMISSION MANIFEST   │
│  not from role name. Every route guarded by <RequirePermission perm=…>   │
│  Pages fetch pre-scoped data — server never trusts client-supplied scope │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │ HTTPS + JWT (Authorization: Bearer)
┌───────────────────────────────▼───────────────────────────────────────────┐
│                         API GATEWAY LAYER (Express)                       │
│  helmet, cors, rate-limit(auth), morgan                                   │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │ AUTH MIDDLEWARE          → verifies JWT, loads req.user            │   │
│  │ PERMISSION MIDDLEWARE    → requirePermission('assignment.create')  │   │
│  │ SCOPE MIDDLEWARE         → injects req.scope = resolveScope(user)  │   │
│  │                              { classLevels[], sections[], subjectIds[],│
│  │                                studentIds[]?, department? }        │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│  Every route handler receives req.scope and MUST filter its SQL by it.   │
│  A lint/CI rule + integration test suite enforces "no unscoped SELECT    │
│  on scoped tables for staff roles" (see §18, Edge Cases).                │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │
┌───────────────────────────────▼───────────────────────────────────────────┐
│                        BUSINESS LOGIC / SERVICE LAYER                     │
│  services/permissions.js   — permission resolution + caching              │
│  services/scope.js         — scope resolution (class/section/subject)     │
│  services/audit.js         — structured audit writer (existing, extended) │
│  services/notify.js        — role-aware notification routing (existing)   │
│  services/analytics.js     — aggregation queries per role                 │
│  services/ai/*             — pluggable AI providers (see §16)             │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │
┌───────────────────────────────▼───────────────────────────────────────────┐
│               DATA LAYER — SQLite (dev) / same schema on Postgres (prod)  │
│  Designed so the exact same schema.sql runs on Postgres with only         │
│  dialect-level changes (AUTOINCREMENT→SERIAL, datetime('now')→now()).     │
│  This is the "microservice-ready, API-first" requirement satisfied        │
│  without prematurely splitting into microservices (see §17).             │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why not microservices now:** a school LMS with "thousands of students, hundreds of teachers" is comfortably a
**modular monolith** workload (low tens of millions of rows, read-heavy). Splitting into services now adds
distributed-transaction complexity (e.g. "create assignment + notify + audit" must stay atomic) for no real
scaling benefit yet. The service-layer boundaries above (`permissions`, `scope`, `audit`, `notify`, `analytics`,
`ai`) are drawn so each can be extracted into its own deployable service later **without changing their public
function signatures** — that is what "microservice-ready" should mean in practice.

---

## 2. Database Schema — RBAC Core

### 2.1 New tables (additive — nothing existing is dropped)

```sql
-- ---------------------------------------------------------------------
-- ROLES: extensible beyond the 5 named tiers. A "role" is just a named,
-- ordered rank. New roles (Vice Principal, HOD, Counselor, Librarian,
-- Lab Instructor) are inserted here with no code change required for
-- their *existence* — only their permission grants need configuring.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,          -- 'system_admin','academic_head','coordinator','exam_coordinator',
                                      -- 'class_teacher','subject_teacher', or a future custom key
  label TEXT NOT NULL,               -- 'Academic Head / Principal'
  rank INTEGER NOT NULL,             -- lower = higher authority; used for hierarchy comparisons & escalation
  is_system_role INTEGER DEFAULT 0,  -- 1 = seeded, cannot be deleted (system_admin); custom roles = 0
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- PERMISSIONS: the atomic capability catalogue. Every permission has a
-- dotted key ('assignment.create', 'quiz.publish', 'grade.override',
-- 'audit.view', 'marks.export') and belongs to a module for grouping in
-- the admin UI's permission-matrix screen.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,          -- 'assignment.create'
  module TEXT NOT NULL,              -- 'assignments' | 'quizzes' | 'gradebook' | 'attendance' | 'exams' |
                                      -- 'content' | 'communication' | 'audit' | 'settings' | 'users' | 'reports'
  label TEXT NOT NULL,               -- 'Can Create Quiz'
  description TEXT,
  is_dangerous INTEGER DEFAULT 0,    -- flags perms like grade.override, marks.export for extra UI friction
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- PERMISSION GROUPS: named bundles an admin can assign in one click
-- ('Full Grading Rights' = grade.create+grade.edit+grade.comment).
-- Groups are just a UI/authoring convenience; enforcement always
-- resolves down to individual permission rows (see resolution algorithm
-- in §4).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permission_group_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE(group_id, permission_id)
);

-- ---------------------------------------------------------------------
-- ROLE → PERMISSION defaults ("Can Create Quiz: YES for Subject Teacher").
-- This is the base grant. effect ∈ ('allow','deny') so a role's DEFAULT
-- can explicitly deny a permission (useful for Coordinator: mostly
-- read-only, so 'assignment.create' is an explicit DENY at the role
-- level even though the permission itself exists in the catalogue).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  UNIQUE(role_id, permission_id)
);

-- ---------------------------------------------------------------------
-- USER-LEVEL OVERRIDES: "this specific teacher CANNOT export marks even
-- though Subject Teacher role normally can" or "this specific Coordinator
-- CAN publish quizzes as a one-off exception." Overrides always win over
-- role defaults (see resolution algorithm). expires_at makes an override
-- TEMPORARY per the spec ("Temporary Permissions").
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  reason TEXT,                        -- required in the admin UI when granting a deny/allow override
  granted_by INTEGER REFERENCES users(id),
  expires_at TEXT,                    -- NULL = permanent override; else auto-expires (checked at resolution time)
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, permission_id)
);

-- ---------------------------------------------------------------------
-- SCOPE ASSIGNMENTS: generalizes today's `teacher_assignments` table to
-- any role, any scope dimension, so "Coordinator scoped to Science
-- Department" or "Academic Head scoped to Senior Campus" is representable
-- the same way "Subject Teacher scoped to Class 10 Section A Maths" is.
-- teacher_assignments is KEPT AS-IS for backward compatibility and
-- because it is the most common case (subject+class+section) — this
-- table is additive, for roles/dimensions teacher_assignments can't
-- express (whole-department, whole-campus, whole-grade).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scope_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN (
    'school', 'campus', 'department', 'class_level', 'section', 'subject', 'student'
  )),
  scope_value TEXT NOT NULL,          -- e.g. class_level='10', section='A', subject='<subject_id>', department='Science'
  created_at TEXT DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_scope_assignments_user ON scope_assignments(user_id, scope_type);

-- ---------------------------------------------------------------------
-- Wire users.role_id → roles table (keeps existing users.role TEXT enum
-- as a fast-path/back-compat column; role_id is the source of truth for
-- permission resolution going forward). staff_role TEXT is DEPRECATED
-- in favor of role_id but kept populated in lockstep during migration
-- so nothing existing breaks.
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
```

### 2.2 New tables — Attendance (required for Class Teacher / Coordinator / Academic Head)

```sql
CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL,
  section TEXT,
  subject_id INTEGER REFERENCES subjects(id),  -- NULL = whole-day/homeroom attendance; set = subject-period attendance
  date TEXT NOT NULL,                          -- 'YYYY-MM-DD'
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused','half_day')),
  marked_by INTEGER REFERENCES users(id),
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, date, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance_records(class_level, section, date);
CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance_records(subject_id);
```

### 2.3 New tables — Behaviour / Discipline (Class Teacher)

```sql
CREATE TABLE IF NOT EXISTS behaviour_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('positive','negative','neutral')),
  type TEXT NOT NULL,             -- 'late_arrival','uniform_violation','helping_peer','achievement','fight', etc.
  description TEXT,
  severity TEXT DEFAULT 'low' CHECK(severity IN ('low','medium','high')),
  action_taken TEXT,
  reported_by INTEGER REFERENCES users(id),
  parent_notified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_behaviour_student ON behaviour_records(student_id);
```

### 2.4 New tables — Exam Management (Exam Coordinator)

```sql
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                 -- 'Final Term Examination 2026'
  academic_session_id INTEGER REFERENCES academic_sessions(id),
  exam_type TEXT DEFAULT 'term' CHECK(exam_type IN ('term','unit','supplementary','retest')),
  start_date TEXT, end_date TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','ongoing','completed','results_published')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_level INTEGER NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  exam_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
  max_marks INTEGER DEFAULT 100, passing_marks INTEGER,
  room TEXT,
  question_paper_status TEXT DEFAULT 'pending' CHECK(question_paper_status IN ('pending','submitted','approved','rejected')),
  question_paper_file TEXT,
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exam_schedule_exam ON exam_schedule(exam_id);

CREATE TABLE IF NOT EXISTS exam_invigilators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_schedule_id INTEGER NOT NULL REFERENCES exam_schedule(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  room TEXT
);

CREATE TABLE IF NOT EXISTS exam_seating (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_schedule_id INTEGER NOT NULL REFERENCES exam_schedule(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  room TEXT, seat_number TEXT,
  UNIQUE(exam_schedule_id, student_id)
);

CREATE TABLE IF NOT EXISTS exam_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_schedule_id INTEGER NOT NULL REFERENCES exam_schedule(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  marks_obtained REAL,
  grade TEXT,
  is_absent INTEGER DEFAULT 0,
  moderated_by INTEGER REFERENCES users(id),
  moderation_reason TEXT,
  entered_by INTEGER REFERENCES users(id),
  entered_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_schedule_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_results_student ON exam_results(student_id);
```

### 2.5 Entity-relationship summary (text form)

```
roles 1──* role_permissions *──1 permissions
users *──1 roles (via role_id)
users 1──* user_permission_overrides *──1 permissions
users 1──* scope_assignments
users 1──* teacher_assignments (existing: class_level+section+subject_id, is_class_teacher flag)

users(student) 1──* attendance_records *──1 subjects (nullable)
users(student) 1──* behaviour_records

exams 1──* exam_schedule *──1 subjects
exam_schedule 1──* exam_invigilators *──1 users(teacher)
exam_schedule 1──* exam_seating *──1 users(student)
exam_schedule 1──* exam_results *──1 users(student)

audit_logs *──1 users (existing, unchanged)
notifications *──1 users (existing, unchanged)
```

All new tables follow the codebase's existing conventions: `INTEGER PRIMARY KEY AUTOINCREMENT`,
`datetime('now')` defaults, `ON DELETE CASCADE` for owned child rows, `ON DELETE SET NULL`/no-cascade for
"actor" references (so deleting a teacher account never silently deletes grades/attendance they entered —
consistent with the "never delete, only disable" pattern already used for teacher accounts in this codebase).

---

## 3. Role Hierarchy & Permission Matrix

### 3.1 Seeded roles (extensible — see `roles` table)

| rank | key | label | typical scope |
|---|---|---|---|
| 0 | `system_admin` | System Admin | entire system, all schools |
| 1 | `academic_head` | Academic Head / Principal | entire school (all campuses if multi-campus) |
| 2 | `coordinator` | Coordinator | one or more departments/subjects, read-mostly |
| 2 | `exam_coordinator` | Exam Coordinator | entire school, exam module only |
| 3 | `class_teacher` | Class Teacher | one or more class+section (homeroom) |
| 4 | `subject_teacher` | Subject Teacher | one or more class+section+subject combos |

Rank is used for **escalation rules** (§18): a lower-rank user can never grant a permission they don't
themselves hold, and cannot assign a role with a lower rank number (more authority) than their own.

### 3.2 Full permission catalogue (seed data — grouped by module)

This is the literal seed list the admin's Permission Matrix screen renders and toggles. Every row becomes one
`permissions` table entry; `✓/✗` below is the **role default** seeded into `role_permissions`.

| Permission key | Label | Subject Teacher | Class Teacher | Coordinator | Exam Coordinator | Academic Head |
|---|---|:-:|:-:|:-:|:-:|:-:|
| `content.create` | Create learning content | ✓ (own subject) | ✗ | ✗ | ✗ | ✓ |
| `content.archive` | Archive content | ✓ (own subject) | ✗ | ✗ | ✗ | ✓ |
| `assignment.create` | Create Assignment | ✓ | ✗ | ✗ | ✗ | ✓ |
| `assignment.publish` | Publish Assignment | ✓ | ✗ | ✗ | ✗ | ✓ |
| `assignment.delete` | Delete Assignment | ✓ (own, ungraded only) | ✗ | ✗ | ✗ | ✓ |
| `quiz.create` | Create Quiz | ✓ | ✗ | ✗ | ✓ | ✓ |
| `quiz.publish` | Publish Quiz | ✓ | ✗ | ✗ | ✓ | ✓ |
| `quiz.delete` | Delete Quiz | ✓ (own, no attempts) | ✗ | ✗ | ✗ | ✓ |
| `grade.create` | Enter grades | ✓ (own subject) | ✗ | ✗ | ✓ (exam marks) | ✓ |
| `grade.override` | Override a grade after publish | ✗ | ✗ | ✗ | ✓ (moderation) | ✓ |
| `marks.export` | Export marks/results | ✗ | ✓ (own class) | ✗ | ✓ | ✓ |
| `attendance.mark` | Mark attendance | ✓ (own periods) | ✓ (homeroom) | ✗ | ✗ | ✓ |
| `attendance.override` | Edit past attendance | ✗ | ✓ (own class) | ✗ | ✗ | ✓ |
| `behaviour.record` | Log behaviour incident | ✗ | ✓ | ✗ | ✗ | ✓ |
| `exam.schedule` | Create/edit exam schedule | ✗ | ✗ | ✗ | ✓ | ✓ |
| `exam.approve_paper` | Approve question papers | ✗ | ✗ | ✗ | ✓ | ✓ |
| `exam.publish_results` | Publish exam results | ✗ | ✗ | ✗ | ✓ | ✓ (final approval) |
| `teacher.manage` | Create/edit/disable teacher accounts | ✗ | ✗ | ✗ | ✗ | ✗ *(admin-only, see §18)* |
| `teacher.evaluate` | Submit teacher performance evaluation | ✗ | ✗ | ✓ | ✗ | ✓ |
| `audit.view` | View audit logs | ✗ | ✗ | ✓ | ✗ | ✓ |
| `analytics.view_school_wide` | View school-wide analytics | ✗ | ✗ | ✓ | ✓ (exam analytics) | ✓ |
| `analytics.view_class` | View own class analytics | ✓ (own subject slice) | ✓ (full class) | ✓ | ✗ | ✓ |
| `communication.broadcast_school` | School-wide announcement | ✗ | ✗ | ✗ | ✗ | ✓ |
| `communication.broadcast_class` | Class-wide announcement | ✗ | ✓ | ✗ | ✗ | ✓ |
| `settings.permission_matrix` | Edit the permission matrix itself | ✗ | ✗ | ✗ | ✗ | ✗ *(admin-only)* |

> **Design note:** `teacher.manage` and `settings.permission_matrix` are intentionally **not grantable** to any
> non-admin role by default — per your own spec ("Only Admin can manage teacher accounts"). They still exist as
> rows in the `permissions` table (so the *catalogue* is complete and future-proof), but the admin UI visually
> locks them with a "System Admin only" badge and the backend additionally hard-checks `role.key === 'system_admin'`
> as a defense-in-depth backstop even if someone mis-configures `role_permissions` (see §12, Security).

### 3.3 Scope dimensions applied on top of permissions

A permission answers **"can this action ever be performed by this role"**; scope answers **"performed on
which rows."** Both must pass. E.g. `assignment.create = allow` for Subject Teacher role, but the *scope
middleware* still restricts `class_level`/`subject_id` on the INSERT to only combinations present in that
teacher's `teacher_assignments` rows — enforced server-side, never trusting a client-supplied `class_level`.

---

## 4. RBAC Implementation Strategy

### 4.1 Permission resolution algorithm (single source of truth)

```js
// services/permissions.js (design — see IMPLEMENTATION_STATUS.md for what's built)
function hasPermission(user, permissionKey) {
  // 1. System Admin bypass — always true, but still logged in audit trail as "admin override" when
  //    used on an action outside their normal role's default (transparency, not silent bypass).
  if (user.role_key === 'system_admin') return true;

  // 2. User-level override wins over everything else (explicit allow OR deny), IF not expired.
  const override = getActiveOverride(user.id, permissionKey); // checks expires_at > now()
  if (override) return override.effect === 'allow';

  // 3. Role default (role_permissions.effect).
  const roleGrant = getRoleGrant(user.role_id, permissionKey);
  if (roleGrant) return roleGrant.effect === 'allow';

  // 4. No explicit grant anywhere = deny by default (fail-closed, never fail-open).
  return false;
}
```

Cached per-request (resolved once into `req.permissions: Set<string>` by middleware), and cached server-side
for 60s per user in memory (invalidated immediately on any write to `role_permissions` /
`user_permission_overrides` for that user/role) to avoid a DB round-trip on every single request.

### 4.2 Scope resolution algorithm

```js
// services/scope.js (design)
function resolveScope(user) {
  if (['system_admin','academic_head'].includes(user.role_key)) {
    return { unrestricted: true }; // whole school (whole campus set, once multi-campus lands)
  }
  if (user.role_key === 'coordinator') {
    // scope_assignments rows of type 'department' or 'subject' for this coordinator
    return { departments: [...], subjectIds: [...] , unrestricted: false };
  }
  if (user.role_key === 'exam_coordinator') {
    return { unrestricted: true, moduleOnly: 'exams' }; // wide scope, but ONLY within the exam module
  }
  // class_teacher / subject_teacher: derive from teacher_assignments (existing table)
  const rows = db.prepare('SELECT * FROM teacher_assignments WHERE teacher_id = ?').all(user.id);
  return {
    unrestricted: false,
    // class_teacher gets ALL subjects for their homeroom class+section (is_class_teacher=1 rows)
    classSections: rows.filter(r => r.is_class_teacher).map(r => ({ class_level: r.class_level, section: r.section })),
    // subject_teacher gets only their specific class+section+subject triples
    subjectAssignments: rows.map(r => ({ class_level: r.class_level, section: r.section, subject_id: r.subject_id })),
  };
}
```

Every scoped route applies this as a SQL `WHERE` fragment builder, e.g.:

```js
function scopeWhereClause(scope, alias = 'a') {
  if (scope.unrestricted) return { sql: '1=1', params: [] };
  const clauses = scope.subjectAssignments.map(() => `(${alias}.class_level=? AND (${alias}.section=? OR ${alias}.section IS NULL) AND ${alias}.subject_id=?)`);
  const params = scope.subjectAssignments.flatMap(a => [a.class_level, a.section, a.subject_id]);
  return { sql: clauses.length ? `(${clauses.join(' OR ')})` : '1=0', params }; // 1=0 = "no assignments yet, see nothing" — fail-closed
}
```

**Fail-closed by design:** a teacher with zero `teacher_assignments` rows sees **nothing**, not everything —
this is the opposite of today's behavior and is the single most important correctness property of this
redesign.

### 4.3 Middleware composition (Express)

```js
router.post('/assignments',
  requireAuth,
  requirePermission('assignment.create'),   // NEW — replaces requireStaff
  injectScope,                              // NEW — sets req.scope
  validateScopeOnBody(['class_level','section','subject_id']), // NEW — 403s if body targets outside req.scope
  createAssignmentHandler
);
```

`requirePermission` and `injectScope` are pure additions; they compose with (don't replace) `requireAuth`.
`requireAdmin` remains, unchanged, for the handful of truly admin-only routes (teacher account CRUD, branding,
permission-matrix editing) per §3.2's design note.

### 4.4 Admin UI for the permission matrix

New page `Admin → Roles & Permissions`:
- Left: role list (5 seeded + any custom roles), each with an "Add Custom Role" button (name + rank + clone-from).
- Main panel: a matrix table — rows = permissions grouped by module (collapsible), columns = the selected
  role — each cell a 3-state toggle: **Allow / Deny / Inherit(unset)**.
- A separate "User Overrides" tab: search a specific user, see their effective permission set (role defaults +
  overrides merged, with overrides visually highlighted), add a new override with a required `reason` field and
  optional expiry date/time picker (temporary permissions).
- A live "Preview as this teacher" button that shows exactly what sidebar/dashboard that user would see —
  critical for admins to verify configuration before saving (avoids the classic RBAC misconfiguration bug class).

---

## 5. Dashboard Layouts Per Role

All dashboards share the existing `AppLayout` shell (sidebar + topbar + notification bell) already in the
codebase; only the **sidebar link set** and **dashboard widget composition** change per role, driven by the
permission manifest (§9.3), not by hardcoded role checks in the sidebar component.

### 5.1 Subject Teacher — `/teacher/dashboard`
Widget grid (top → bottom, 3-column responsive):
`[Assigned Students][Active Students][Avg Subject Performance]`
`[Assignment Completion %][Quiz Completion %][Pending Reviews badge-linked to grading queue]`
`[Upcoming Lessons timeline][Upcoming Exams][Weak Students list w/ AI flag]`
`[Top Performers][Recent Activity feed][AI Recommendations panel]`
Scoped strictly to their `teacher_assignments` rows — the class/subject picker at the top only ever lists
their own combinations (never a blank "All Classes" option, since "all" isn't meaningful for this role).

### 5.2 Class Teacher — `/teacher/dashboard` (same route, different widget set — resolved by role)
`[Total Students][Today's Attendance %][Overall Academic Progress][Discipline Incidents (30d)]`
`[Assignment Completion — all subjects][Quiz Completion — all subjects][Student Risk Index heat-strip]`
`[Subject Teacher Monitor table: subject | teacher | syllabus% | pending grading | last activity]`
`[Class Calendar][Birthdays this week][Parent Engagement %][Upcoming PTMs]`

### 5.3 Coordinator — `/coordinator/dashboard`
`[School/Department Overview cards][Teacher Workload heat-map][Login Activity timeline]`
`[Completion Rate by Subject][Exam Performance trend][Pending Reviews across all teachers]`
`[Missing Content / Unfinished Syllabus alerts][Parent/Student Complaints inbox]`
`[Embedded Audit Log widget — last 20 events, "View Full Audit Log" link]`
Read-mostly: every action button that would mutate data is hidden entirely (not just disabled) unless an
explicit override grants it — consistent with "Coordinator should mostly have read-only permissions."

### 5.4 Academic Head — `/academic-head/dashboard`
Everything in Class Teacher's dashboard **aggregated across the whole school**, plus:
`[Department Comparison bar chart][Teacher Evaluation summary][Curriculum Coverage %]`
`[Approval Queue: results pending approval | grade override requests | policy sign-offs]`
`[Institution-wide Analytics: attendance trend, learning outcomes, academic risk index]`

### 5.5 Exam Coordinator — `/exam-coordinator/dashboard`
`[Upcoming Exams calendar][Question Paper Approval Queue][Invigilator Assignment status]`
`[Seating Plan Generator shortcut][Missing Marks alert][Result Compilation progress bar]`
`[Merit List preview][Pass % by class][Exam-day operational checklist]`

---

## 6–8. UI/UX Flow, Navigation, Component Hierarchy

### 6.1 Navigation structure (permission-driven, not role-name-driven)

```
Sidebar.jsx (redesigned)
 └─ buildNavForUser(user, permissions) → NavSection[]
      NavSection { label, items: NavItem[] }
      NavItem { to, label, icon, requiredPermission? }  // rendered only if hasPermission(user, requiredPermission)
```
This replaces today's `isAdmin/isTeacher` boolean branching with a data-driven manifest (see §9.3 for the
concrete manifest object) — this is *the* mechanism that makes "every teacher experiences a completely
different LMS" true without N hardcoded UI variants.

### 6.2 Global UX additions required by the spec
- **Command palette** (`Cmd/Ctrl+K`): fuzzy-searches across pages, students (scoped!), assignments, quizzes —
  implemented client-side over a `/api/search?q=` endpoint that itself applies `req.scope`.
- **Breadcrumbs**: `AppLayout` gets an optional `breadcrumbs` prop; deep pages (e.g. Coordinator → Teacher
  Detail → Audit Trail) show `Coordinator / Teachers / Priya Sharma / Audit Trail`.
- **Bulk actions**: gradebook and attendance tables get row-selection checkboxes + a sticky action bar
  ("Mark 24 selected present", "Export selected").

### 6.3 Frontend component hierarchy (new pieces only — existing ones unchanged)

```
App.jsx
 └─ PermissionProvider (NEW context; wraps AuthProvider) — fetches /api/auth/me/permissions once, exposes
    usePermission('assignment.create') hook used everywhere instead of user.role === 'admin' checks
 └─ Sidebar.jsx (rewritten to consume PermissionProvider + buildNavForUser)
 └─ pages/
     coordinator/
       Dashboard.jsx, TeacherWorkload.jsx, AuditLogEmbedded.jsx (reuses existing AuditLog table component)
     class-teacher/
       ClassDashboard.jsx, Attendance.jsx, Behaviour.jsx, SubjectTeacherMonitor.jsx
     academic-head/
       InstitutionDashboard.jsx, DepartmentComparison.jsx, ApprovalQueue.jsx
     exam-coordinator/
       ExamSchedule.jsx, PaperApproval.jsx, SeatingPlan.jsx, ResultCompilation.jsx, MeritList.jsx
     admin/
       RolesPermissions.jsx (the permission-matrix editor from §4.4)
 └─ components/
     RequirePermission.jsx  — <RequirePermission perm="audit.view"><AuditWidget/></RequirePermission>
     ScopePicker.jsx         — replaces raw <ClassPicker>/<GlobalFilterBar> with one that's pre-populated
                                from the user's actual scope (never shows an option outside it)
```

---

## 9. API Endpoints (REST — additive to existing `/api/*`)

```
# Permission engine
GET    /api/roles                              list roles                              [academic_head, system_admin]
POST   /api/roles                               create custom role                      [system_admin]
GET    /api/permissions                         full permission catalogue               [system_admin]
GET    /api/roles/:id/permissions               role's permission grants                [system_admin]
PUT    /api/roles/:id/permissions               bulk-set role grants (the matrix save)   [system_admin]
GET    /api/users/:id/permissions               effective permissions (resolved)         [system_admin, self]
POST   /api/users/:id/permission-overrides      grant/deny override (reason required)     [system_admin]
DELETE /api/permission-overrides/:id            revoke an override                        [system_admin]
GET    /api/auth/me/permissions                 current user's resolved permission set + scope summary  [any]

# Attendance
GET    /api/attendance?class_level=&section=&date=       [attendance.mark or attendance.override, scoped]
POST   /api/attendance/bulk                     mark a whole class/section for one date   [attendance.mark, scoped]
PUT    /api/attendance/:id                      edit one record                           [attendance.override, scoped]
GET    /api/attendance/student/:id/summary      % present, streak, trend                  [scoped]

# Behaviour
GET    /api/behaviour?student_id=&class_level=  [behaviour.record or read via analytics.view_class, scoped]
POST   /api/behaviour                           log incident                              [behaviour.record, scoped]

# Coordinator monitoring
GET    /api/coordinator/teacher-workload        assignments/quizzes/grading load per teacher   [analytics.view_school_wide or department-scoped]
GET    /api/coordinator/login-activity          from audit_logs, action='login'                [audit.view]
GET    /api/coordinator/pending-reviews         cross-teacher ungraded submissions              [scoped]
GET    /api/coordinator/syllabus-completion     content vs. curriculum plan                     [scoped]

# Exam management
POST   /api/exams                               [exam.schedule]
POST   /api/exams/:id/schedule                  add subject/date/room rows                      [exam.schedule]
POST   /api/exam-schedule/:id/question-paper    upload + submit for approval                      [subject teacher, own subject]
PUT    /api/exam-schedule/:id/approve-paper     [exam.approve_paper]
POST   /api/exam-schedule/:id/invigilators      [exam.schedule]
POST   /api/exam-schedule/:id/seating/generate  auto-generate seating plan                       [exam.schedule]
POST   /api/exam-results/bulk                   enter marks                                       [grade.create, scoped to exam module]
PUT    /api/exam-results/:id/moderate           [grade.override]
POST   /api/exams/:id/publish-results           [exam.publish_results]
GET    /api/exams/:id/merit-list                [analytics.view_school_wide]

# Reports
GET    /api/reports/:reportKey?format=pdf|xlsx|csv&scope=...
POST   /api/reports/schedule                    recurring email report                            [reports.schedule]
```

Every one of these follows the existing codebase's pattern exactly: `Router()`, `db.prepare(...).run/get/all`,
`logAudit(req, {...})` on every mutation, `notifyX(...)` where relevant — no new framework introduced.

---

## 10–11. Backend Business Logic & Frontend State Management

- **Business logic placement:** validation + scope-checks live in Express route handlers (matches existing
  codebase style — no separate "controller" layer was introduced elsewhere, so this doc doesn't invent one
  either); *cross-cutting* logic (permission resolution, scope resolution, audit writing) lives in
  `server/src/services/*.js`, imported by routes — mirroring the existing `utils/audit.js`, `utils/notify.js`
  pattern, just promoted to a `services/` folder since it's genuinely business logic, not a utility.
- **Frontend state:** the codebase already uses React Context for `Auth`, `Settings`, `Toast`, `Gamification`
  — no Redux/Zustand exists and none is needed at this scale. Add one more: `PermissionContext`
  (`{ permissions: Set<string>, scope: ScopeSummary, hasPermission(key) }`), populated once from
  `GET /api/auth/me/permissions` right after login, refreshed on any 403 response (in case permissions changed
  server-side mid-session) via the existing axios response interceptor in `api/client.js`.

---

## 12. Security Architecture

| Requirement from spec | Design |
|---|---|
| RBAC | §2–4 above |
| Permission Matrix | §4.4 |
| JWT Authentication | Already implemented (`jsonwebtoken`, 7-day expiry). **Recommend** shortening to 2h access + refresh token for production hardening. |
| Session Management | Add a `sessions` table (`id, user_id, device_label, ip, user_agent, created_at, last_seen_at, revoked_at`) so "Device Management" (see below) and "force logout everywhere" are possible — JWTs alone can't be revoked without this. |
| Two-Factor Authentication | New `users.totp_secret`, `users.totp_enabled`; TOTP (RFC 6238) via a small dependency (`otplib`); enforced optionally per-role (Academic Head/Coordinator can be required to enable 2FA via a `roles.require_2fa` flag). |
| IP Restrictions | New `role_ip_allowlist(role_id, cidr)` table; checked in `requireAuth` for roles that opt in — mainly useful for Academic Head/System Admin from a fixed campus network. |
| Device Management | `sessions` table above + a "My Devices" page showing active sessions with a "Revoke" button (marks `revoked_at`, and `requireAuth` checks the session hasn't been revoked, not just that the JWT signature is valid — this is why the `sessions` table is necessary even with JWTs). |
| Activity/Audit Logs | Existing `audit_logs` — extended in this doc's §14. |
| Data Encryption | Passwords already `bcryptjs` hashed (✓). **Add:** encrypt `users.totp_secret` at rest with a server-side key (`AES-256-GCM` via Node `crypto`), never log it, never return it in any API response after initial setup. |
| Password Policies | New `settings` keys: `password_min_length`, `password_require_number`, `password_require_symbol`, `password_expiry_days`, `password_history_count` (prevent reuse of last N) — enforced in `auth.js` register/reset-password handlers. |
| Permission Inheritance | §4.1 resolution order. |
| Permission Overrides | `user_permission_overrides` table (§2.1). |
| Temporary Access | `expires_at` on overrides (§2.1); also applicable to `scope_assignments` via an optional `expires_at` column for e.g. "substitute teacher access for 2 weeks." |
| Account Lockout | New `users.failed_login_count`, `users.locked_until`; increment on failed login (already logged to `audit_logs` as `failed_login`), lock after N (configurable) attempts for M minutes, auto-clear on success. |

**Defense in depth for RBAC specifically:** the permission-matrix admin UI is powerful — a misconfiguration
could accidentally grant `teacher.manage` broadly. Mitigations: (1) `teacher.manage` and
`settings.permission_matrix` are hard-coded system-admin-only in code regardless of matrix state (§3.2); (2)
every change to `role_permissions` or `user_permission_overrides` is itself audit-logged with before/after
JSON (module=`settings`, action=`permission_changed`) — satisfying the spec's own audit requirement
("Permission Changed" event) and providing a rollback trail; (3) the "Preview as this teacher" tool (§4.4) lets
an admin verify before saving.

---

## 13. Audit Logging Architecture (extends the existing, working `audit_logs` table)

Already implemented and working today: `module, action, description, ip_address, user_agent, status
(success/failure), previous_value, new_value, metadata` — with filters for module/action/role/status/search/date
range, CSV export, and a per-user timeline. This satisfies the large majority of the spec's audit requirements
already. What this redesign **adds**:

1. **New action vocabulary** for the new modules — `attendance_modified`, `behaviour_logged`,
   `exam_scheduled`, `question_paper_approved`, `result_published`, `permission_changed`,
   `role_assigned`, `override_granted`, `override_revoked`, `parent_viewed_report` — all logged via the
   existing `logAudit()` call, no schema change needed for this part (module/action are free-text columns
   already).
2. **`reason` field surfaced end-to-end**: today's `metadata` JSON column can already carry a `reason` — this
   doc formalizes that every "deny→allow" or grade-override or attendance-correction mutation MUST populate
   `metadata.reason`, and the Audit Log UI renders it as its own column when present (small, additive frontend
   change).
3. **Coordinator-embedded audit widget**: a `GET /api/audit?role=teacher&limit=20` call reused directly by the
   Coordinator dashboard (§5.3) — no new backend endpoint required, just a new consumer of the existing one.
4. **Retention & export**: existing CSV export capped at 5,000 rows — for enterprise scale, add a
   `POST /api/audit/export-async` that writes to a file and emails a download link for exports beyond that
   cap (relevant once "thousands of students" generates high audit volume).

---

## 14. Notification Architecture (extends existing `notifications` table + `notify.js`)

Already implemented: `notifyUser`, `notifyClass`, `notifyAdmins`, `notifyStaff`, and this session's new
`notifyTeachersForClass` (scoped via `teacher_assignments`). This redesign adds:

```js
// notifyByPermission({ permission, scopeFilter, type, title, body, link, related_id })
// Finds every user who currently holds `permission` (role default OR override) AND whose
// resolveScope() overlaps scopeFilter — e.g. notifyByPermission({ permission: 'exam.approve_paper', ... })
// reaches whichever human(s) are actually the Exam Coordinator(s) today, without hardcoding "role=exam_coordinator"
// in the notification call site — so if tomorrow a Vice Principal is also granted exam.approve_paper, they're
// automatically included with zero code change.
```

Per-role notification triggers (mapping spec requirements to concrete emitter call sites):

| Role | Trigger | Emitter |
|---|---|---|
| Subject Teacher | submission received | existing `notifyTeachersForClass` (this session) |
| Subject Teacher | student question posted | new: `notifyTeachersForClass` on new `discussion_questions` table (future module, not built this session) |
| Class Teacher | attendance below threshold 3 days running | new scheduled job (`node-cron`) → `notifyUser` |
| Class Teacher | parent message received | new: `notifyUser` on new `messages` table (future module) |
| Coordinator | teacher inactive > N days (no login in `audit_logs`) | new scheduled job querying `audit_logs` |
| Academic Head | grade-override or result-approval request | `notifyByPermission({ permission: 'grade.override' or 'exam.publish_results' ... })` |
| Exam Coordinator | question paper submitted for approval | `notifyByPermission({ permission: 'exam.approve_paper', ... })` |

---

## 15. AI Integration Opportunities (pluggable, not vendor-locked)

```
server/src/services/ai/
  provider.js         — thin interface: generateQuiz(spec), summarizeProgress(studentId), predictRisk(studentId)
  providers/openai.js, providers/local.js (rule-based fallback so the feature still works with zero API key)
```

Concrete, buildable features (ranked by implementation cost vs. value, using data that **already exists** in
this schema — not speculative):

1. **Weak-topic detection (cheapest, already has data)** — this session's `dashboard.js` already computes
   `weakTopics` from `quiz_attempts` grouped by `q.topic` having avg < 70%. This exists today for students;
   **extend it** to the Subject Teacher dashboard's "Weak Students" / "Students Needing Attention" widgets —
   pure SQL aggregation, no external AI call needed, ships first.
2. **Risk index (rule-based, no ML needed initially)** — a weighted score per student:
   `risk = w1*(1-attendance%) + w2*(1-assignment_completion%) + w3*(1-avg_quiz_pct) + w4*(behaviour_negative_count)`
   — computed in SQL/JS, surfaced on Class Teacher & Academic Head dashboards as "Student Risk Index." This is
   genuinely "AI-flavored" (predictive, actionable) without needing an LLM or trained model — appropriate for
   a v1.
3. **AI Question Generator** — `providers/openai.js` call given `{ subject, topic, difficulty, bloom_level,
   count }`, returns MCQ/short-answer drafts inserted as `question_bank_items` with `status='ai_draft'`
   requiring teacher review before use (never auto-publish AI content — a scoped `is_dangerous` permission
   `quiz.publish_ai_generated` gates this).
4. **Grading-inconsistency detection** — flag when the same teacher's grade distribution for one assignment
   has unusually high variance vs. their historical average (simple z-score on `submissions.grade`), surfaced
   to Coordinator as "Review Suggested."
5. **AI Rubric Generator / Summarize Student Progress** — same pluggable provider, low risk since output is
   always a draft a human approves.

All AI features are additive service calls behind a feature flag in `settings` (`ai_enabled`), so the system is
fully functional with AI **off** (features 1–2 don't even need the flag since they're pure SQL).

---

## 16. Reporting Architecture

```
GET /api/reports/:reportKey?format=pdf|xlsx|csv&...scopeParams
```
- `reportKey` catalogue seeded per role (e.g. `class_progress_report`, `subject_gradebook`,
  `attendance_summary`, `exam_merit_list`, `teacher_workload_report`, `audit_export`).
- PDF via `pdfkit` (lightweight, no headless-browser dependency — appropriate given this app has no existing
  PDF generation); Excel/CSV via `exceljs` / the existing hand-rolled CSV pattern already used in
  `audit.js`'s `/export` endpoint (keep consistent with that style rather than introducing a new library for
  CSV).
- `scheduled_reports(id, report_key, params_json, cron_expr, recipient_user_id, last_run_at)` table + a
  `node-cron` worker that renders and emails the report (Nodemailer, SMTP configured via `settings`) — this is
  the "Scheduled Reports / Email Reports" requirement.
- Every report generation is itself audit-logged (`module: 'reports', action: 'exported'`) — satisfies "Export
  Performed" from the spec's own audit example list.

---

## 17. Scalability Considerations

- **Multi-school / multi-campus (designed, not built this session):** add `schools(id, name, ...)` and
  `campuses(id, school_id, name, ...)` tables; add nullable `school_id`/`campus_id` FKs to `users`, `subjects`,
  `assignments`, `quizzes`, `attendance_records`, etc. Because SQLite/Postgres both support nullable FKs added
  via `ALTER TABLE ... ADD COLUMN`, this is a **non-breaking additive migration** — existing single-school data
  simply gets `school_id = 1` backfilled. `resolveScope()` (§4.2) already returns a scope object; adding
  `schoolIds`/`campusIds` to that object and threading it into the same `scopeWhereClause()` builder is the
  only code-level change needed later — this is *why* the scope-object abstraction is designed the way it is
  now, rather than hardcoding class/section/subject filters ad hoc per query as the current codebase does.
- **Postgres migration path:** schema.sql avoids SQLite-only features (no `WITHOUT ROWID`, no SQLite-specific
  pragmas in table definitions) so a `sqlite→postgres` port is a dialect-translation exercise, not a redesign.
- **Read scaling:** heavy aggregation endpoints (Coordinator/Academic Head analytics) should get a
  materialized nightly rollup table (`daily_class_stats`, `daily_teacher_stats`) once row counts justify it —
  documented here so it isn't a surprise later, not built now (premature at current scale).
- **API-first:** all functionality already goes through `/api/*` JSON endpoints (no server-rendered HTML) — a
  future mobile app or third-party integration consumes the exact same API the React SPA does. No change
  needed to satisfy this requirement; it's already true of the codebase's architecture.
- **Multi-language:** add `i18n` JSON resource files + a `users.locale` column + wrap UI strings — deferred
  (large mechanical effort, zero architecture risk, doesn't block anything else in this doc).

---

## 18. Edge Cases & Permission Conflict Handling

| Scenario | Resolution |
|---|---|
| Role default says DENY, user override says ALLOW | Override wins (§4.1 step 2 before step 3). |
| Two overrides somehow exist for same user+permission | Schema `UNIQUE(user_id, permission_id)` makes this impossible at the DB level — an upsert, not an insert, is required in the API handler. |
| Override has `expires_at` in the past | Resolution algorithm treats it as absent (falls through to role default) — a cleanup cron can later hard-delete expired rows, but correctness never depends on that cron running. |
| Teacher has zero `teacher_assignments` rows | Sees **nothing** in scoped modules (fail-closed) + a dashboard empty-state: "You have no class/subject assignments yet. Contact your administrator." — never silently falls back to "show everything," which is today's actual bug. |
| Coordinator scoped to "Science" department, but a Science teacher also teaches Math | Coordinator sees that teacher's Science-subject activity only; the teacher's Math activity is invisible to this Coordinator — scope filters are per-assignment-row, not per-teacher. |
| Class Teacher for 10-A, also Subject Teacher for 10-B Math | Both scope grants are additive (union), not exclusive — `resolveScope()` merges `classSections` (full access) with `subjectAssignments` (narrow access) independently; UI shows 10-A with full "all subjects" view and 10-B with only "Mathematics." |
| Academic Head tries to override a grade for a class that's already had results published+approved | Requires `exam.publish_results` reversal step first (an explicit "Reopen Results" action, itself audit-logged with mandatory `reason`) — prevents silent post-approval tampering. |
| A custom role (e.g. "Librarian") is created with no permissions granted yet | Logs in successfully, sees an empty sidebar except Profile/Settings + the "no assignments" empty state — never errors, never defaults to any implicit access. |
| Two admins edit the permission matrix simultaneously | Last-write-wins at the row level (`role_permissions` UNIQUE constraint means it's an upsert); every save is audit-logged with full before/after snapshot so conflicting edits are at least visible/recoverable, not silently lost without a trace. |
| A permission is deleted from the catalogue (module deprecated) | `ON DELETE CASCADE` on `role_permissions`/`user_permission_overrides` cleans up references automatically — no orphaned rows, no dangling permission checks (`hasPermission` simply returns false for a key that no longer exists in the catalogue, which is safe/fail-closed). |
| Session revoked (device management) but JWT not yet expired | `requireAuth` checks `sessions.revoked_at IS NULL` in addition to JWT signature validity (§12) — this is precisely why the `sessions` table is required, not optional, once Device Management ships. |

---

## 19. Future Extensibility Plan

- **New roles** (Vice Principal, HOD, Counselor, Librarian, Lab Instructor): insert a `roles` row + configure
  `role_permissions` via the admin UI — **zero code deployment required**. This is the concrete, testable proof
  that the architecture satisfies "extensible so new roles can be added later without changing the
  architecture."
- **New permissions** as new modules ship (e.g. a future Library module ships with `library.checkout`,
  `library.manage_catalogue`): add rows to `permissions`, wire `requirePermission('library.checkout')` into the
  new routes — the RBAC engine itself never changes.
- **New scope dimensions** (e.g. "House" for a boarding school): add a new `scope_type` enum value and a
  branch in `resolveScope()` / `scopeWhereClause()` — additive, not a rewrite.
- **GraphQL layer**: if/when needed, it can wrap the existing `services/*` functions (permission + scope
  resolution logic is already decoupled from Express-specific request/response objects) — another reason that
  logic lives in `services/`, not inline in route handlers.

---

## 20. Best Practices Applied (why this is competitive with Classroom/Moodle/Canvas/Blackboard/Teams)

1. **Fail-closed scoping** (§4.2) is stricter than several legacy school ERPs that fail-open on misconfiguration.
2. **Permission catalogue as data, not code** (§2–4) matches how Canvas/Moodle's own role-permission systems
   work internally (Moodle's `mdl_role_capabilities` is directly analogous to this design's `role_permissions`).
3. **Every mutation audit-logged with before/after + reason** exceeds what Google Classroom exposes to admins
   at all (Classroom has almost no admin-facing audit trail) — this is a genuine differentiator worth keeping
   as a selling point.
4. **Command palette + permission-driven nav** brings the UX up to modern SaaS standard (Linear/Notion-style),
   which none of the incumbent school LMS products do well.
5. **AI features built on data already collected** (§16, item 1–2) rather than bolted-on chatbots ships real
   value first, expensive LLM integration second — avoids the common failure mode of "AI-washing" a product.
