// Phase 2: parent alerts. Queue, dedupe, retries, opt-outs, quotas, stale checks, notices, admin-only access.
// Uses a fake provider (setProviderForTest), so nothing is sent to a real phone or mailbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nitex-messaging-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'messaging.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-789';
process.env.PUBLIC_URL = 'https://school.example.test';
delete process.env.MESSAGING_SMS_PROVIDER;
delete process.env.MESSAGING_EMAIL_PROVIDER;

const { createApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { setProviderForTest, ProviderError } = await import('../src/services/messaging/providers.js');
const { processOutbox, usageThisMonth, deliverySummary, MAX_ATTEMPTS } = await import('../src/services/messaging/outbox.js');
const { renderAttendanceAlert, smsSegments } = await import('../src/services/messaging/templates.js');

const ADMIN_PW = 'Admin-Msg-Pass-2026';
const STUDENT_PW = 'Student-Msg-Pass-2026';
const nepalPhone = k => `+97798${String(10000000 + k).padStart(8, '0')}`;
let server, base, adminToken, studentToken, n = 0;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });

async function api(method, url, { token, body } = {}) {
  const h = {};
  if (body) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

function student(cls, section) {
  n++;
  return Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, class_level, section, roll_no)
    VALUES (?,?,?,'student','approved','active',?,?,?)`).run(`Pupil ${n}`, `pupil${n}@msg.test`, bcrypt.hashSync(STUDENT_PW, 4), cls, section, String(n)).lastInsertRowid);
}

function guardian({ phone = nepalPhone(++n), email = `guardian${n}@msg.test`, status = 'active' } = {}) {
  const roleId = db.prepare("SELECT id FROM roles WHERE key = 'guardian'").get().id;
  return Number(db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id, phone)
    VALUES (?,?,?,'guardian','approved',?,?,?)`).run(`Parent ${n}`, email, bcrypt.hashSync('Parent-Msg-Pass-2026', 4), status, roleId, phone).lastInsertRowid);
}

function link(gid, sid, { restricted = 0, canView = 1 } = {}) {
  db.prepare(`INSERT INTO guardian_students (guardian_id, student_id, relationship, can_view_attendance, restricted, created_by)
    VALUES (?,?, 'father', ?, ?, NULL)`).run(gid, sid, canView, restricted);
}

function unlink(gid, sid) {
  db.prepare('DELETE FROM guardian_students WHERE guardian_id = ? AND student_id = ?').run(gid, sid);
}

async function mark(section, sid, status) {
  return api('POST', '/api/attendance', { token: adminToken, body: { class_level: 10, section, date: today(), records: [{ student_id: sid, status }] } });
}

async function setConfig(fields) {
  const r = await api('PUT', '/api/messages/config', { token: adminToken, body: fields });
  assert.equal(r.status, 200, r.text);
}

function rowsFor(sid) {
  return db.prepare('SELECT * FROM message_outbox WHERE student_id = ? ORDER BY id').all(sid);
}

function backdate(id) {
  db.prepare(`UPDATE message_outbox SET next_attempt_at = datetime('now', '-1 minute') WHERE id = ?`).run(id);
}

// Start every test from an empty queue so earlier scenarios cannot leak into later counts.
function clearQueue() {
  db.prepare(`UPDATE message_outbox SET status = 'failed', last_error = 'test reset' WHERE status IN ('queued','sending')`).run();
}

const calls = { sms: [], email: [], whatsapp: [] };
const fakeSms = { mode: 'ok' };
const fakeEmail = { mode: 'ok' };

function installFakes() {
  setProviderForTest('sms', async (args) => {
    calls.sms.push(args);
    if (fakeSms.mode === 'transient') throw new ProviderError('network blip');
    if (fakeSms.mode === 'permanent') throw new ProviderError('invalid number', { permanent: true });
    return { provider_message_id: `fake-sms-${calls.sms.length}`, cost_units: smsSegments(args.body) };
  });
  setProviderForTest('email', async (args) => {
    calls.email.push(args);
    if (fakeEmail.mode === 'transient') throw new ProviderError('smtp 421 try later');
    return { provider_message_id: `fake-email-${calls.email.length}`, cost_units: 1 };
  });
}

before(async () => {
  const adminRole = db.prepare("SELECT id FROM roles WHERE key = 'system_admin'").get().id;
  db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, role_id)
    VALUES ('Principal', 'principal@msg.test', ?, 'admin', 'approved', 'active', ?)`).run(bcrypt.hashSync(ADMIN_PW, 4), adminRole);
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await api('POST', '/api/auth/login', { body: { email: 'principal@msg.test', password: ADMIN_PW } })).json.token;
  db.prepare(`INSERT INTO users (name, email, password_hash, role, approval_status, account_status, class_level, section)
    VALUES ('Pupil Login', 'login@msg.test', ?, 'student', 'approved', 'active', 10, 'LOGIN')`).run(bcrypt.hashSync(STUDENT_PW, 4));
  studentToken = (await api('POST', '/api/auth/login', { body: { email: 'login@msg.test', password: STUDENT_PW } })).json.token;
  installFakes();
});

after(() => {
  server?.close();
  setProviderForTest('sms', null);
  setProviderForTest('email', null);
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('an absence alert goes only to guardians who may see attendance, once per channel', async () => {
  clearQueue();
  await setConfig({ alerts_enabled: true, sms_enabled: true, email_enabled: true, language: 'en' });
  const sid = student(10, 'M01');
  const visible = guardian();
  const hidden = guardian();
  const restricted = guardian();
  link(visible, sid);
  link(hidden, sid, { canView: 0 });
  link(restricted, sid, { restricted: 1 });

  assert.equal((await mark('M01', sid, 'absent')).status, 200);
  const rows = rowsFor(sid);
  assert.deepEqual(rows.map(r => `${r.channel}:${r.user_id === visible ? 'visible' : 'other'}`).sort(), ['email:visible', 'sms:visible']);
  assert.ok(rows.every(r => r.status === 'queued'));

  // Marking the same absence again does not queue a second copy.
  await mark('M01', sid, 'absent');
  assert.equal(rowsFor(sid).length, 2);
});

test('queued alerts are sent once; a second run sends nothing more', async () => {
  clearQueue();
  const sentBeforeCount = calls.sms.length + calls.email.length;
  const sid = student(10, 'M02');
  const g = guardian();
  link(g, sid);
  await mark('M02', sid, 'absent');
  const first = await processOutbox();
  assert.equal(first.sent, 2);
  assert.equal(calls.sms.length + calls.email.length, sentBeforeCount + 2);
  const again = await processOutbox();
  assert.equal(again.sent, 0);
  assert.equal(calls.sms.length + calls.email.length, sentBeforeCount + 2, 'no duplicate sends');
  assert.ok(rowsFor(sid).every(r => r.status === 'sent' && r.sent_at));
  assert.equal(rowsFor(sid).find(r => r.channel === 'sms').cost_units, smsSegments(rowsFor(sid).find(r => r.channel === 'sms').body));
});

test('a transient failure is retried after backoff and then sent exactly once', async () => {
  clearQueue();
  await setConfig({ sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M03');
  const g = guardian();
  link(g, sid);
  await mark('M03', sid, 'absent');
  const row = rowsFor(sid)[0];

  fakeSms.mode = 'transient';
  const t1 = await processOutbox();
  assert.equal(t1.retried, 1);
  let after1 = db.prepare('SELECT * FROM message_outbox WHERE id = ?').get(row.id);
  assert.equal(after1.status, 'queued');
  assert.equal(after1.attempts, 1);
  assert.match(after1.last_error, /network blip/);
  assert.ok(new Date(after1.next_attempt_at.replace(' ', 'T') + 'Z') > new Date(), 'waits before the next try');

  const callsBefore = calls.sms.length;
  await processOutbox();
  assert.equal(calls.sms.length, callsBefore, 'does not retry before the backoff time');

  fakeSms.mode = 'ok';
  backdate(row.id);
  assert.equal((await processOutbox()).sent, 1);
  assert.equal(calls.sms.length, callsBefore + 1);
  assert.equal(db.prepare('SELECT status, attempts FROM message_outbox WHERE id = ?').get(row.id).status, 'sent');
  await processOutbox();
  assert.equal(calls.sms.length, callsBefore + 1, 'a sent message is never sent again');
});

test('after the maximum number of attempts the message is marked failed', async () => {
  clearQueue();
  const sid = student(10, 'M04');
  const g = guardian();
  link(g, sid);
  await mark('M04', sid, 'absent');
  const row = rowsFor(sid)[0];
  fakeSms.mode = 'transient';
  for (let i = 0; i < MAX_ATTEMPTS; i++) { backdate(row.id); await processOutbox(); }
  fakeSms.mode = 'ok';
  const f = db.prepare('SELECT status, attempts, last_error FROM message_outbox WHERE id = ?').get(row.id);
  assert.equal(f.status, 'failed');
  assert.equal(f.attempts, MAX_ATTEMPTS);
  assert.match(f.last_error, /gave up after 5 attempts/);
});

test('a permanent error (bad number) is not retried', async () => {
  clearQueue();
  const sid = student(10, 'M05');
  const g = guardian();
  link(g, sid);
  await mark('M05', sid, 'absent');
  const row = rowsFor(sid)[0];
  fakeSms.mode = 'permanent';
  await processOutbox();
  fakeSms.mode = 'ok';
  const f = db.prepare('SELECT status, attempts FROM message_outbox WHERE id = ?').get(row.id);
  assert.equal(f.status, 'failed');
  assert.equal(f.attempts, 1);
});

test('an opted-out address is never sent to, even if it was queued before the opt-out', async () => {
  clearQueue();
  const sid = student(10, 'M06');
  await setConfig({ sms_enabled: true, email_enabled: true });
  const phone = nepalPhone(++n);
  const g = guardian({ phone, email: `opt${n}@msg.test` });
  link(g, sid);
  await mark('M06', sid, 'absent');
  const r = await api('POST', '/api/messages/optouts', { token: adminToken, body: { channel: 'sms', recipient: phone } });
  assert.equal(r.status, 201);
  const sent = calls.sms.length;
  await processOutbox();
  assert.equal(calls.sms.length, sent, 'no SMS to the opted-out number');
  const smsRow = rowsFor(sid).find(x => x.channel === 'sms');
  assert.equal(smsRow.status, 'skipped_optout');
  assert.equal(rowsFor(sid).find(x => x.channel === 'email').status, 'sent', 'email is a different channel');
  await api('DELETE', `/api/messages/optouts?channel=sms&recipient=${encodeURIComponent(phone)}`, { token: adminToken });
});

test('the monthly quota stops sending on that channel; the rest wait in the queue', async () => {
  clearQueue();
  await setConfig({ sms_enabled: true, email_enabled: false, sms_monthly_quota: usageThisMonth('sms').messages + 1 });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const sid = student(10, `Q${i}`);
    const g = guardian();
    link(g, sid);
    await mark(`Q${i}`, sid, 'absent');
    ids.push(sid);
  }
  const sentBefore = calls.sms.length;
  const r = await processOutbox();
  assert.equal(r.sent, 1);
  assert.equal(calls.sms.length, sentBefore + 1, 'provider called once, not three times');
  const statuses = ids.map(sid => rowsFor(sid).find(x => x.channel === 'sms').status).sort();
  assert.deepEqual(statuses, ['queued', 'queued', 'sent']);
  assert.match(rowsFor(ids[1]).find(x => x.channel === 'sms').last_error, /quota/);
  await setConfig({ sms_monthly_quota: 1000 });
});

test('a channel with no provider holds messages instead of failing them', async () => {
  clearQueue();
  await setConfig({ sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M07');
  const g = guardian();
  link(g, sid);
  await mark('M07', sid, 'absent');
  // Use the real adapter (no override) with the "none" mode, which is the production default until a provider is chosen.
  setProviderForTest('sms', null);
  process.env.MESSAGING_SMS_PROVIDER = 'none';
  try {
    const r = await processOutbox();
    assert.equal(r.held, 1);
    const row = rowsFor(sid).find(x => x.channel === 'sms');
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 0, 'held messages do not use up attempts');
    assert.match(row.last_error, /not configured/);
  } finally {
    delete process.env.MESSAGING_SMS_PROVIDER;
    setProviderForTest('sms', async (args) => { calls.sms.push(args); return { provider_message_id: `fake-sms-${calls.sms.length}`, cost_units: 1 }; });
  }
  backdate(rowsFor(sid).find(x => x.channel === 'sms').id);
  await processOutbox();
  assert.equal(rowsFor(sid).find(x => x.channel === 'sms').status, 'sent', 'sent once the provider is set up');
  installFakes();
});

test('a register corrected before the alert is sent does not send the stale alert', async () => {
  clearQueue();
  await setConfig({ sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M08');
  const g = guardian();
  link(g, sid);
  await mark('M08', sid, 'absent');
  await mark('M08', sid, 'present');
  const sent = calls.sms.length;
  await processOutbox();
  assert.equal(calls.sms.length, sent);
  assert.equal(rowsFor(sid).find(x => x.channel === 'sms').status, 'skipped_stale');
});

test('removing a guardian\'s access stops their queued alerts', async () => {
  clearQueue();
  await setConfig({ sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M09');
  const g = guardian();
  link(g, sid);
  await mark('M09', sid, 'absent');
  unlink(g, sid);
  const sent = calls.sms.length;
  await processOutbox();
  assert.equal(calls.sms.length, sent);
  assert.equal(rowsFor(sid).find(x => x.channel === 'sms').status, 'skipped_stale');
});

test('pausing alerts stops sending without losing anything; resuming sends the queue', async () => {
  clearQueue();
  await setConfig({ alerts_enabled: false, sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M10');
  const g = guardian();
  link(g, sid);
  await mark('M10', sid, 'absent');
  // Alerts are paused, so nothing is queued at all: the register does not create backlog while off.
  assert.equal(rowsFor(sid).length, 0);
  await setConfig({ alerts_enabled: true });
  await mark('M10', sid, 'late');
  await setConfig({ alerts_enabled: false });
  const paused = await processOutbox();
  assert.equal(paused.paused, true);
  assert.equal(rowsFor(sid).find(x => x.channel === 'sms').status, 'queued');
  await setConfig({ alerts_enabled: true });
  assert.equal((await processOutbox()).sent, 1);
});

test('a guardian with no phone on file is recorded as skipped, so the admin can see the gap', async () => {
  clearQueue();
  await setConfig({ alerts_enabled: true, sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M11');
  const g = guardian({ phone: null });
  link(g, sid);
  await mark('M11', sid, 'absent');
  const row = rowsFor(sid).find(x => x.channel === 'sms');
  assert.equal(row.status, 'skipped_no_contact');
  const list = await api('GET', '/api/messages?status=skipped_no_contact', { token: adminToken });
  assert.ok(list.json.messages.some(m => m.id === row.id), 'visible in the admin list');
});

test('English, Nepali, and both-language alerts render correctly; SMS segments are counted', () => {
  const vars = { student: 'Asha', date: '2026-10-11', school: 'Test School' };
  assert.match(renderAttendanceAlert('absent', vars, 'en'), /ABSENT on 2026-10-11/);
  assert.match(renderAttendanceAlert('absent', vars, 'ne'), /अनुपस्थित/);
  const both = renderAttendanceAlert('late', vars, 'both');
  assert.match(both, /LATE/);
  assert.match(both, /ढिलो/);
  assert.equal(smsSegments('a'.repeat(160)), 1);
  assert.equal(smsSegments('a'.repeat(161)), 2);
  assert.equal(smsSegments('a'.repeat(153 * 2)), 2);
  assert.equal(smsSegments('अ'.repeat(70)), 1, 'Nepali text is UCS-2: 70 characters per SMS');
  assert.equal(smsSegments('अ'.repeat(71)), 2);
});

test('a class notice is queued once per guardian and a retried request does not send twice', async () => {
  clearQueue();
  await setConfig({ alerts_enabled: true, sms_enabled: true, email_enabled: true });
  const sid = student(11, 'N1');
  const g = guardian();
  link(g, sid);
  const body = { class_level: 11, section: 'N1', title: 'Sports day', body: 'Sports day is on Friday. Please send sports shoes.', channels: ['sms', 'email'], idempotency_key: 'notice-key-0001' };
  const first = await api('POST', '/api/messages/notices', { token: adminToken, body });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.queued, 2);
  const retry = await api('POST', '/api/messages/notices', { token: adminToken, body });
  assert.equal(retry.json.queued, 0);
  assert.equal(retry.json.duplicate, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM message_outbox WHERE event_kind = 'notice' AND dedupe_key LIKE '%notice-key-0001%'").get().c, 2);
  const sent = await processOutbox();
  assert.ok(sent.sent >= 2);
});

test('notice input is validated', async () => {
  const base = { class_level: 11, title: 'Holiday', body: 'School is closed on Monday.', channels: ['sms'], idempotency_key: 'notice-key-0002' };
  assert.equal((await api('POST', '/api/messages/notices', { token: adminToken, body: { ...base, channels: ['fax'] } })).status, 400);
  assert.equal((await api('POST', '/api/messages/notices', { token: adminToken, body: { ...base, body: 'hi' } })).status, 400);
  assert.equal((await api('POST', '/api/messages/notices', { token: adminToken, body: { ...base, idempotency_key: 'short' } })).status, 400);
  assert.equal((await api('POST', '/api/messages/notices', { token: adminToken, body: { ...base, class_level: 13 } })).status, 400);
});

test('settings are validated: language, quotas, and on/off switches', async () => {
  assert.equal((await api('PUT', '/api/messages/config', { token: adminToken, body: { language: 'fr' } })).status, 400);
  assert.equal((await api('PUT', '/api/messages/config', { token: adminToken, body: { sms_monthly_quota: -1 } })).status, 400);
  assert.equal((await api('PUT', '/api/messages/config', { token: adminToken, body: { alerts_enabled: 'yes' } })).status, 400);
  assert.equal((await api('PUT', '/api/messages/config', { token: adminToken, body: {} })).status, 400);
});

test('only admins can use the messaging API', async () => {
  assert.equal((await api('GET', '/api/messages/config', { token: studentToken })).status, 403);
  assert.equal((await api('GET', '/api/messages/summary', { token: studentToken })).status, 403);
  assert.equal((await api('POST', '/api/messages/notices', { token: studentToken, body: {} })).status, 403);
  assert.equal((await api('GET', '/api/messages/config')).status, 401);
});

test('the delivery summary reports status counts, delivery rate, and usage against quota', async () => {
  const r = await api('GET', '/api/messages/summary?days=30', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.json.channels.sms.by_status);
  assert.ok('delivery_rate' in r.json.channels.sms);
  assert.ok(r.json.usage_this_month.sms.quota >= 0);
  assert.equal(typeof r.json.alerts_enabled, 'boolean');
});

test('an email with no SMTP setup is held, not failed', async () => {
  clearQueue();
  setProviderForTest('email', null);
  process.env.MESSAGING_EMAIL_PROVIDER = 'smtp';
  delete process.env.SMTP_HOST;
  await setConfig({ sms_enabled: false, email_enabled: true });
  const sid = student(10, 'M12');
  const g = guardian({ phone: null });
  link(g, sid);
  try {
    await mark('M12', sid, 'absent');
    const r = await processOutbox();
    assert.equal(r.held, 1);
    const row = rowsFor(sid).find(x => x.channel === 'email');
    assert.equal(row.status, 'queued');
    assert.match(row.last_error, /email is not configured/);
  } finally {
    delete process.env.MESSAGING_EMAIL_PROVIDER;
    installFakes();
    await setConfig({ sms_enabled: true, email_enabled: false });
  }
});

test('an alert interrupted mid-send is recovered and sent, not lost', async () => {
  clearQueue();
  await setConfig({ sms_enabled: true, email_enabled: false });
  const sid = student(10, 'M13');
  const g = guardian();
  link(g, sid);
  await mark('M13', sid, 'absent');
  const row = rowsFor(sid).find(x => x.channel === 'sms');
  db.prepare(`UPDATE message_outbox SET status = 'sending', updated_at = datetime('now', '-10 minutes') WHERE id = ?`).run(row.id);
  const r = await processOutbox();
  assert.equal(r.sent, 1);
  assert.equal(db.prepare('SELECT status FROM message_outbox WHERE id = ?').get(row.id).status, 'sent');
});

test('summary helper counts by channel without mixing channels', () => {
  const s = deliverySummary(30);
  for (const ch of ['sms', 'whatsapp', 'email']) assert.ok(ch in s.channels);
});

test('load: 1,000 queued messages are all sent in batches, with none lost or duplicated', async () => {
  clearQueue();
  await setConfig({ alerts_enabled: true, sms_enabled: true, email_enabled: false, sms_monthly_quota: 100000 });
  const { enqueue } = await import('../src/services/messaging/outbox.js');
  const tag = `load-${Date.now()}`;
  for (let i = 0; i < 1000; i++) {
    enqueue({ channel: 'sms', recipient: nepalPhone(50000 + i), template_id: 'notice.v1', body: `Notice ${i}`,
      dedupe_key: `sms|${tag}|${i}`, event_kind: 'notice' });
  }
  const seen = new Set();
  const sentBefore = calls.sms.length;
  const started = Date.now();
  let guard = 0;
  while (guard++ < 50) {
    const r = await processOutbox({ limit: 100 });
    if (r.sent === 0 && r.retried === 0 && r.failed === 0) break;
  }
  const elapsed = Date.now() - started;
  const rows = db.prepare(`SELECT status, COUNT(*) c FROM message_outbox WHERE dedupe_key LIKE ? GROUP BY status`).all(`sms|${tag}|%`);
  assert.deepEqual(rows, [{ status: 'sent', c: 1000 }]);
  assert.equal(calls.sms.length - sentBefore, 1000, 'exactly one provider call per message');
  for (const c of calls.sms.slice(sentBefore)) seen.add(c.recipient);
  assert.equal(seen.size, 1000, 'every recipient got one message');
  assert.ok(elapsed < 60_000, `1,000 messages took ${elapsed} ms`);
  console.log(`load test: 1000 messages in ${elapsed} ms with the fake provider`);
});
