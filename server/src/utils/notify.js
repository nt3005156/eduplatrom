import db from '../db/index.js';

const insertNotification = db.prepare(`
  INSERT INTO notifications (user_id, type, title, body, link, related_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);

/**
 * Send a notification to every student in a given class (or every student, if class_level is null).
 * Runs inside a transaction so a large class doesn't leave partial state on error.
 */
export function notifyClass({ class_level, type, title, body = '', link = null, related_id = null }) {
  const students = class_level
    ? db.prepare("SELECT id FROM users WHERE role='student' AND class_level = ?").all(class_level)
    : db.prepare("SELECT id FROM users WHERE role='student'").all();

  const tx = db.transaction((rows) => {
    for (const s of rows) {
      insertNotification.run(s.id, type, title, body, link, related_id);
    }
  });
  tx(students);
  return students.length;
}

/** Send a notification to a single user (e.g. a graded submission). */
export function notifyUser({ user_id, type, title, body = '', link = null, related_id = null }) {
  insertNotification.run(user_id, type, title, body, link, related_id);
}

/** Send a notification to every admin account (e.g. a new student needs approval). */
export function notifyAdmins({ type, title, body = '', link = null, related_id = null }) {
  const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
  const tx = db.transaction((rows) => {
    for (const a of rows) {
      insertNotification.run(a.id, type, title, body, link, related_id);
    }
  });
  tx(admins);
  return admins.length;
}

/** Send a notification to every staff member (admins + teachers) — used for day-to-day operational alerts like new submissions. */
export function notifyStaff({ type, title, body = '', link = null, related_id = null }) {
  const staff = db.prepare("SELECT id FROM users WHERE role IN ('admin','teacher')").all();
  const tx = db.transaction((rows) => {
    for (const s of rows) {
      insertNotification.run(s.id, type, title, body, link, related_id);
    }
  });
  tx(staff);
  return staff.length;
}

/**
 * Send a notification only to the teacher(s) actually assigned (via
 * teacher_assignments) to this class/section/subject, plus admins — instead
 * of blasting every teacher in the school. Falls back to notifyStaff() if no
 * specific assignment rows exist yet (e.g. legacy data / class not yet
 * assigned to anyone), so nothing is silently dropped.
 */
export function notifyTeachersForClass({ class_level, section = null, subject_id = null, type, title, body = '', link = null, related_id = null, includeAdmins = true }) {
  let sql = `SELECT DISTINCT teacher_id as id FROM teacher_assignments WHERE class_level = ? AND (section IS NULL OR section = ?)`;
  const params = [class_level, section];
  if (subject_id) { sql += ' AND subject_id = ?'; params.push(subject_id); }
  const assigned = db.prepare(sql).all(...params);

  const admins = includeAdmins ? db.prepare("SELECT id FROM users WHERE role = 'admin'").all() : [];
  const targetIds = new Set([...assigned.map(r => r.id), ...admins.map(r => r.id)]);

  if (targetIds.size === 0) {
    // No specific assignment found — fall back to notifying all staff so the
    // alert is never silently lost.
    return notifyStaff({ type, title, body, link, related_id });
  }

  const tx = db.transaction((ids) => {
    for (const id of ids) insertNotification.run(id, type, title, body, link, related_id);
  });
  tx([...targetIds]);
  return targetIds.size;
}
