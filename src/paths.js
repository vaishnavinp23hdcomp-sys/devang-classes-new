// Stable paths for local dev and Vercel serverless (cwd is not always the repo root; only /tmp is writable on Vercel).
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.join(__dirname, '..');

/** True on Vercel deployments (production/preview). Local `vercel dev` uses VERCEL_ENV=development — keep normal disk paths. */
function isVercelDeployed() {
  const e = process.env.VERCEL_ENV;
  if (e === 'production' || e === 'preview') return true;
  const v = process.env.VERCEL;
  if (v === '1' || v === 'true') return true;
  return false;
}

function resolveUploadsDir() {
  let dir;
  if (process.env.UPLOADS_DIR) {
    const raw = process.env.UPLOADS_DIR.trim();
    dir = path.isAbsolute(raw) ? raw : path.join(PROJECT_ROOT, raw);
  } else if (isVercelDeployed()) {
    dir = path.join(os.tmpdir(), "uploads");
  } else {
    dir = path.join(PROJECT_ROOT, 'public', 'uploads');
  }
  // Never write under /var/task on Vercel (read-only); env may still point at public/uploads.
  if (isVercelDeployed() && dir.startsWith('/var/task')) {
    return path.join(os.tmpdir(), "uploads");
  }
  return dir;
}

export const UPLOADS_DIR = resolveUploadsDir();

try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) {
  console.error('Uploads directory could not be created:', UPLOADS_DIR, e.message);
}
