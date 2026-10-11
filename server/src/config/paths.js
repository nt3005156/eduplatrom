// Where uploaded files live. Defaults to server/src/uploads (the location used before this setting existed).
// Set UPLOADS_DIR on a server or in a restore so files live outside the code folder.
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(here, '..', 'uploads');
