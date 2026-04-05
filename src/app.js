// Express application factory (used by server.js and Vercel serverless)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import apiRouter, { ensureSchema } from './api.js';

const rootDir = process.cwd();

export async function createApp() {
  await ensureSchema();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  const uploadsDir = process.env.UPLOADS_DIR || path.join(rootDir, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use('/uploads', express.static(path.resolve(uploadsDir)));
  app.use(express.static(path.join(rootDir, 'public')));

  app.use('/api', apiRouter);

  app.get('*', (req, res) => {
    const indexPath = path.join(rootDir, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend not found. Make sure index.html is in the public/ folder.');
    }
  });

  app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 20MB)' });
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
