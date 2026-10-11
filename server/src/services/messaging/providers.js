// Delivery adapters for parent alerts. The rest of the code talks only to send().
//
// Modes, per channel, set with MESSAGING_<SMS|WHATSAPP|EMAIL>_PROVIDER:
//   log   - writes nothing to the network. The message is recorded as 'simulated'.
//           Default outside production, so development never sends real messages.
//   none  - no provider configured. Messages are held in the queue, not failed.
//           Default in production until a provider is chosen (an open decision in the roadmap).
//   smtp  - email only, through SMTP settings in SMTP_* environment variables.
//
// No SMS or WhatsApp aggregator is wired in yet. The provider choice is open (roadmap section 4, item 4).
// When one is chosen, add a branch to sendSms or sendWhatsapp. Nothing else changes.
import { randomUUID } from 'crypto';
import nodemailer from 'nodemailer';

export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{permanent?: boolean, notConfigured?: boolean}} [opts]
   *   permanent: retrying will not help (bad address, rejected content).
   *   notConfigured: no provider is set up yet. Hold the message; do not count an attempt.
   */
  constructor(message, { permanent = false, notConfigured = false } = {}) {
    super(message);
    this.permanent = permanent;
    this.notConfigured = notConfigured;
  }
}

const overrides = {};

/** Tests only: replace one channel's sender. Pass null to restore the real adapter. */
export function setProviderForTest(channel, fn) {
  if (fn) overrides[channel] = fn;
  else delete overrides[channel];
}

function modeFor(channel) {
  const env = process.env[`MESSAGING_${channel.toUpperCase()}_PROVIDER`];
  if (env) return env;
  return process.env.NODE_ENV === 'production' ? 'none' : 'log';
}

async function sendSms(channel, { recipient }) {
  const mode = modeFor(channel);
  if (mode === 'log') return { simulated: true, provider_message_id: `log-${randomUUID()}`, cost_units: 0 };
  // 'none', and any real provider name that has not been implemented yet.
  throw new ProviderError(`${channel} provider is not configured (mode "${mode}"). Message held for ${recipient ? 'this recipient' : 'delivery'}.`, { notConfigured: true });
}

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
  const mode = modeFor('email');
  if (mode === 'log') return { simulated: true, provider_message_id: `log-${randomUUID()}`, cost_units: 0 };
  if (mode !== 'smtp' || !process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new ProviderError('email is not configured (set MESSAGING_EMAIL_PROVIDER=smtp and SMTP_HOST, SMTP_FROM)', { notConfigured: true });
  }
  try {
    const info = await smtpTransport().sendMail({ from: process.env.SMTP_FROM, to: recipient, subject, text: body });
    return { provider_message_id: info.messageId || null, cost_units: 1 };
  } catch (err) {
    // SMTP 5xx means the server refused for good (for example, unknown mailbox). 4xx is worth retrying.
    const code = Number(err.responseCode);
    const permanent = code >= 500 && code < 600;
    throw new ProviderError(`SMTP ${code || 'error'}: ${err.message}`, { permanent });
  }
}

/**
 * Sends one message. Returns { provider_message_id, cost_units, simulated? }.
 * Throws ProviderError on failure.
 */
export async function send({ channel, recipient, subject = '', body }) {
  if (overrides[channel]) return overrides[channel]({ channel, recipient, subject, body });
  if (channel === 'email') return sendEmail({ recipient, subject, body });
  if (channel === 'sms' || channel === 'whatsapp') return sendSms(channel, { recipient, body });
  throw new ProviderError(`unknown channel ${channel}`, { permanent: true });
}
