// Stable paths for local dev and Vercel serverless (cwd is not always the repo root; only /tmp is writable on Vercel).
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.join(__dirname, '..');

function resolveUploadsDir() {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR;
  if (process.env.VERCEL === '1') return '/tmp/uploads';
  return path.join(PROJECT_ROOT, 'public', 'uploads');
}

export const UPLOADS_DIR = resolveUploadsDir();

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) {
  console.error('Uploads directory could not be created:', UPLOADS_DIR, e.message);
}