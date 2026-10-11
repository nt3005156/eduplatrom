// Scope resolution — answers "which rows can this user see/act on," as
// opposed to permissions.js which answers "can this user ever perform this
// action at all." Both must pass. See
// docs/RBAC_ENTERPRISE_ARCHITECTURE.md §4.2 for the design rationale.
//
// FAIL-CLOSED BY DESIGN: a staff member with zero assignment rows sees
// NOTHING in scoped modules, never "everything." This is the single most
// important correctness property here — it directly fixes the pre-existing
// bug where any teacher could query /api/dashboard/admin, /api/assignments,
// etc. and see every class/subject/student in the school regardless of
// their actual assignments.
import db from '../db/index.js';

// Exported so tests can pin the rule. Guardians must never be listed here.
export const UNRESTRICTED_ROLE_KEYS = new Set(['system_admin', 'academic_head']);

const getUserRole = db.prepare(`
  SELECT u.id, u.role as legacy_role, r.key as role_key
  FROM users u LEFT JOIN roles r ON u.role_id = r.id
  WHERE u.id = ?
`);

const getTeacherAssignments = db.prepare('SELECT * FROM teacher_assignments WHERE teacher_id = ?');
const getScopeAssignments = db.prepare('SELECT * FROM scope_assignments WHERE user_id = ?');

/**
 * @param {{id:number}} user
 * @returns {{
 *   unrestricted: boolean,
 *   roleKey: string|null,
 *   classSections: {class_level:number, section:string|null}[],   // full (all-subject) access, e.g. Class Teacher's homeroom
 *   subjectAssignments: {class_level:number, section:string|null, subject_id:number}[], // narrow (single-subject) access
 *   departments: string[],
 * }}
 */
export function resolveScope(user) {
  const role = getUserRole.get(user?.id);
  const roleKey = role?.role_key || (user?.role === 'admin' ? 'system_admin' : null);

  // Fail closed: a user with no resolvable role gets NO scope (previously this
  // path returned unrestricted=true, which exposed every class to them).
  if (!roleKey) {
    return { unrestricted: false, roleKey: null, classSections: [], subjectAssignments: [], departments: [] };
  }

  // Guardians are families, not staff. They never hold a staff scope, and this
  // check runs before the unrestricted check so a mismatched role row can never
  // grant a guardian whole-school scope. Guardian access is decided by
  // guardian_students links (services/guardians.js), not by this module.
  if (roleKey === 'guardian' || user?.role === 'guardian') {
    return { unrestricted: false, roleKey: 'guardian', classSections: [], subjectAssignments: [], departments: [] };
  }

  if (UNRESTRICTED_ROLE_KEYS.has(roleKey)) {
    return { unrestricted: true, roleKey, classSections: [], subjectAssignments: [], departments: [] };
  }

  if (roleKey === 'coordinator' || roleKey === 'exam_coordinator') {
    // Coordinator: scoped by department/subject scope_assignments rows if any
    // exist, else treated as whole-school read access for monitoring
    // purposes (a Coordinator with zero explicit scope rows still needs to
    // be USABLE out of the box — unlike a Subject Teacher, "no assignment
    // rows yet" for a Coordinator role defaults to whole-school monitoring,
    // not zero visibility, since that's the nature of the role).
    const rows = getScopeAssignments.all(user.id);
    const departments = rows.filter(r => r.scope_type === 'department').map(r => r.scope_value);
    if (departments.length === 0) {
      return { unrestricted: true, roleKey, classSections: [], subjectAssignments: [], departments: [] };
    }
    return { unrestricted: false, roleKey, classSections: [], subjectAssignments: [], departments };
  }

  // class_teacher / subject_teacher: derive from teacher_assignments.
  const rows = getTeacherAssignments.all(user.id);
  const classSections = rows.filter(r => r.is_class_teacher).map(r => ({ class_level: r.class_level, section: r.section }));
  const subjectAssignments = rows.map(r => ({ class_level: r.class_level, section: r.section, subject_id: r.subject_id }));

  return { unrestricted: false, roleKey, classSections, subjectAssignments, departments: [] };
}

/**
 * Builds a SQL WHERE fragment + params restricting rows to the given scope.
 * `columns` maps logical field names to the actual column names/aliases used
 * in the calling query (so this helper works across assignments, quizzes,
 * materials, attendance, etc. which all have class_level/subject_id columns
 * but not all of them have a `section` column — pass `columns.section = null`
 * for tables with no section column, e.g. materials/quizzes, so the class+
 * subject match isn't narrowed by a column that doesn't exist).
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {{classLevel:string, section:string|null, subjectId:string}} columns
 * @param {{includeClassTeacherRows?: boolean}} opts - if true, classSections
 *   grants (full access to every subject in that class+section) are unioned
 *   in alongside the narrower subjectAssignments grants.
 */
export function scopeWhereClause(scope, columns, opts = {}) {
  if (scope.unrestricted) return { sql: '1=1', params: [] };

  const clauses = [];
  const params = [];
  const hasSectionColumn = !!columns.section;

  for (const a of scope.subjectAssignments) {
    if (hasSectionColumn && a.section) {
      clauses.push(`(${columns.classLevel}=? AND (${columns.section}=? OR ${columns.section} IS NULL) AND ${columns.subjectId}=?)`);
      params.push(a.class_level, a.section, a.subject_id);
    } else {
      clauses.push(`(${columns.classLevel}=? AND ${columns.subjectId}=?)`);
      params.push(a.class_level, a.subject_id);
    }
  }

  if (opts.includeClassTeacherRows !== false) {
    for (const cs of scope.classSections) {
      if (hasSectionColumn && cs.section) {
        clauses.push(`(${columns.classLevel}=? AND (${columns.section}=? OR ${columns.section} IS NULL))`);
        params.push(cs.class_level, cs.section);
      } else {
        clauses.push(`(${columns.classLevel}=?)`);
        params.push(cs.class_level);
      }
    }
  }

  // Fail-closed: no assignment rows at all -> match nothing, not everything.
  if (clauses.length === 0) return { sql: '1=0', params: [] };
  return { sql: `(${clauses.join(' OR ')})`, params };
}

/** Restricts scope to just the class+section dimension (for attendance/
 * behaviour/student-roster queries that don't have a subject_id column). */
export function scopeWhereClauseClassOnly(scope, columns) {
  if (scope.unrestricted) return { sql: '1=1', params: [] };
  const allClassSections = [
    ...scope.classSections,
    ...scope.subjectAssignments.map(a => ({ class_level: a.class_level, section: a.section })),
  ];
  const seen = new Set();
  const clauses = [];
  const params = [];
  for (const cs of allClassSections) {
    const key = `${cs.class_level}|${cs.section || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cs.section) {
      clauses.push(`(${columns.classLevel}=? AND (${columns.section}=? OR ${columns.section} IS NULL))`);
      params.push(cs.class_level, cs.section);
    } else {
      clauses.push(`(${columns.classLevel}=?)`);
      params.push(cs.class_level);
    }
  }
  if (clauses.length === 0) return { sql: '1=0', params: [] };
  return { sql: `(${clauses.join(' OR ')})`, params };
}

/** Express middleware: attaches req.scope = resolveScope(req.user). */
export function injectScope(req, res, next) {
  req.scope = resolveScope(req.user);
  next();
}

/**
 * Returns which subject_ids a user is allowed to see/act on for a specific
 * class_level, or `null` to mean "all subjects" (unrestricted role, or a
 * Class Teacher homeroom grant for that class — Class Teachers see every
 * subject for their own class). For a Subject Teacher this returns exactly
 * their assigned subject_ids for that class, e.g. a Math teacher for
 * Class 10 only ever gets [<math subject id>] back — this is what drives
 * "never even see English/Science/Computer in dropdowns" everywhere
 * (Manage Content, Assignment/Quiz creation forms, subject filters, etc).
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {number} classLevel
 * @returns {number[]|null}
 */
export function allowedSubjectIdsForClass(scope, classLevel) {
  if (scope.unrestricted) return null;
  const cls = Number(classLevel);
  const hasClassTeacherGrant = scope.classSections.some(cs => cs.class_level === cls);
  if (hasClassTeacherGrant) return null; // full access to every subject in this class
  const ids = scope.subjectAssignments.filter(a => a.class_level === cls).map(a => a.subject_id);
  return [...new Set(ids)];
}

/** Every class_level the user has ANY assignment in (for building the class
 * picker itself — a teacher should never even see a Class dropdown option
 * for a class they have zero assignments in). Returns null for unrestricted
 * roles (every class is selectable). */
export function allowedClassLevels(scope) {
  if (scope.unrestricted) return null;
  const levels = new Set([
    ...scope.classSections.map(cs => cs.class_level),
    ...scope.subjectAssignments.map(a => a.class_level),
  ]);
  return [...levels];
}

/**
 * Answers "is this specific class_level/section/subject_id combination
 * something the user is actually allowed to touch" — used to validate
 * WRITE operations (create/edit/delete an assignment/quiz/material) where
 * scopeWhereClause() (a read-side SQL filter) doesn't apply. Without this,
 * a Subject Teacher scoped only to Class 10 Section A Mathematics could
 * still POST a new assignment with class_level=7 in the request body and
 * it would be accepted, since nothing validated the body against their
 * actual assignments — this was a real, confirmed gap this function closes.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {{classLevel:number|string, section?:string|null, subjectId?:number|string|null}} target
 * @returns {boolean}
 */
export function isWithinScope(scope, { classLevel, section = null, subjectId = null }) {
  if (scope.unrestricted) return true;
  const cls = Number(classLevel);

  // Class Teacher homeroom grants (classSections) cover every subject in
  // that class+section, so a subject match isn't required for those.
  const matchesClassTeacherGrant = scope.classSections.some(cs =>
    cs.class_level === cls && (!cs.section || !section || cs.section === section)
  );
  if (matchesClassTeacherGrant) return true;

  // Subject-scoped grants require an exact class+subject match (section, if
  // specified on the grant, must match too; a grant with no section covers
  // every section of that class).
  if (subjectId != null) {
    const sid = Number(subjectId);
    return scope.subjectAssignments.some(a =>
      a.class_level === cls && a.subject_id === sid && (!a.section || !section || a.section === section)
    );
  }

  // No subject given to check against (e.g. an operation on the whole
  // class/section with no single subject, like a class-wide roster read) —
  // any subject assignment for that class+section is sufficient.
  return scope.subjectAssignments.some(a =>
    a.class_level === cls && (!a.section || !section || a.section === section)
  );
}

