// Sends one test email through the same SMTP path the app uses for live messages, and reports what the relay said.
// Usage (from server/):  npm run smtp:check -- you@your-domain.example
// Reads the server environment (.env). It never prints the password.
import 'dotenv/config';
import { send } from '../src/services/messaging/providers.js';

const to = process.argv[2] || process.env.SMTP_CHECK_TO;
const provider = (process.env.MESSAGING_EMAIL_PROVIDER || '').toLowerCase();

console.log('SMTP check');
console.log(`  MESSAGING_EMAIL_PROVIDER: ${provider || '(not set)'}`);
console.log(`  SMTP_HOST: ${process.env.SMTP_HOST || '(not set)'}   SMTP_PORT: ${process.env.SMTP_PORT || '587 (default)'}`);
console.log(`  SMTP_FROM: ${process.env.SMTP_FROM || '(not set)'}`);
console.log(`  SMTP_USER: ${process.env.SMTP_USER || '(not set: no SMTP AUTH)'}`);
console.log(`  SMTP_PASS: ${process.env.SMTP_USER ? (process.env.SMTP_PASS ? 'set' : 'MISSING') : 'not needed'}`);

if (provider !== 'smtp') {
  console.log('Result: NOT SENT. Set MESSAGING_EMAIL_PROVIDER=smtp in .env to test the relay.');
  process.exit(2);
}
if (!to) {
  console.log('Result: NOT SENT. Give a recipient you can read: npm run smtp:check -- you@your-domain.example');
  process.exit(2);
}

const body = 'This is a test message from the school fee system. If you can read it, the SMTP relay accepted it. No action needed.';
try {
  const r = await send({ channel: 'email', recipient: to, subject: 'NITEX SMTP check', body });
  console.log(`Result: ACCEPTED by the relay. Server response: ${r.response || '(no response text returned)'}`);
  console.log('Next: check the inbox and the spam folder of the recipient. Acceptance by the relay does not prove inbox delivery.');
  process.exit(0);
} catch (err) {
  const msg = String(err.message || err);
  console.log(`Result: NOT SENT. ${msg}`);
  console.log(`Hint: ${hintFor(msg)}`);
  process.exit(1);
}

function hintFor(msg) {
  if (/login rejected|EAUTH|\b535\b|authentication/i.test(msg)) {
    return 'Authentication failed. Check SMTP_USER and SMTP_PASS. Use a 16-character App Password for the sending account (2-Step Verification must be on), and check that "Require SMTP Authentication" is set in the relay settings.';
  }
  if (/\b5\d\d\b/.test(msg)) {
    return 'The relay refused the message. Check that SMTP_FROM is on a domain the relay allows ("Only addresses in my domains"), and that the recipient address exists.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|EHOSTUNREACH/i.test(msg)) {
    return 'The server could not reach SMTP_HOST on SMTP_PORT. Check the host name, the port (587), and outbound firewall rules.';
  }
  if (/TLS|STARTTLS|SSL|certificate/i.test(msg)) {
    return 'TLS negotiation failed. Port 587 needs STARTTLS. Check the port and the relay encryption setting.';
  }
  if (/not configured/i.test(msg)) {
    return 'Email settings are incomplete. Set MESSAGING_EMAIL_PROVIDER=smtp, SMTP_HOST, and SMTP_FROM.';
  }
  return 'See the message above. Send it to the platform team with the server response, and do not share the password.';
}
