// Process entry point: binds the HTTP port. All app wiring lives in app.js.
import 'dotenv/config';
import { createApp } from './app.js';

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NITEX running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});
