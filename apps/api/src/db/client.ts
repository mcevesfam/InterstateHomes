import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === 'true') {
    return true;
  }
  if (isDatabaseConfigured()) {
    return false;
  }
  // Never fail open to demo mode in production when DATABASE_URL is missing
  if (process.env.DEMO_MODE === 'false' || process.env.NODE_ENV === 'production') {
    return false;
  }
  return true;
}

export function getPool(): pg.Pool {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not configured.');
  }
  if (!pool) {
    const connectionString = process.env.DATABASE_URL!;
    const needsSsl =
      connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');
    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
    });
  }
  return pool;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}
