// Express application factory (used by server.js and Vercel serverless)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import apiRouter, { ensureSchema } from './api.js';
import { PROJECT_ROOT, UPLOADS_DIR } from './path.js';

export async function createApp() {
  await ensureSchema();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));
  app.use(express.static(path.join(PROJECT_ROOT, 'public')));

  app.use('/api', apiRouter);

  app.get('*', (req, res) => {
    const indexPath = path.join(PROJECT_ROOT, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(path.resolve(indexPath));
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
