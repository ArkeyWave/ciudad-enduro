import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadEnv } from '../config/env.js';

// Applies pending migrations and exits. The container entrypoint runs it before the API;
// a failure exits non-zero and stops the container.
const pool = new pg.Pool({ connectionString: loadEnv().DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
} finally {
  await pool.end();
}
