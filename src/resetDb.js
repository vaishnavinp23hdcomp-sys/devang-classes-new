// Wipes all tables and re-runs schema + seed (same as init-db).
// Usage: npm run reset-db
import "dotenv/config";
import pool from "./db.js";
import { runInit } from "./initDb.js";

async function reset() {
  console.log("⚠️  Resetting database (DROP SCHEMA public CASCADE)...");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  try {
    await pool.query("GRANT ALL ON SCHEMA public TO PUBLIC");
  } catch {
    /* optional on managed Postgres */
  }
  console.log("📦 Rebuilding schema and seed data...\n");
  await runInit();
  await pool.end();
}

reset().catch((e) => {
  console.error(e);
  process.exit(1);
});
