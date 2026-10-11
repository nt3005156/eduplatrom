// Delivery adapters for parent alerts. The rest of the code talks only to send().
//
// Each channel has a mode, set with MESSAGING_<SMS|WHATSAPP|EMAIL>_PROVIDER:
//   log      - no network call. The message is recorded as 'simulated'.
//              Default outside production, so development never sends real messages.
//   none     - no provider configured. Messages are held in the queue, not failed.
//              Default in production until a provider is set up.
//   sparrow  - SMS through Sparrow SMS (Nepal). Env: SPARROW_TOKEN, SPARROW_FROM (approved sender ID).
//              Optional: SPARROW_API_URL (default https://api.sparrowsms.com/v2/sms/).
//   cloud    - WhatsApp through the WhatsApp Cloud API (Meta). Sends an APPROVED template only.
//              Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (one body variable).
//              Optional: WHATSAPP_TEMPLATE_LANG (default en), WHATSAPP_API_VERSION (default v21.0),
//              WHATSAPP_API_BASE (default https://graph.facebook.com).
//   smtp     - email through SMTP. Env: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM.
//
// Error classes (see ProviderError):
//   transient  - network error, timeout, HTTP 429 or 5xx. Retried with backoff.
//   permanent  - the address or content is rejected for good. Marked failed at once.
//   held       - credentials missing or rejected. The message waits; no attempt is used up.
import { randomUUID } from 'crypto';
import nodemailer from 'nodemailer';
import { smsSegments } from './templates.js';

export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{permanent?: boolean, notConfigured?: boolean}} [opts]
   *   notConfigured: the provider is not set up, or its credentials were rejected. Hold; do not count an attempt.
   *   permanent: retrying will not help.
   */
  constructor(message, { permanent = false, notConfigured = false } = {}) {
    super(message);
    this.permanent = permanent;
    this.notConfigured = notConfigured;
  }
}

const TIMEOUT_MS = 15_000;
const overrides = {};

/** Tests only: replace one channel's sender. Pass null to restore the real adapter. */
export function setProviderForTest(channel, fn) {
  if (fn) overrides[channel] = fn;
  else delete overrides[channel];
}

export function modeFor(channel) {
  const env = process.env[`MESSAGING_${channel.toUpperCase()}_PROVIDER`];
  if (env) return env;
  return process.env.NODE_ENV === 'production' ? 'none' : 'log';
}

const isSet = name => !!(process.env[name] && String(process.env[name]).trim());

/** Mode and whether the settings for that mode are present. Never returns secret values. */
export function providerStatus() {
  const sms = modeFor('sms');
  const wa = modeFor('whatsapp');
  const em = modeFor('email');
  return {
    sms: { mode: sms, configured: sms === 'log' || (sms === 'sparrow' && isSet('SPARROW_TOKEN') && isSet('SPARROW_FROM')) },
    whatsapp: { mode: wa, configured: wa === 'log' || (wa === 'cloud' && isSet('WHATSAPP_TOKEN') && isSet('WHATSAPP_PHONE_ID') && isSet('WHATSAPP_TEMPLATE')) },
    email: { mode: em, configured: em === 'log' || (em === 'smtp' && isSet('SMTP_HOST') && isSet('SMTP_FROM')) },
  };
}

const simulated = () => ({ simulated: true, provider_message_id: `log-${randomUUID()}`, cost_units: 0 });

/** Maps an HTTP failure from a provider API to our error classes. */
function httpFailure(label, status, detail) {
  const msg = `${label} HTTP ${status}${detail ? `: ${detail}` : ''}`;
  if (status === 401 || status === 403) return new ProviderError(`${label} rejected the credentials (HTTP ${status}). Messages are held until the settings are fixed.`, { notConfigured: true });
  if (status === 429 || status >= 500) return new ProviderError(msg);
  return new ProviderError(msg, { permanent: true });
}

async function postForm(url, form) {
  try {
    return await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(`network error: ${err.message}`); // transient
  }
}

// ---- SMS: Sparrow SMS (Nepal) -------------------------------------------------
// Documented request: POST /v2/sms/ with token, from, to (10-digit mobile numbers, comma-separated), text.
// The response format and sender-ID rules must be confirmed on a live account before a pilot.
export function nationalNumber(e164) {
  const m = /^\+977(9[678]\d{8})$/.exec(e164 || '');
  return m ? m[1] : null;
}

async function sendSparrow({ recipient, body }) {
  if (!isSet('SPARROW_TOKEN') || !isSet('SPARROW_FROM')) {
    throw new ProviderError('SMS (Sparrow) is not configured: set SPARROW_TOKEN and SPARROW_FROM', { notConfigured: true });
  }
  const to = nationalNumber(recipient);
  if (!to) throw new ProviderError('Sparrow SMS only reaches Nepal mobile numbers (+977 98/97/96)', { permanent: true });
  const url = process.env.SPARROW_API_URL || 'https://api.sparrowsms.com/v2/sms/';
  const form = new URLSearchParams({ token: process.env.SPARROW_TOKEN, from: process.env.SPARROW_FROM, to, text: body });
  const res = await postForm(url, form);
  const text = await res.text();
  if (!res.ok) throw httpFailure('Sparrow', res.status, text.slice(0, 200));
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain-text response */ }
  // Unknown non-200 codes are treated as transient (for example, out of credit) so nothing is lost.
  if (json && json.response_code !== undefined && Number(json.response_code) !== 200) {
    throw new ProviderError(`Sparrow rejected the message (code ${json.response_code}): ${json.response || ''}`.trim());
  }
  return { provider_message_id: json?.message_id ? String(json.message_id) : null, cost_units: smsSegments(body) };
}

// ---- WhatsApp: Cloud API (Meta) ----------------------------------------------
// Business-initiated messages must use an approved template. Template parameters cannot
// contain newlines or tabs, and are limited to 1024 characters, so the text is flattened first.
export function whatsappParam(text) {
  return String(text).replace(/\s*[\r\n\t]+\s*/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 1024);
}

// WhatsApp error codes that mean "the number cannot receive this" (permanent) or "the token is bad" (held).
const WA_TOKEN_ERRORS = new Set([190]);
const WA_PERMANENT_ERRORS = new Set([131026, 131047, 131051, 131021, 131030]);

async function sendWhatsapp({ recipient, body }) {
  if (!isSet('WHATSAPP_TOKEN') || !isSet('WHATSAPP_PHONE_ID') || !isSet('WHATSAPP_TEMPLATE')) {
    throw new ProviderError('WhatsApp is not configured: set WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE', { notConfigured: true });
  }
  const base = (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const url = `${base}/${version}/${process.env.WHATSAPP_PHONE_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(recipient).replace(/^\+/, ''),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: whatsappParam(body) }] }],
    },
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(`network error: ${err.message}`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = Number(json?.error?.code);
    const detail = json?.error?.message || '';
    if (WA_TOKEN_ERRORS.has(code)) throw new ProviderError(`WhatsApp token rejected (code ${code}). Messages are held until it is fixed.`, { notConfigured: true });
    if (WA_PERMANENT_ERRORS.has(code)) throw new ProviderError(`WhatsApp cannot deliver to this number (code ${code}): ${detail}`, { permanent: true });
    throw httpFailure('WhatsApp', res.status, `${code || ''} ${detail}`.trim());
  }
  return { provider_message_id: json?.messages?.[0]?.id || null, cost_units: 1 };
}

// ---- Email: SMTP ----------------------------------------------------------------
let transport = null;
let transportKey = '';
function smtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const key = `${host}:${port}:${process.env.SMTP_USER || ''}`;
  if (!transport || transportKey !== key) {
    transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
    transportKey = key;
  }
  return transport;
}

async function sendEmail({ recipient, subject, body }) {
  if (!isSet('SMTP_HOST') || !isSet('SMTP_FROM')) {
    throw new ProviderError('email is not configured (set MESSAGING_EMAIL_PROVIDER=smtp and SMTP_HOST, SMTP_FROM)', { notConfigured: true });
  }
  try {
    const info = await smtpTransport().sendMail({ from: process.env.SMTP_FROM, to: recipient, subject, text: body });
    return { provider_message_id: info.messageId || null, cost_units: 1 };
  } catch (err) {
    if (err.code === 'EAUTH') throw new ProviderError(`SMTP login rejected. Messages are held until SMTP_USER and SMTP_PASS are fixed.`, { notConfigured: true });
    const code = Number(err.responseCode);
    // 5xx: the server refused for good (for example, an unknown mailbox). 4xx and connection errors: retry.
    const permanent = code >= 500 && code < 600;
    throw new ProviderError(`SMTP ${code || err.code || 'error'}: ${err.message}`, { permanent });
  }
}

/**
 * Sends one message. Returns { provider_message_id, cost_units, simulated? }.
 * Throws ProviderError on failure.
 */
export async function send({ channel, recipient, subject = '', body }) {
  if (overrides[channel]) return overrides[channel]({ channel, recipient, subject, body });

  if (channel === 'email') {
    const mode = modeFor('email');
    if (mode === 'log') return simulated();
    if (mode === 'smtp') return sendEmail({ recipient, subject, body });
    if (mode === 'none') throw new ProviderError('email provider is not configured (mode "none")', { notConfigured: true });
    throw new ProviderError(`unknown email provider "${mode}"`, { notConfigured: true });
  }

  if (channel === 'sms') {
    const mode = modeFor('sms');
    if (mode === 'log') return simulated();
    if (mode === 'sparrow') return sendSparrow({ recipient, body });
    if (mode === 'none') throw new ProviderError('SMS provider is not configured (mode "none"). Messages are held.', { notConfigured: true });
    throw new ProviderError(`unknown SMS provider "${mode}"`, { notConfigured: true });
  }

  if (channel === 'whatsapp') {
    const mode = modeFor('whatsapp');
    if (mode === 'log') return simulated();
    if (mode === 'cloud') return sendWhatsapp({ recipient, body });
    if (mode === 'none') throw new ProviderError('WhatsApp provider is not configured (mode "none"). Messages are held.', { notConfigured: true });
    throw new ProviderError(`unknown WhatsApp provider "${mode}"`, { notConfigured: true });
  }

  throw new ProviderError(`unknown channel ${channel}`, { permanent: true });
}
