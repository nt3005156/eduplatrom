// Builds parent messages from school events. Recipients follow the same rules as the guardian portal:
// only active guardians with a non-restricted link, and attendance alerts only where can_view_attendance = 1.
import db from '../../db/index.js';
import { enqueue, getConfig, normalizeRecipient, CHANNELS } from './outbox.js';
import { renderAttendanceAlert, TEMPLATE_IDS } from './templates.js';

const enabledChannels = config => CHANNELS.filter(ch => config[`${ch}_enabled`]);

function schoolName() {
  const s = db.prepare('SELECT school_name, site_name FROM settings WHERE id = 1').get() || {};
  return s.school_name || s.site_name || 'School';
}

function attendanceGuardians(studentId) {
  return db.prepare(`
    SELECT u.id AS guardian_id, u.email, u.phone
    FROM guardian_students gs JOIN users u ON u.id = gs.guardian_id
    WHERE gs.student_id = ? AND gs.restricted = 0 AND gs.can_view_attendance = 1
      AND u.role = 'guardian' AND u.account_status = 'active'`).all(studentId);
}

/**
 * Queues absence and late alerts for one daily register. Subject registers are skipped: one alert
 * per student per day avoids a message for every lesson. Does nothing while alerts are off.
 * Returns the number of messages queued.
 */
export function queueAttendanceAlerts({ records, date, studentNames }) {
  const config = getConfig();
  if (!config.alerts_enabled) return 0;
  const channels = enabledChannels(config);
  if (channels.length === 0) return 0;
  const school = schoolName();
  let queued = 0;

  for (const r of records) {
    if (r.status !== 'absent' && r.status !== 'late') continue;
    const studentId = Number(r.student_id);
    const student = studentNames.get(studentId) || 'Your child';
    const body = renderAttendanceAlert(r.status, { student, date, school }, config.language);
    const subject = `${school}: attendance ${date}`;
    for (const g of attendanceGuardians(studentId)) {
      for (const channel of channels) {
        const addr = normalizeRecipient(channel, channel === 'email' ? g.email : g.phone);
        const key = addr.ok ? addr.value : `none:${g.guardian_id}`;
        const res = enqueue({
          channel, recipient: addr.ok ? addr.value : null, user_id: g.guardian_id, student_id: studentId,
          template_id: TEMPLATE_IDS[r.status], subject, body,
          dedupe_key: `${channel}|${key}|attendance|${studentId}|${date}|${r.status}`,
          event_kind: 'attendance', event_date: date, event_status: r.status,
          contact_missing: !addr.ok,
        });
        if (res.inserted) queued++;
      }
    }
  }
  return queued;
}

/**
 * Queues a class notice to every guardian of that class who may receive messages.
 * idempotency_key stops a retried request from sending the notice twice.
 */
export function queueNotice({ class_level, section = null, title, body, channels, idempotency_key }) {
  const guardians = db.prepare(`
    SELECT DISTINCT u.id AS guardian_id, u.email, u.phone
    FROM guardian_students gs
      JOIN users s ON s.id = gs.student_id
      JOIN users u ON u.id = gs.guardian_id
    WHERE s.role = 'student' AND s.account_status = 'active' AND s.class_level = ?
      AND (? IS NULL OR s.section = ?)
      AND gs.restricted = 0 AND u.role = 'guardian' AND u.account_status = 'active'`).all(class_level, section, section);

  const school = schoolName();
  const text = `${school}: ${title}\n${body}`;
  const summary = { queued: 0, skipped_no_contact: 0, duplicate: 0 };
  for (const g of guardians) {
    for (const channel of channels) {
      const addr = normalizeRecipient(channel, channel === 'email' ? g.email : g.phone);
      const key = addr.ok ? addr.value : `none:${g.guardian_id}`;
      const res = enqueue({
        channel, recipient: addr.ok ? addr.value : null, user_id: g.guardian_id,
        template_id: TEMPLATE_IDS.notice, subject: `${school}: ${title}`, body: text,
        dedupe_key: `${channel}|${key}|notice|${idempotency_key}`,
        event_kind: 'notice', contact_missing: !addr.ok,
      });
      if (!res.inserted) summary.duplicate++;
      else if (!addr.ok) summary.skipped_no_contact++;
      else summary.queued++;
    }
  }
  return { ...summary, guardians: guardians.length };
}
