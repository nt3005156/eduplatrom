// Process entry point: binds the HTTP port. All app wiring lives in app.js.
import 'dotenv/config';
import { createApp } from './app.js';
import { processOutbox, purgeOldMessages } from './services/messaging/outbox.js';
import { purgeExpiredRefreshTokens } from './services/sessions.js';
import { captureError } from './services/errorLog.js';

// Errors outside a request (a failed timer, an unhandled promise) are recorded too, then the process keeps going
// for rejections and exits for uncaught exceptions, as Node expects.
process.on('unhandledRejection', (err) => { console.error('unhandledRejection:', err); captureError(err, { route: 'process:unhandledRejection', status: 500 }); });
process.on('uncaughtException', (err) => { console.error('uncaughtException:', err); captureError(err, { route: 'process:uncaughtException', status: 500 }); process.exit(1); });

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NITEX running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Daily: delete refresh tokens that expired more than a day ago (they can never be used again).
setInterval(() => {
  try { purgeExpiredRefreshTokens(); }
  catch (err) { console.error('session cleanup error:', err.message); }
}, 24 * 60 * 60 * 1000).unref();

// Parent alert worker. Set MESSAGING_WORKER=off to run the HTTP server without sending.
if (process.env.MESSAGING_WORKER !== 'off') {
  const tick = () => processOutbox().catch(err => console.error('alert worker error:', err.message));
  setInterval(tick, 30_000).unref();
  // Daily: delete finished messages older than MESSAGING_RETENTION_DAYS (default 365).
  const purge = () => {
    try { const n = purgeOldMessages(); if (n) console.log(`alert retention: deleted ${n} old message(s)`); }
    catch (err) { console.error('alert retention error:', err.message); }
  };
  setInterval(purge, 24 * 60 * 60 * 1000).unref();
}
