import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ENV, loadEnv } from '../src/config/env.js';
import { configureApp } from '../src/configure-app.js';

export type Connect = (url: string) => pg.Client;

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const SUFFIX = /^[a-z0-9_]{1,32}$/;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Recreates `ciudad_enduro_test_<suffix>` on a local server and migrates it. The guards run
 * before any connection is opened, so a remote DATABASE_URL can never be dropped.
 */
export async function prepareTestDatabase(
  databaseUrl: string | undefined,
  suffix = 'main',
  connect: Connect = (url) => new pg.Client({ connectionString: url }),
): Promise<string> {
  if (!SUFFIX.test(suffix)) throw new Error(`TEST_DB_SUFFIX must match ${SUFFIX}`);
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(databaseUrl);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to use a test database on host ${url.hostname}`);
  }

  const name = `ciudad_enduro_test_${suffix}`;
  url.pathname = '/postgres';
  await withClient(connect(url.href), async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  });

  url.pathname = `/${name}`;
  await withClient(connect(url.href), async (client) => {
    await client.query('CREATE EXTENSION postgis');
    await migrate(drizzle(client), { migrationsFolder });
  });
  return url.href;
}

async function withClient(client: pg.Client, work: (client: pg.Client) => Promise<void>): Promise<void> {
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

/** URL of the test database prepared by the global setup. */
export function testDatabaseUrl(): string {
  return inject('testDatabaseUrl');
}

/** Opens a client on the test database for the duration of one spec file. */
export async function openTestClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  return client;
}

/** Boots the real AppModule on the test database, listening on a random port. */
export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(loadEnv({ ...process.env, DATABASE_URL: testDatabaseUrl(), ...env }))
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.listen(0, '127.0.0.1');
  return app;
}
