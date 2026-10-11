// Attendance module.
//
// Two kinds of register exist in the same table (attendance_records):
//   - DAILY register    : subject_id IS NULL. Homeroom attendance, marked by the
//                         Class Teacher for their class + section.
//   - SUBJECT register  : subject_id = <id>. Period/subject attendance, marked
//                         by a Subject Teacher for classes they teach.
//
// Permissions (services/permissions.js):
//   attendance.mark  -> create/edit records within the caller's scope
//   attendance.view  -> summaries, reports, CSV export
//   Students always see their own records via GET /me (no permission needed).
//
// Attendance percentage = (present + late + excused + 0.5 * half_day) / total marked.
// Excused absences are not counted against a student.

import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { requirePermission } from '../services/permissions.js';
import { resolveScope, isWithinScope } from '../services/scope.js';
import { logAudit } from '../utils/audit.js';
import { notifyUser } from '../utils/notify.js';
import { queueAttendanceAlerts } from '../services/messaging/alerts.js';

const router = Router();

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused', 'half_day'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = process.env.ATTENDANCE_TZ || 'Asia/Kathmandu';
// Teachers may only edit a register for this many days back. Admins and
// Academic Heads can correct older records (they are audited either way).
const EDIT_WINDOW_DAYS = Number(process.env.ATTENDANCE_EDIT_WINDOW_DAYS || 7);

export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function isValidDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function parseClassLevel(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function parseSubjectId(v) {
  if (v === undefined || v === null || v === '' || v === 'daily') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN; // NaN = invalid, null = daily register
}

function isElevated(user) {
  return user?.role === 'admin' || user?.staff_role === 'academic_head';
}

/** Is the caller the homeroom (Class) teacher for this class+section? */
function isClassTeacherFor(scope, classLevel, section) {
  if (scope.unrestricted) return true;
  return scope.classSections.some(cs =>
    cs.class_level === classLevel && (!cs.section || !section || cs.section === section)
  );
}

/** Scope rule: daily register needs homeroom rights; subject register needs that subject. */
function canAccessRegister(user, { classLevel, section, subjectId }) {
  const scope = resolveScope(user);
  if (subjectId == null) return isClassTeacherFor(scope, classLevel, section);
  return isWithinScope(scope, { classLevel, section, subjectId });
}

/** Active students in a class (and optional section), in name order. */
function rosterFor(classLevel, section) {
  const sql = `
    SELECT id, name, email, class_level, section FROM users
    WHERE role = 'student' AND class_level = ?
      AND (? IS NULL OR section = ?)
      AND COALESCE(approval_status, 'approved') = 'approved'
      AND COALESCE(account_status, 'active') = 'active'
    ORDER BY name COLLATE NOCASE`;
  return db.prepare(sql).all(classLevel, section || null, section || null);
}

/**
 * Default reporting window: the active academic session if today falls inside
 * it; otherwise the last 12 months up to today. (Using a stale session would
 * silently hide every record taken after it ended.)
 */
function defaultRange() {
  const today = todayISO();
  const s = db.prepare(`SELECT start_date, end_date FROM academic_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1`).get();
  if (s && s.start_date <= today && today <= s.end_date) return { from: s.start_date, to: s.end_date };
  const yearAgo = new Date(Date.now() - 365 * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
  return { from: yearAgo, to: today };
}

function pct(attended, total) {
  return total > 0 ? Math.round((attended / total) * 1000) / 10 : null;
}

// ---------------------------------------------------------------------------
// GET /api/attendance/roster?class_level=&section=&subject_id=&date=
// The register for one class/section/subject on one date, with each student's
// current status (null = not yet marked).
// ---------------------------------------------------------------------------
router.get('/roster', requireAuth, requireStaff, requirePermission('attendance.mark'), (req, res) => {
  const classLevel = parseClassLevel(req.query.class_level);
  const subjectId = parseSubjectId(req.query.subject_id);
  const section = req.query.section ? String(req.query.section) : null;
  const date = req.query.date || todayISO();
  if (!classLevel) return res.status(400).json({ error: 'class_level (1-12) is required' });
  if (Number.isNaN(subjectId)) return res.status(400).json({ error: 'subject_id is invalid' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!canAccessRegister(req.user, { classLevel, section, subjectId })) {
    return res.status(403).json({ error: 'This class/subject is outside your assignments.' });
  }

  const students = rosterFor(classLevel, section);
  const marks = db.prepare(`
    SELECT student_id, status, remarks FROM attendance_records
    WHERE date = ? AND class_level = ? AND (? IS NULL OR section = ?) AND subject_id IS ?
  `).all(date, classLevel, section, section, subjectId);
  const byStudent = new Map(marks.map(m => [m.student_id, m]));

  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map(s => [s, 0]));
  const rows = students.map(s => {
    const m = byStudent.get(s.id);
    if (m) counts[m.status]++;
    return { ...s, status: m?.status || null, remarks: m?.remarks || '' };
  });
  const marked = marks.length;

  res.json({
    date,
    class_level: classLevel,
    section,
    subject_id: subjectId,
    register: subjectId ? 'subject' : 'daily',
    students: rows,
    counts: { ...counts, unmarked: students.length - marked },
    edit_window_days: isElevated(req.user) ? null : EDIT_WINDOW_DAYS,
  });
});

// ---------------------------------------------------------------------------
// POST /api/attendance  — bulk upsert for one register/date.
// body: { class_level, section, subject_id?, date, records:[{student_id,status,remarks?}] }
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requireStaff, requirePermission('attendance.mark'), (req, res) => {
  const { section: rawSection, date, records } = req.body || {};
  const classLevel = parseClassLevel(req.body?.class_level);
  const subjectId = parseSubjectId(req.body?.subject_id);
  const section = rawSection ? String(rawSection) : null;

  if (!classLevel) return res.status(400).json({ error: 'class_level (1-12) is required' });
  if (Number.isNaN(subjectId)) return res.status(400).json({ error: 'subject_id is invalid' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ error: 'records must be a non-empty array' });
  if (records.length > 500) return res.status(400).json({ error: 'Too many records in one request (max 500)' });

  const today = todayISO();
  if (date > today) return res.status(400).json({ error: 'Attendance cannot be marked for a future date' });
  if (!isElevated(req.user) && daysBetween(date, today) > EDIT_WINDOW_DAYS) {
    return res.status(403).json({ error: `Registers older than ${EDIT_WINDOW_DAYS} days can only be changed by an Academic Head or Admin.` });
  }

  if (!canAccessRegister(req.user, { classLevel, section, subjectId })) {
    return res.status(403).json({ error: subjectId == null
      ? 'Only the Class Teacher of this class can mark the daily register.'
      : 'This subject is outside your assignments.' });
  }

  // Every student in the payload must actually belong to this class/section.
  const roster = rosterFor(classLevel, section);
  const allowed = new Set(roster.map(s => s.id));
  const sectionOf = new Map(roster.map(s => [s.id, s.section]));
  const seen = new Set();
  for (const r of records) {
    const sid = Number(r?.student_id);
    if (!Number.isInteger(sid) || !allowed.has(sid)) {
      return res.status(400).json({ error: `Student ${r?.student_id} is not in Class ${classLevel}${section ? ` ${section}` : ''}` });
    }
    if (!ATTENDANCE_STATUSES.includes(r.status)) {
      return res.status(400).json({ error: `Invalid status "${r.status}". Use one of: ${ATTENDANCE_STATUSES.join(', ')}` });
    }
    if (seen.has(sid)) return res.status(400).json({ error: `Duplicate record for student ${sid}` });
    seen.add(sid);
  }

  const find = db.prepare('SELECT id FROM attendance_records WHERE student_id = ? AND date = ? AND subject_id IS ?');
  const update = db.prepare(`UPDATE attendance_records SET status = ?, remarks = ?, marked_by = ?, updated_at = datetime('now') WHERE id = ?`);
  const insert = db.prepare(`INSERT INTO attendance_records (student_id, class_level, section, subject_id, date, status, marked_by, remarks)
    VALUES (?,?,?,?,?,?,?,?)`);

  const tx = db.transaction((rows) => {
    let created = 0, updated = 0;
    for (const r of rows) {
      const remarks = String(r.remarks || '').slice(0, 300);
      const existing = find.get(Number(r.student_id), date, subjectId);
      if (existing) { update.run(r.status, remarks, req.user.id, existing.id); updated++; }
      else { insert.run(Number(r.student_id), classLevel, sectionOf.get(Number(r.student_id)) || section, subjectId, date, r.status, req.user.id, remarks); created++; }
    }
    return { created, updated };
  });
  const result = tx(records);

  // Tell students who were marked absent (in-app; SMS/email to parents is the next step).
  const absentees = records.filter(r => r.status === 'absent');
  for (const r of absentees) {
    notifyUser({
      user_id: Number(r.student_id), type: 'general',
      title: `Marked absent on ${date}`,
      body: subjectId ? 'You were marked absent in a subject class.' : 'You were marked absent for the day.',
      link: '/attendance',
    });
  }

  // Parent alerts follow the daily register only. A subject register would alert once per lesson.
  // A failure here must never block the register itself, so it is logged and the save still succeeds.
  if (subjectId == null) {
    try {
      const alertRecords = records.filter(r => r.status === 'absent' || r.status === 'late');
      if (alertRecords.length) {
        const ids = alertRecords.map(r => Number(r.student_id));
        const marks = ids.map(() => '?').join(',');
        const names = new Map(db.prepare(`SELECT id, name FROM users WHERE id IN (${marks})`).all(...ids).map(u => [u.id, u.name]));
        queueAttendanceAlerts({ records: alertRecords, date, studentNames: names });
      }
    } catch (err) {
      console.error('parent alerts were not queued:', err.message);
    }
  }

  const label = `${subjectId ? 'subject' : 'daily'} register, Class ${classLevel}${section ? ` ${section}` : ''}, ${date}`;
  logAudit(req, {
    module: 'attendance', action: 'marked',
    description: `${req.user.name} marked ${records.length} student(s) on the ${label}`,
    newValue: { date, class_level: classLevel, section, subject_id: subjectId, ...result,
      statuses: Object.fromEntries(ATTENDANCE_STATUSES.map(s => [s, records.filter(r => r.status === s).length])) },
  });

  res.json({ ok: true, ...result, total: records.length });
});

// ---------------------------------------------------------------------------
// GET /api/attendance/summary?class_level=&section=&subject_id=&from=&to=&format=csv
// Per-student attendance for a class (daily register by default).
// ---------------------------------------------------------------------------
router.get('/summary', requireAuth, requireStaff, requirePermission('attendance.view'), (req, res) => {
  const classLevel = parseClassLevel(req.query.class_level);
  const subjectId = parseSubjectId(req.query.subject_id);
  const section = req.query.section ? String(req.query.section) : null;
  if (!classLevel) return res.status(400).json({ error: 'class_level (1-12) is required' });
  if (Number.isNaN(subjectId)) return res.status(400).json({ error: 'subject_id is invalid' });

  const range = defaultRange();
  const from = req.query.from || range.from;
  const to = req.query.to || range.to;
  if (!isValidDate(from) || !isValidDate(to) || from > to) return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD dates with from <= to' });

  if (!canAccessRegister(req.user, { classLevel, section, subjectId })) {
    return res.status(403).json({ error: 'This class/subject is outside your assignments.' });
  }

  const rows = db.prepare(`
    SELECT s.id, s.name, s.email, s.section,
      COUNT(a.id) AS total,
      COALESCE(SUM(a.status = 'present'), 0) AS present,
      COALESCE(SUM(a.status = 'absent'), 0) AS absent,
      COALESCE(SUM(a.status = 'late'), 0) AS late,
      COALESCE(SUM(a.status = 'excused'), 0) AS excused,
      COALESCE(SUM(a.status = 'half_day'), 0) AS half_day
    FROM users s
    LEFT JOIN attendance_records a
      ON a.student_id = s.id AND a.date BETWEEN ? AND ? AND a.subject_id IS ?
    WHERE s.role = 'student' AND s.class_level = ?
      AND (? IS NULL OR s.section = ?)
      AND COALESCE(s.account_status, 'active') = 'active'
    GROUP BY s.id
    ORDER BY s.name COLLATE NOCASE`).all(from, to, subjectId, classLevel, section, section);

  const students = rows.map(r => {
    const attended = r.present + r.late + r.excused + 0.5 * r.half_day;
    return { ...r, attendance_pct: pct(attended, r.total) };
  });

  if (req.query.format === 'csv') {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Name', 'Email', 'Section', 'Days Marked', 'Present', 'Absent', 'Late', 'Excused', 'Half Day', 'Attendance %'];
    const lines = students.map(s => [s.name, s.email, s.section, s.total, s.present, s.absent, s.late, s.excused, s.half_day, s.attendance_pct ?? ''].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-class-${classLevel}${section || ''}-${from}-to-${to}.csv"`);
    return res.send([header.map(esc).join(','), ...lines].join('\n'));
  }

  const classAttended = students.reduce((a, s) => a + s.present + s.late + s.excused + 0.5 * s.half_day, 0);
  const classTotal = students.reduce((a, s) => a + s.total, 0);
  const atRisk = students.filter(s => s.attendance_pct !== null && s.attendance_pct < 75);

  res.json({
    from, to, class_level: classLevel, section, subject_id: subjectId,
    register: subjectId ? 'subject' : 'daily',
    class_average_pct: pct(classAttended, classTotal),
    at_risk_count: atRisk.length,
    students,
  });
});

// ---------------------------------------------------------------------------
// GET /api/attendance/me?from=&to=  — the logged-in student's own record.
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
  const range = defaultRange();
  const from = req.query.from || range.from;
  const to = req.query.to || range.to;
  if (!isValidDate(from) || !isValidDate(to) || from > to) return res.status(400).json({ error: 'from/to must be valid YYYY-MM-DD dates with from <= to' });

  const records = db.prepare(`
    SELECT a.id, a.date, a.status, a.remarks, a.subject_id, s.name AS subject_name
    FROM attendance_records a LEFT JOIN subjects s ON s.id = a.subject_id
    WHERE a.student_id = ? AND a.date BETWEEN ? AND ?
    ORDER BY a.date DESC, a.id DESC`).all(req.user.id, from, to);

  const tally = list => {
    const c = Object.fromEntries(ATTENDANCE_STATUSES.map(s => [s, 0]));
    list.forEach(r => { c[r.status]++; });
    const total = list.length;
    const attended = c.present + c.late + c.excused + 0.5 * c.half_day;
    return { total, ...c, attendance_pct: pct(attended, total) };
  };

  const daily = records.filter(r => r.subject_id == null);
  const bySubjectMap = new Map();
  for (const r of records.filter(r => r.subject_id != null)) {
    if (!bySubjectMap.has(r.subject_id)) bySubjectMap.set(r.subject_id, { subject_id: r.subject_id, subject_name: r.subject_name, records: [] });
    bySubjectMap.get(r.subject_id).records.push(r);
  }
  const subjects = [...bySubjectMap.values()].map(s => ({ subject_id: s.subject_id, subject_name: s.subject_name, ...tally(s.records) }));

  res.json({
    from, to,
    daily: tally(daily),
    subjects,
    records: records.map(({ id, date, status, remarks, subject_id, subject_name }) => ({ id, date, status, remarks, subject_id, subject_name: subject_name || null })),
    below_threshold: (tally(daily).attendance_pct ?? 100) < 75,
  });
});

export default router;
