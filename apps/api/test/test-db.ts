import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ENV, loadEnv } from '../src/config/env.js';
import { configureApp } from '../src/configure-app.js';

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
  const app = configureApp(moduleRef.createNestApplication({ logger: false, bodyParser: false }));
  await app.listen(0, '127.0.0.1');
  return app;
}
