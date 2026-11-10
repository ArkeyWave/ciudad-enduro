import type { Provider } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import * as schema from './schema/index.js';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;

// Factory providers: nothing connects at import time, and Swagger's preview mode never runs them.
export const dbProviders: Provider[] = [
  {
    provide: PG_POOL,
    inject: [ENV],
    useFactory: (env: Env) => new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 }),
  },
  {
    provide: DB,
    inject: [PG_POOL],
    useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
  },
];
