// Phase 2: parent alert settings, delivery reports, notices, opt-outs. Admin only.
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';
import { normalizeRecipient, getConfig, processOutbox, deliverySummary, CHANNELS } from '../services/messaging/outbox.js';
import { queueNotice } from '../services/messaging/alerts.js';

const router = Router();
const LANGUAGES = ['en', 'ne', 'both'];
const BOOL_FIELDS = ['alerts_enabled', 'sms_enabled', 'whatsapp_enabled', 'email_enabled'];
const QUOTA_FIELDS = ['sms_monthly_quota', 'whatsapp_monthly_quota', 'email_monthly_quota'];

function publicConfig(c) {
  return {
    alerts_enabled: !!c.alerts_enabled,
    sms_enabled: !!c.sms_enabled,
    whatsapp_enabled: !!c.whatsapp_enabled,
    email_enabled: !!c.email_enabled,
    language: c.language,
    sms_monthly_quota: c.sms_monthly_quota,
    whatsapp_monthly_quota: c.whatsapp_monthly_quota,
    email_monthly_quota: c.email_monthly_quota,
    updated_at: c.updated_at,
  };
}

router.get('/config', requireAuth, requireAdmin, (req, res) => {
  res.json({ config: publicConfig(getConfig()) });
});

router.put('/config', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const updates = {};
  for (const f of BOOL_FIELDS) {
    if (body[f] === undefined) continue;
    if (typeof body[f] !== 'boolean') return res.status(400).json({ error: `${f} must be true or false` });
    updates[f] = body[f] ? 1 : 0;
  }
  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) return res.status(400).json({ error: 'language must be en, ne, or both' });
    updates.language = body.language;
  }
  for (const f of QUOTA_FIELDS) {
    if (body[f] === undefined) continue;
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) return res.status(400).json({ error: `${f} must be a whole number from 0 to 10000000` });
    updates[f] = n;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' });

  const before = publicConfig(getConfig());
  const cols = Object.keys(updates);
  db.prepare(`UPDATE messaging_config SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = 1`)
    .run(...cols.map(c => updates[c]));
  const after = publicConfig(getConfig());
  logAudit(req, { module: 'messaging', action: 'updated', description: `${req.user.name} changed parent alert settings: ${cols.join(', ')}`,
    previousValue: before, newValue: after });
  res.json({ config: after });
});

router.get('/summary', requireAuth, requireAdmin, (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json(deliverySummary(days));
});

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const where = [];
  const params = [];
  if (req.query.channel) {
    if (!CHANNELS.includes(req.query.channel)) return res.status(400).json({ error: 'channel must be sms, whatsapp, or email' });
    where.push('channel = ?'); params.push(req.query.channel);
  }
  if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
  const rows = db.prepare(`
    SELECT m.id, m.channel, m.recipient, m.template_id, m.subject, m.body, m.status, m.attempts, m.last_error,
           m.cost_units, m.event_kind, m.event_date, m.created_at, m.sent_at, u.name AS guardian_name, s.name AS student_name
    FROM message_outbox m
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN users s ON s.id = m.student_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.id DESC LIMIT ?`).all(...params, limit);
  res.json({ messages: rows });
});

// Class notice to guardians. Body is plain text, so the sanitiser is not needed; the length limit keeps SMS bills predictable.
router.post('/notices', requireAuth, requireAdmin, (req, res) => {
  const { title, body, channels, idempotency_key } = req.body || {};
  const classLevel = Number(req.body?.class_level);
  const section = req.body?.section ? String(req.body.section).trim().slice(0, 5) : null;
  if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > 12) return res.status(400).json({ error: 'class_level (1-12) is required' });
  if (!title || String(title).trim().length < 3 || String(title).length > 100) return res.status(400).json({ error: 'title must be 3 to 100 characters' });
  if (!body || String(body).trim().length < 3 || String(body).length > 480) return res.status(400).json({ error: 'body must be 3 to 480 characters' });
  if (!Array.isArray(channels) || channels.length === 0 || channels.some(c => !CHANNELS.includes(c))) {
    return res.status(400).json({ error: 'channels must be a non-empty list of sms, whatsapp, email' });
  }
  if (typeof idempotency_key !== 'string' || idempotency_key.length < 8 || idempotency_key.length > 100) {
    return res.status(400).json({ error: 'idempotency_key (8 to 100 characters) is required so a retried request does not send twice' });
  }
  const result = queueNotice({ class_level: classLevel, section, title: String(title).trim(), body: String(body).trim(),
    channels: [...new Set(channels)], idempotency_key });
  logAudit(req, { module: 'messaging', action: 'created',
    description: `${req.user.name} queued a notice to Class ${classLevel}${section ? ` ${section}` : ''}: ${result.queued} message(s)`,
    newValue: { class_level: classLevel, section, channels, ...result } });
  res.status(201).json(result);
});

router.get('/optouts', requireAuth, requireAdmin, (req, res) => {
  res.json({ optouts: db.prepare('SELECT recipient, channel, created_at FROM message_optouts ORDER BY created_at DESC').all() });
});

router.post('/optouts', requireAuth, requireAdmin, (req, res) => {
  const channel = req.body?.channel;
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'channel must be sms, whatsapp, or email' });
  const addr = normalizeRecipient(channel, req.body?.recipient);
  if (!addr.ok) return res.status(400).json({ error: addr.error });
  db.prepare('INSERT OR IGNORE INTO message_optouts (recipient, channel, created_by) VALUES (?,?,?)').run(addr.value, channel, req.user.id);
  logAudit(req, { module: 'messaging', action: 'updated', description: `${req.user.name} opted an address out of ${channel}` });
  res.status(201).json({ ok: true });
});

router.delete('/optouts', requireAuth, requireAdmin, (req, res) => {
  const channel = req.query.channel;
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'channel must be sms, whatsapp, or email' });
  const addr = normalizeRecipient(channel, req.query.recipient);
  if (!addr.ok) return res.status(400).json({ error: addr.error });
  db.prepare('DELETE FROM message_optouts WHERE recipient = ? AND channel = ?').run(addr.value, channel);
  logAudit(req, { module: 'messaging', action: 'updated', description: `${req.user.name} removed an opt-out for ${channel}` });
  res.json({ ok: true });
});

// Runs the worker now. The timer runs it every 30 seconds too.
router.post('/process', requireAuth, requireAdmin, async (req, res) => {
  res.json(await processOutbox());
});

export default router;
