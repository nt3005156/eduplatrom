// Outbox: queue, worker, quotas, and opt-outs for parent alerts.
//
// Guarantees (each one is tested in test/messaging.test.js):
//  - Enqueueing the same event twice creates one message (unique dedupe_key).
//  - A failed send is retried with backoff. A message is never sent twice after a success.
//  - An opted-out address is never sent to, checked at send time.
//  - A monthly quota stops sending for that channel. Messages wait in the queue.
//  - An absence alert is not sent if the register was corrected before sending, or if the
//    guardian's access to that child was removed.
//  - Pausing alerts (alerts_enabled = 0) stops all sending. Nothing is lost.
//
// Known limit: if the process dies after a provider accepted a message but before the database
// was updated, the message is sent again on recovery. Providers that support idempotency keys
// should be given the dedupe key. This is a known at-least-once window, documented in PHASE2_STATUS.md.
import db from '../../db/index.js';
import { normalizePhone, normalizeEmail } from '../../utils/validate.js';
import { send, ProviderError } from './providers.js';
import { smsSegments } from './templates.js';

export const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 1800, 7200];
const MAX_QUEUE_AGE_HOURS = 72;
const SENDING_STALE_MINUTES = 5;
const NOT_CONFIGURED_RETRY_SECONDS = 600;
export const CHANNELS = ['sms', 'whatsapp', 'email'];

const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export function getConfig() {
  return db.prepare('SELECT * FROM messaging_config WHERE id = 1').get();
}

/** Returns { ok, value } or { ok: false, error } for a channel's recipient address. */
export function normalizeRecipient(channel, raw) {
  if (channel === 'email') {
    const e = normalizeEmail(raw);
    return e ? { ok: true, value: e } : { ok: false, error: 'no valid email address' };
  }
  const p = normalizePhone(raw);
  if (!p.ok) return p;
  if (!p.value) return { ok: false, error: 'no phone number' };
  return { ok: true, value: p.value };
}

export function isOptedOut(recipient, channel) {
  return !!db.prepare('SELECT 1 FROM message_optouts WHERE recipient = ? AND channel = ?').get(recipient, channel);
}

export function quotaFor(channel, config = getConfig()) {
  return config[`${channel}_monthly_quota`];
}

/** Messages successfully sent this calendar month on one channel (UTC month start). */
export function usageThisMonth(channel) {
  const row = db.prepare(`
    SELECT COUNT(*) AS messages, COALESCE(SUM(cost_units), 0) AS cost_units
    FROM message_outbox
    WHERE channel = ? AND status = 'sent' AND sent_at >= datetime('now', 'start of month')`).get(channel);
  return { messages: row.messages, cost_units: row.cost_units };
}

/**
 * Adds one message to the queue. Returns { inserted, id }. A duplicate dedupe_key is ignored.
 * contact_missing = true records a skipped row, so the admin can see which guardians have no contact.
 */
export function enqueue({ channel, recipient = null, user_id = null, student_id = null, template_id, subject = '', body,
  dedupe_key, event_kind, event_date = null, event_status = null, contact_missing = false }) {
  const status = contact_missing ? 'skipped_no_contact' : 'queued';
  const info = db.prepare(`
    INSERT OR IGNORE INTO message_outbox
      (channel, recipient, user_id, student_id, template_id, subject, body, dedupe_key, event_kind, event_date, event_status, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    channel, recipient, user_id, student_id, template_id, subject, body, dedupe_key,
    event_kind, event_date, event_status, status);
  return { inserted: info.changes > 0, id: info.lastInsertRowid };
}

/**
 * For an attendance alert, is the event still true, and does the guardian still have access?
 * Corrected registers and removed links both stop the alert.
 */
export function eventStillValid(row) {
  if (row.event_kind !== 'attendance') return true;
  const att = db.prepare(`SELECT status FROM attendance_records
    WHERE student_id = ? AND date = ? AND subject_id IS NULL`).get(row.student_id, row.event_date);
  if (!att || att.status !== row.event_status) return false;
  const link = db.prepare(`SELECT 1 FROM guardian_students gs JOIN users s ON s.id = gs.student_id
    WHERE gs.guardian_id = ? AND gs.student_id = ? AND gs.restricted = 0 AND gs.can_view_attendance = 1
      AND s.account_status NOT IN ('archived','disabled')`).get(row.user_id, row.student_id);
  return !!link;
}

function costFor(channel, body) {
  if (channel === 'sms') return smsSegments(body);
  return 1;
}

/**
 * Sends due messages. Returns a count per outcome.
 * Safe to call often, and from more than one place (the timer and the admin "process now" button).
 */
export async function processOutbox({ limit = 100 } = {}) {
  const counts = { sent: 0, simulated: 0, retried: 0, failed: 0, skipped: 0, held: 0, paused: false };

  // A message stuck in 'sending' means the process died mid-send. Put it back in the queue.
  db.prepare(`UPDATE message_outbox SET status = 'queued', last_error = 'recovered after interrupted send', updated_at = datetime('now')
    WHERE status = 'sending' AND updated_at < datetime('now', ?)`).run(`-${SENDING_STALE_MINUTES} minutes`);

  // Messages that waited too long are not sent. A late absence alert is not useful.
  db.prepare(`UPDATE message_outbox SET status = 'failed', last_error = 'expired before delivery', updated_at = datetime('now')
    WHERE status = 'queued' AND created_at < datetime('now', ?)`).run(`-${MAX_QUEUE_AGE_HOURS} hours`);

  const config = getConfig();
  if (!config.alerts_enabled) { counts.paused = true; return counts; }

  const due = db.prepare(`SELECT * FROM message_outbox
    WHERE status = 'queued' AND next_attempt_at <= datetime('now') ORDER BY id LIMIT ?`).all(limit);

  const remaining = {};
  for (const ch of CHANNELS) {
    const used = usageThisMonth(ch).messages;
    remaining[ch] = Math.max(0, quotaFor(ch, config) - used);
  }

  for (const row of due) {
    const channelOn = config[`${row.channel}_enabled`];
    if (!channelOn) { counts.held++; continue; }

    if (isOptedOut(row.recipient, row.channel)) {
      db.prepare(`UPDATE message_outbox SET status = 'skipped_optout', updated_at = datetime('now') WHERE id = ?`).run(row.id);
      counts.skipped++; continue;
    }

    if (!eventStillValid(row)) {
      db.prepare(`UPDATE message_outbox SET status = 'skipped_stale', last_error = 'register or access changed before sending', updated_at = datetime('now') WHERE id = ?`).run(row.id);
      counts.skipped++; continue;
    }

    if (remaining[row.channel] <= 0) {
      db.prepare(`UPDATE message_outbox SET last_error = 'monthly quota reached', updated_at = datetime('now') WHERE id = ?`).run(row.id);
      counts.held++; continue;
    }

    // Claim the row. If another worker already took it, do nothing.
    const claim = db.prepare(`UPDATE message_outbox SET status = 'sending', attempts = attempts + 1, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'`).run(row.id);
    if (claim.changes === 0) continue;
    const attempts = row.attempts + 1;

    try {
      const result = await send({ channel: row.channel, recipient: row.recipient, subject: row.subject, body: row.body });
      if (result.simulated) {
        db.prepare(`UPDATE message_outbox SET status = 'simulated', provider_message_id = ?, cost_units = 0, updated_at = datetime('now') WHERE id = ?`)
          .run(result.provider_message_id, row.id);
        counts.simulated++;
      } else {
        const cost = result.cost_units ?? costFor(row.channel, row.body);
        db.prepare(`UPDATE message_outbox SET status = 'sent', provider_message_id = ?, cost_units = ?, sent_at = datetime('now'),
          last_error = NULL, updated_at = datetime('now') WHERE id = ?`).run(result.provider_message_id, cost, row.id);
        remaining[row.channel]--;
        counts.sent++;
      }
    } catch (err) {
      const msg = String(err.message || err).slice(0, 300);
      if (err instanceof ProviderError && err.notConfigured) {
        // Hold it. Do not count the attempt, and try again later.
        db.prepare(`UPDATE message_outbox SET status = 'queued', attempts = attempts - 1, last_error = ?,
          next_attempt_at = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(msg, sqlTime(Date.now() + NOT_CONFIGURED_RETRY_SECONDS * 1000), row.id);
        counts.held++;
      } else if (err instanceof ProviderError && err.permanent) {
        db.prepare(`UPDATE message_outbox SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`).run(msg, row.id);
        counts.failed++;
      } else if (attempts >= MAX_ATTEMPTS) {
        db.prepare(`UPDATE message_outbox SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(`gave up after ${attempts} attempts: ${msg}`, row.id);
        counts.failed++;
      } else {
        const wait = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
        db.prepare(`UPDATE message_outbox SET status = 'queued', last_error = ?, next_attempt_at = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(msg, sqlTime(Date.now() + wait * 1000), row.id);
        counts.retried++;
      }
    }
  }
  return counts;
}

/** Delivery summary for the admin page: counts by status and channel, and the monthly usage against quota. */
export function deliverySummary(days = 30) {
  const rows = db.prepare(`SELECT channel, status, COUNT(*) AS n FROM message_outbox
    WHERE created_at >= datetime('now', ?) GROUP BY channel, status`).all(`-${days} days`);
  const byChannel = {};
  for (const ch of CHANNELS) byChannel[ch] = { by_status: {}, delivery_rate: null };
  for (const r of rows) byChannel[r.channel].by_status[r.status] = r.n;
  for (const ch of CHANNELS) {
    const s = byChannel[ch].by_status;
    const sent = s.sent || 0, failed = s.failed || 0;
    byChannel[ch].delivery_rate = sent + failed > 0 ? Math.round((sent / (sent + failed)) * 1000) / 10 : null;
  }
  const config = getConfig();
  const usage = {};
  for (const ch of CHANNELS) {
    const u = usageThisMonth(ch);
    usage[ch] = { messages: u.messages, cost_units: u.cost_units, quota: quotaFor(ch, config), remaining: Math.max(0, quotaFor(ch, config) - u.messages) };
  }
  return { days, channels: byChannel, usage_this_month: usage, alerts_enabled: !!config.alerts_enabled };
}
