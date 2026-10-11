// Real provider adapters, tested against local servers that speak each provider's protocol:
//   - Sparrow SMS: a local HTTP server standing in for api.sparrowsms.com
//   - WhatsApp Cloud API: a local HTTP server standing in for graph.facebook.com
//   - Email: a real SMTP server (smtp-server) listening on localhost
// Nothing here reaches a real phone, WhatsApp account, or mailbox.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { SMTPServer } from 'smtp-server';

process.env.NODE_ENV = 'test';
const { send, ProviderError, nationalNumber, whatsappParam, providerStatus } = await import('../src/services/messaging/providers.js');

// ---- fake HTTP provider -------------------------------------------------------
let httpServer, httpBase;
const seen = [];
const reply = { status: 200, body: '{}', contentType: 'application/json' };

before(async () => {
  httpServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: data });
      res.writeHead(reply.status, { 'Content-Type': reply.contentType });
      res.end(reply.body);
    });
  });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  httpBase = `http://127.0.0.1:${httpServer.address().port}`;

  // Real SMTP server on localhost. Recipients whose name starts with reject@ or tempfail@ get SMTP errors.
  smtpReceived.length = 0;
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    onRcptTo(address, _session, cb) {
      if (address.address.startsWith('reject@')) { const e = new Error('no such mailbox'); e.responseCode = 550; return cb(e); }
      if (address.address.startsWith('tempfail@')) { const e = new Error('try later'); e.responseCode = 421; return cb(e); }
      cb();
    },
    onData(stream, _session, cb) {
      let raw = '';
      stream.on('data', c => { raw += c; });
      stream.on('end', () => { smtpReceived.push(raw); cb(); });
    },
  });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  smtpPort = smtp.server.address().port;
});

after(async () => {
  httpServer?.close();
  await new Promise(r => smtp?.close(r));
});

let smtp = null, smtpPort = 0;
const smtpReceived = [];

function env(vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const SPARROW_ENV = () => ({
  MESSAGING_SMS_PROVIDER: 'sparrow',
  SPARROW_TOKEN: 'tok-test-123',
  SPARROW_FROM: 'NITEXTEST',
  SPARROW_API_URL: `${httpBase}/v2/sms/`,
});
const WA_ENV = () => ({
  MESSAGING_WHATSAPP_PROVIDER: 'cloud',
  WHATSAPP_TOKEN: 'wa-token-456',
  WHATSAPP_PHONE_ID: '1234567890',
  WHATSAPP_TEMPLATE: 'attendance_alert',
  WHATSAPP_TEMPLATE_LANG: 'en',
  WHATSAPP_API_VERSION: 'v21.0',
  WHATSAPP_API_BASE: httpBase,
});

beforeEach(() => {
  seen.length = 0;
  reply.status = 200; reply.body = '{}'; reply.contentType = 'application/json';
});

async function expectError(promise, check) {
  try { await promise; } catch (err) {
    assert.ok(err instanceof ProviderError, `expected ProviderError, got ${err?.constructor?.name}: ${err?.message}`);
    check(err);
    return err;
  }
  assert.fail('expected the send to fail');
}

// ---- Sparrow SMS ----------------------------------------------------------------
test('Sparrow: sends the documented form fields with the 10-digit national number', async () => {
  env({ ...SPARROW_ENV(), MESSAGING_SMS_PROVIDER: 'sparrow' });
  reply.body = JSON.stringify({ response_code: 200, message_id: 'sp-1' });
  const r = await send({ channel: 'sms', recipient: '+9779801234567', body: 'Ram was marked ABSENT on 2026-10-11.' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/v2/sms/');
  const form = new URLSearchParams(seen[0].body);
  assert.equal(form.get('token'), 'tok-test-123');
  assert.equal(form.get('from'), 'NITEXTEST');
  assert.equal(form.get('to'), '9801234567');
  assert.equal(form.get('text'), 'Ram was marked ABSENT on 2026-10-11.');
  assert.equal(r.provider_message_id, 'sp-1');
  assert.equal(r.cost_units, 1);
});

test('Sparrow: Nepali text is counted as UCS-2 segments', async () => {
  env(SPARROW_ENV());
  const text = 'अ'.repeat(71);
  const r = await send({ channel: 'sms', recipient: '+9779801234567', body: text });
  assert.equal(r.cost_units, 2);
});

test('Sparrow: a 5xx or 429 response is transient (retried)', async () => {
  env(SPARROW_ENV());
  reply.status = 503; reply.body = 'busy';
  const e1 = await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => { assert.equal(e.permanent, false); assert.equal(e.notConfigured, false); });
  assert.match(e1.message, /HTTP 503/);
  reply.status = 429;
  await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.permanent, false));
});

test('Sparrow: a rejected token holds messages (not counted as attempts, not failed)', async () => {
  env(SPARROW_ENV());
  reply.status = 401; reply.body = 'invalid token';
  await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.notConfigured, true));
});

test('Sparrow: a 400 response is permanent', async () => {
  env(SPARROW_ENV());
  reply.status = 400; reply.body = 'bad sender';
  await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.permanent, true));
});

test('Sparrow: a non-200 response_code in a 200 body is transient, not lost', async () => {
  env(SPARROW_ENV());
  reply.body = JSON.stringify({ response_code: 417, response: 'insufficient credit' });
  await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => { assert.equal(e.permanent, false); assert.match(e.message, /insufficient credit/); });
});

test('Sparrow: non-Nepal numbers are refused without calling the API', async () => {
  env(SPARROW_ENV());
  await expectError(send({ channel: 'sms', recipient: '+14155550123', body: 'x' }), e => assert.equal(e.permanent, true));
  assert.equal(seen.length, 0);
});

test('Sparrow: a network failure is transient', async () => {
  env({ ...SPARROW_ENV(), SPARROW_API_URL: 'http://127.0.0.1:1/v2/sms/' });
  await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.permanent, false));
});

test('Sparrow: missing settings hold messages', async () => {
  env({ ...SPARROW_ENV(), SPARROW_TOKEN: undefined });
  await expectError(send({ channel: 'sms', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.notConfigured, true));
  assert.equal(seen.length, 0);
});

test('nationalNumber accepts Nepal mobiles only', () => {
  assert.equal(nationalNumber('+9779801234567'), '9801234567');
  assert.equal(nationalNumber('+9779701234567'), '9701234567');
  assert.equal(nationalNumber('+97712345678'), null, 'landline is not a mobile');
  assert.equal(nationalNumber('+14155550123'), null);
});

// ---- WhatsApp Cloud API ----------------------------------------------------------
test('WhatsApp: sends an approved template with the text as one body parameter', async () => {
  env(WA_ENV());
  reply.body = JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] });
  const r = await send({ channel: 'whatsapp', recipient: '+9779801234567', body: 'Ram was marked ABSENT.\nContact the school.' });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/v21.0/1234567890/messages');
  assert.equal(seen[0].headers.authorization, 'Bearer wa-token-456');
  const payload = JSON.parse(seen[0].body);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '9779801234567', 'recipient without the leading +');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'attendance_alert');
  assert.equal(payload.template.language.code, 'en');
  const param = payload.template.components[0].parameters[0].text;
  assert.doesNotMatch(param, /[\r\n\t]/, 'template parameters cannot contain newlines');
  assert.equal(r.provider_message_id, 'wamid.ABC');
});

test('WhatsApp: a bad token (code 190) holds messages', async () => {
  env(WA_ENV());
  reply.status = 401; reply.body = JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token' } });
  await expectError(send({ channel: 'whatsapp', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.notConfigured, true));
});

test('WhatsApp: a number that cannot receive WhatsApp (code 131026) is permanent', async () => {
  env(WA_ENV());
  reply.status = 400; reply.body = JSON.stringify({ error: { code: 131026, message: 'Message undeliverable' } });
  await expectError(send({ channel: 'whatsapp', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.permanent, true));
});

test('WhatsApp: 5xx and 429 are transient', async () => {
  env(WA_ENV());
  reply.status = 500; reply.body = '{}';
  await expectError(send({ channel: 'whatsapp', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.permanent, false));
  reply.status = 429;
  await expectError(send({ channel: 'whatsapp', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.permanent, false));
});

test('WhatsApp: missing settings hold messages', async () => {
  env({ ...WA_ENV(), WHATSAPP_TEMPLATE: undefined });
  await expectError(send({ channel: 'whatsapp', recipient: '+9779801234567', body: 'x' }), e => assert.equal(e.notConfigured, true));
  assert.equal(seen.length, 0);
});

test('whatsappParam flattens newlines and limits length to 1024', () => {
  assert.equal(whatsappParam('a\n\nb\tc'), 'a · b · c');
  assert.equal(whatsappParam('x'.repeat(2000)).length, 1024);
  assert.equal(whatsappParam('a     b'), 'a   b', 'no more than 3 spaces in a row');
});

// ---- Email over real SMTP ---------------------------------------------------------
function smtpEnv(extra = {}) {
  // The local test server does not offer STARTTLS, so it needs the test-only opt-out. The next test checks the default.
  return { MESSAGING_EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_FROM: 'NITEX <noreply@school.test>', SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_ALLOW_PLAINTEXT: 'true', ...extra };
}

test('Email: without the test opt-out, a server that does not offer STARTTLS is refused and nothing is sent', async () => {
  const before = smtpReceived.length;
  env(smtpEnv({ SMTP_ALLOW_PLAINTEXT: undefined }));
  await assert.rejects(send({ channel: 'email', recipient: 'parent@school.test', subject: 'x', body: 'y' }));
  assert.equal(smtpReceived.length, before, 'no message crossed in clear text');
});

test('Email: delivers a message through a real SMTP exchange', async () => {
  env(smtpEnv());
  smtpReceived.length = 0;
  const r = await send({ channel: 'email', recipient: 'parent@example.test', subject: 'Attendance 2026-10-11', body: 'Ram was marked ABSENT.' });
  assert.equal(smtpReceived.length, 1);
  assert.match(smtpReceived[0], /Subject: Attendance 2026-10-11/);
  assert.match(smtpReceived[0], /To: parent@example\.test/);
  assert.match(smtpReceived[0], /Ram was marked ABSENT\./);
  assert.equal(r.cost_units, 1);
});

test('Email: a 550 from the server is permanent (bad mailbox)', async () => {
  env(smtpEnv());
  await expectError(send({ channel: 'email', recipient: 'reject@example.test', subject: 's', body: 'b' }), e => assert.equal(e.permanent, true));
});

test('Email: a 421 from the server is transient (retried)', async () => {
  env(smtpEnv());
  await expectError(send({ channel: 'email', recipient: 'tempfail@example.test', subject: 's', body: 'b' }), e => assert.equal(e.permanent, false));
});

test('Email: missing SMTP_HOST holds messages', async () => {
  env(smtpEnv({ SMTP_HOST: undefined }));
  await expectError(send({ channel: 'email', recipient: 'parent@example.test', subject: 's', body: 'b' }), e => assert.equal(e.notConfigured, true));
});

// ---- Status page data never exposes secrets ---------------------------------------
test('providerStatus reports mode and whether settings are present, never the secret values', () => {
  env({ ...SPARROW_ENV(), ...WA_ENV(), ...smtpEnv() });
  const s = providerStatus();
  assert.deepEqual(s.sms, { mode: 'sparrow', configured: true });
  assert.deepEqual(s.whatsapp, { mode: 'cloud', configured: true });
  assert.deepEqual(s.email, { mode: 'smtp', configured: true });
  const json = JSON.stringify(s);
  for (const secret of ['tok-test-123', 'wa-token-456']) assert.ok(!json.includes(secret));
  env({ SPARROW_TOKEN: undefined });
  assert.equal(providerStatus().sms.configured, false);
});

test('Production default is "none" (held) for every channel', () => {
  const prev = process.env.NODE_ENV;
  env({ NODE_ENV: 'production', MESSAGING_SMS_PROVIDER: undefined, MESSAGING_WHATSAPP_PROVIDER: undefined, MESSAGING_EMAIL_PROVIDER: undefined });
  try {
    const s = providerStatus();
    assert.equal(s.sms.mode, 'none');
    assert.equal(s.whatsapp.mode, 'none');
    assert.equal(s.email.mode, 'none');
  } finally {
    env({ NODE_ENV: prev });
  }
});
