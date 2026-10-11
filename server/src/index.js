// Process entry point: binds the HTTP port. All app wiring lives in app.js.
import 'dotenv/config';
import { createApp } from './app.js';
import { processOutbox, purgeOldMessages } from './services/messaging/outbox.js';

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NITEX running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

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
