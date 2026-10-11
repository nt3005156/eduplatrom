// Guardian access rules. This is the only place that decides whether a guardian may
// see a child. Routes call these helpers; they never write their own guardian SQL.
// Fail closed: no link row, restricted = 1, or the flag is 0 means no access.
import db from '../db/index.js';
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused', 'half_day'];

// The student must still be an active student record. An archived or disabled child
// is hidden from the parent even though the link row remains.
const getLink = db.prepare(`
  SELECT gs.* FROM guardian_students gs JOIN users s ON s.id = gs.student_id
  WHERE gs.guardian_id = ? AND gs.student_id = ? AND s.role = 'student' AND s.account_status NOT IN ('archived', 'disabled')`);

/** Link row when the guardian may see this child with the given flag, else null. */
export function accessibleLink(guardianId, studentId, flag = 'can_view_attendance') {
  const link = getLink.get(guardianId, studentId);
  if (!link || link.restricted) return null;
  if (flag && !link[flag]) return null;
  return link;
}

/** Children this guardian may see at all (not restricted). */
export function visibleChildren(guardianId) {
  return db.prepare(`
    SELECT gs.*, s.name, s.class_level, s.section, s.roll_no, s.admission_no, s.avatar_color, s.account_status
    FROM guardian_students gs JOIN users s ON s.id = gs.student_id
    WHERE gs.guardian_id = ? AND gs.restricted = 0 AND s.role = 'student' AND s.account_status NOT IN ('archived', 'disabled')
    ORDER BY s.class_level, s.section, s.name`).all(guardianId);
}

const pct = (attended, total) => (total > 0 ? Math.round((attended / total) * 1000) / 10 : null);

/** Same tally rules as the student's own attendance view. */
export function attendanceTally(studentId, from, to) {
  const records = db.prepare(`
    SELECT a.id, a.date, a.status, a.remarks, a.subject_id, s.name AS subject_name
    FROM attendance_records a LEFT JOIN subjects s ON s.id = a.subject_id
    WHERE a.student_id = ? AND a.date BETWEEN ? AND ?
    ORDER BY a.date DESC, a.id DESC`).all(studentId, from, to);
  const tally = list => {
    const c = Object.fromEntries(ATTENDANCE_STATUSES.map(st => [st, 0]));
    list.forEach(r => { c[r.status]++; });
    const attended = c.present + c.late + c.excused + 0.5 * c.half_day;
    return { total: list.length, ...c, attendance_pct: pct(attended, list.length) };
  };
  const daily = records.filter(r => r.subject_id == null);
  const bySubject = new Map();
  for (const r of records.filter(r => r.subject_id != null)) {
    if (!bySubject.has(r.subject_id)) bySubject.set(r.subject_id, { subject_id: r.subject_id, subject_name: r.subject_name, records: [] });
    bySubject.get(r.subject_id).records.push(r);
  }
  return {
    from, to,
    daily: tally(daily),
    subjects: [...bySubject.values()].map(s => ({ subject_id: s.subject_id, subject_name: s.subject_name, ...tally(s.records) })),
    records: records.map(({ id, date, status, remarks, subject_id, subject_name }) => ({ id, date, status, remarks, subject_id, subject_name: subject_name || null })),
  };
}

export function guardianRoleId() {
  return db.prepare("SELECT id FROM roles WHERE key = 'guardian'").get()?.id || null;
}
