// server.js — Local development entry (Vercel uses api/index.js)
import { createApp } from './src/app.js';
import dotenv from 'dotenv';
dotenv.config();


const PORT = process.env.PORT || 3000;
const app = await createApp();

app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   🏫  DEVANG CLASSES — RUNNING            ║');
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║   🌐  http://localhost:${PORT}               ║`);
  console.log(`║   📦  Environment: ${process.env.NODE_ENV || 'development'}             ║`);
  console.log('╠═══════════════════════════════════════════╣');
  console.log('');
});
