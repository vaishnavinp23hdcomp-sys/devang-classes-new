import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL or POSTGRES_URL must be set.');
}

const ssl =
  process.env.PGSSLMODE === 'require' ||
  (process.env.NODE_ENV === 'production' && connectionString.includes('neon.tech')) ||
  connectionString.includes('amazonaws.com')
    ? { rejectUnauthorized: false }
    : undefined;

export const pool = new pg.Pool({
  connectionString,
  ssl,
  max: 10
});

export default pool;
