import { Logger, type Provider } from '@nestjs/common';
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
    useFactory: (env: Env) => {
      const pool = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
      // An idle client dropped by the server (restart, admin kill) emits 'error' on the pool.
      // Without a listener Node exits; with it the pool simply opens a new connection.
      pool.on('error', (err) => new Logger('PgPool').warn(`idle client error: ${err.message}`));
      return pool;
    },
  },
  {
    provide: DB,
    inject: [PG_POOL],
    useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
  },
];
