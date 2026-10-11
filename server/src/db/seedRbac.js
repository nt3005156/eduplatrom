// Enterprise RBAC seed data — roles, the full permission catalogue, and each
// role's default grants. Idempotent: safe to run on every boot (uses
// INSERT OR IGNORE / upsert-style logic), so new permissions/roles can be
// added to these lists in future releases without a numbered migration
// system, matching this codebase's existing seed.js convention.
//
// See docs/RBAC_ENTERPRISE_ARCHITECTURE.md §3.1-3.2 for the full rationale
// behind every role and permission default listed here.

// rank: lower number = higher authority (used for escalation checks).
export const ROLES = [
  { key: 'system_admin', label: 'System Admin', rank: 0, is_system_role: 1, description: 'Full system access across all schools.' },
  // Guardians have no staff grants. Their access is decided by guardian_students links (services/guardians.js),
  // so this role intentionally has no role_permissions rows: every staff permission check fails closed.
  { key: 'guardian', label: 'Guardian / Parent', rank: 6, is_system_role: 1, description: 'Parent or guardian. Sees only linked children, read-only.' },
  { key: 'academic_head', label: 'Academic Head / Principal', rank: 1, is_system_role: 1, description: 'Highest academic authority for the whole school.' },
  { key: 'coordinator', label: 'Coordinator', rank: 2, is_system_role: 1, description: 'Academic monitoring role — mostly read-only.' },
  { key: 'exam_coordinator', label: 'Exam Coordinator', rank: 2, is_system_role: 1, description: 'Owns the examinations module school-wide.' },
  { key: 'class_teacher', label: 'Class Teacher', rank: 3, is_system_role: 1, description: 'Homeroom teacher — full visibility of one class across all subjects.' },
  { key: 'subject_teacher', label: 'Subject Teacher', rank: 4, is_system_role: 1, description: 'Default teaching tier — scoped to assigned class/section/subject only.' },
];

// module groups the permission for the admin's Permission Matrix UI.
//
// NOTE: only permissions that are actually enforced somewhere in the real
// app belong here. Attendance, Behaviour, Examinations, "Export Marks," and
// "Submit Teacher Evaluation" were previously listed (and shown as
// toggleable in the Roles & Permissions matrix) even though none of those
// modules exist anywhere in the codebase — no routes, no UI, nothing for
// the toggle to actually control. That's actively misleading: an admin
// could untick "Can Mark Attendance" and reasonably believe they'd just
// locked a teacher out of an Attendance feature that, in reality, never
// existed to lock. Removed until those modules are actually built — at
// that point the permission and its enforcement should ship together in
// the same change, never a permission-only stub ahead of real functionality.
export const PERMISSIONS = [
  // content
  { key: 'content.create', module: 'content', label: 'Create learning content', description: 'Upload notes/videos/PDFs for an assigned subject.' },
  { key: 'content.archive', module: 'content', label: 'Archive content', description: '' },
  // assignments
  { key: 'assignment.create', module: 'assignments', label: 'Can Create Assignment', description: '' },
  { key: 'assignment.publish', module: 'assignments', label: 'Can Publish Assignment', description: '' },
  { key: 'assignment.delete', module: 'assignments', label: 'Can Delete Assignment', description: '' },
  // quizzes
  { key: 'quiz.create', module: 'quizzes', label: 'Can Create Quiz', description: '' },
  { key: 'quiz.publish', module: 'quizzes', label: 'Can Publish Quiz', description: '' },
  { key: 'quiz.delete', module: 'quizzes', label: 'Can Delete Quiz', description: '' },
  // gradebook
  { key: 'grade.create', module: 'gradebook', label: 'Can Enter Grades', description: '' },
  { key: 'grade.override', module: 'gradebook', label: 'Can Override Grades', description: 'Change a grade after it has already been published — used by the Academic Head approval workflow.', is_dangerous: 1 },
  // teachers / admin
  { key: 'teacher.manage', module: 'users', label: 'Can Manage Teacher Accounts', description: 'Create/edit/disable teacher accounts.', is_dangerous: 1, admin_only: 1 },
  // audit / analytics
  { key: 'audit.view', module: 'audit', label: 'Can View Audit Logs', description: '' },
  { key: 'analytics.view_school_wide', module: 'reports', label: 'Can View School-Wide Analytics', description: '' },
  { key: 'analytics.view_class', module: 'reports', label: 'Can View Own Class/Subject Analytics', description: '' },
  // communication
  // attendance — enforced by routes/attendance.js (scope-checked per class/section/subject)
  { key: 'attendance.mark', module: 'attendance', label: 'Can Mark Attendance', description: 'Record attendance for classes and subjects within the teacher\'s own scope.' },
  { key: 'attendance.view', module: 'attendance', label: 'Can View Attendance Reports', description: 'View attendance registers and summaries within scope.' },
  { key: 'communication.broadcast_school', module: 'communication', label: 'Can Broadcast School-Wide Announcement', description: '' },
  { key: 'communication.broadcast_class', module: 'communication', label: 'Can Broadcast Class Announcement', description: '' },
  // settings
  { key: 'settings.permission_matrix', module: 'settings', label: 'Can Edit Permission Matrix', description: '', is_dangerous: 1, admin_only: 1 },
];


// Role defaults: role_key -> { permission_key: 'allow' | 'deny' }.
// Anything not listed for a role resolves to deny (fail-closed) at
// resolution time — see services/permissions.js.
export const ROLE_DEFAULTS = {
  subject_teacher: {
    'content.create': 'allow', 'content.archive': 'allow',
    'assignment.create': 'allow', 'assignment.publish': 'allow', 'assignment.delete': 'allow',
    'quiz.create': 'allow', 'quiz.publish': 'allow', 'quiz.delete': 'allow',
    'grade.create': 'allow',
    'analytics.view_class': 'allow',
    // Subject Teachers can announce to their own assigned class/section
    // about their subject (e.g. "Math test moved to Friday") — scoped to
    // their own classes via isWithinScope() in routes/announcements.js, they
    // just can't broadcast school-wide (that stays Academic-Head-only).
    'communication.broadcast_class': 'allow',
    'attendance.mark': 'allow', 'attendance.view': 'allow',
  },
  class_teacher: {
    'content.create': 'allow', 'content.archive': 'allow',
    'assignment.create': 'allow', 'assignment.publish': 'allow', 'assignment.delete': 'allow',
    'quiz.create': 'allow', 'quiz.publish': 'allow', 'quiz.delete': 'allow',
    'grade.create': 'allow',
    'analytics.view_class': 'allow',
    'communication.broadcast_class': 'allow',
    'attendance.mark': 'allow', 'attendance.view': 'allow',
  },
  coordinator: {
    'audit.view': 'allow',
    'analytics.view_school_wide': 'allow',
    'analytics.view_class': 'allow',
    'attendance.view': 'allow',
    // explicit denies to make the "mostly read-only" intent visible/auditable
    // in the matrix, not just an absence of a grant.
    'assignment.create': 'deny', 'quiz.create': 'deny', 'grade.override': 'deny',
  },
  exam_coordinator: {
    'quiz.create': 'allow', 'quiz.publish': 'allow',
    'grade.create': 'allow', 'grade.override': 'allow',
    'analytics.view_school_wide': 'allow',
  },
  academic_head: {
    'content.create': 'allow', 'content.archive': 'allow',
    'assignment.create': 'allow', 'assignment.publish': 'allow', 'assignment.delete': 'allow',
    'quiz.create': 'allow', 'quiz.publish': 'allow', 'quiz.delete': 'allow',
    'grade.create': 'allow', 'grade.override': 'allow',
    'audit.view': 'allow',
    'analytics.view_school_wide': 'allow', 'analytics.view_class': 'allow',
    'communication.broadcast_school': 'allow', 'communication.broadcast_class': 'allow',
    'attendance.view': 'allow',
    // teacher.manage / settings.permission_matrix intentionally NOT granted —
    // admin_only=1 hard-locks these to system_admin regardless (see
    // services/permissions.js), but we also don't grant them here so the
    // matrix UI accurately reflects "not available to this role."
  },
  system_admin: {
    // system_admin bypasses permission checks entirely in code (see
    // services/permissions.js hasPermission()) — no rows needed here, but we
    // seed 'allow' for every permission anyway so the matrix UI displays a
    // fully-checked column for System Admin instead of looking unconfigured.
  },
};

export function seedRbac(db) {
  const insertRole = db.prepare(`
    INSERT INTO roles (key, label, rank, is_system_role, description) VALUES (?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label, rank = excluded.rank, description = excluded.description
  `);
  const tx = db.transaction(() => {
    for (const r of ROLES) insertRole.run(r.key, r.label, r.rank, r.is_system_role, r.description);

    const insertPerm = db.prepare(`
      INSERT INTO permissions (key, module, label, description, is_dangerous, admin_only) VALUES (?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET module = excluded.module, label = excluded.label, description = excluded.description,
        is_dangerous = excluded.is_dangerous, admin_only = excluded.admin_only
    `);
    for (const p of PERMISSIONS) {
      insertPerm.run(p.key, p.module, p.label, p.description || '', p.is_dangerous ? 1 : 0, p.admin_only ? 1 : 0);
    }

    // System admin gets every permission marked 'allow' for matrix-display
    // purposes (code-level bypass already grants everything regardless).
    const allPermKeys = PERMISSIONS.map(p => p.key);
    const fullGrant = { ...Object.fromEntries(allPermKeys.map(k => [k, 'allow'])) };
    const defaultsWithAdmin = { ...ROLE_DEFAULTS, system_admin: fullGrant };

    const getRoleId = db.prepare('SELECT id FROM roles WHERE key = ?');
    const getPermId = db.prepare('SELECT id FROM permissions WHERE key = ?');
    const upsertGrant = db.prepare(`
      INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?,?,?)
      ON CONFLICT(role_id, permission_id) DO UPDATE SET effect = excluded.effect
    `);
    for (const [roleKey, grants] of Object.entries(defaultsWithAdmin)) {
      const role = getRoleId.get(roleKey);
      if (!role) continue;
      for (const [permKey, effect] of Object.entries(grants)) {
        const perm = getPermId.get(permKey);
        if (!perm) continue;
        upsertGrant.run(role.id, perm.id, effect);
      }
    }

    // Backfill users.role_id from the existing role/staff_role text columns
    // so every existing account resolves permissions correctly immediately,
    // with zero manual admin configuration required after this upgrade.
    const roleIdByKey = Object.fromEntries(ROLES.map(r => [r.key, getRoleId.get(r.key).id]));
    db.prepare(`UPDATE users SET role_id = ? WHERE role = 'admin' AND role_id IS NULL`).run(roleIdByKey.system_admin);
    db.prepare(`UPDATE users SET role_id = ? WHERE role = 'teacher' AND staff_role = 'class_teacher' AND role_id IS NULL`).run(roleIdByKey.class_teacher);
    db.prepare(`UPDATE users SET role_id = ? WHERE role = 'teacher' AND staff_role = 'coordinator' AND role_id IS NULL`).run(roleIdByKey.coordinator);
    db.prepare(`UPDATE users SET role_id = ? WHERE role = 'teacher' AND staff_role = 'exam_controller' AND role_id IS NULL`).run(roleIdByKey.exam_coordinator);
    db.prepare(`UPDATE users SET role_id = ? WHERE role = 'teacher' AND staff_role = 'academic_head' AND role_id IS NULL`).run(roleIdByKey.academic_head);
    db.prepare(`UPDATE users SET role_id = ? WHERE role = 'teacher' AND (staff_role = 'subject_teacher' OR staff_role IS NULL) AND role_id IS NULL`).run(roleIdByKey.subject_teacher);
  });
  tx();
}
