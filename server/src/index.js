// Process entry point: binds the HTTP port. All app wiring lives in app.js.
import 'dotenv/config';
import { createApp } from './app.js';
import { processOutbox } from './services/messaging/outbox.js';

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NITEX running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Parent alert worker. Set MESSAGING_WORKER=off to run the HTTP server without sending.
if (process.env.MESSAGING_WORKER !== 'off') {
  const tick = () => processOutbox().catch(err => console.error('alert worker error:', err.message));
  setInterval(tick, 30_000).unref();
}
