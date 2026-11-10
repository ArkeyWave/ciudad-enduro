import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

// Runs once per `vitest run`, in the main process. It must not import the application:
// app import-time side effects belong to the specs that test them.

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

export type Connect = (url: string) => pg.Client;

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const SUFFIX = /^[a-z0-9_]{1,32}$/;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export default async function setup(project: TestProject): Promise<void> {
  const url = await prepareTestDatabase(process.env.DATABASE_URL, process.env.TEST_DB_SUFFIX);
  project.provide('testDatabaseUrl', url);
}

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
  // pg-connection-string lets query parameters such as ?host= override the URL host, so a
  // query string could point the DROP DATABASE below at a remote server.
  if (url.search) throw new Error('DATABASE_URL for tests must not have query parameters');
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
