import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, openTestClient } from './test-db.js';

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function health(env: Record<string, string>) {
  app = await createTestApp(env);
  const res = await fetch(`${await app.getUrl()}/api/health`);
  return { status: res.status, body: (await res.json()) as unknown };
}

describe('GET /api/health', () => {
  it('reports ok and the build revision when the database answers', async () => {
    expect(await health({ BUILD_SHA: 'abc123' })).toEqual({
      status: 200,
      body: { status: 'ok', db: 'ok', revision: 'abc123' },
    });
  });

  it('keeps serving after the database drops its idle connections', async () => {
    expect((await health({ BUILD_SHA: 'abc123' })).status).toBe(200);
    const admin = await openTestClient();
    try {
      const { rows } = await admin.query<{ n: number }>(
        'select count(pg_terminate_backend(pid))::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()',
      );
      expect(rows[0]?.n).toBeGreaterThan(0);
    } finally {
      await admin.end();
    }
    // Give the pool time to receive the termination before the next request.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const res = await fetch(`${await app!.getUrl()}/api/health`);
    expect(res.status).toBe(200);
  });

  it('answers 503 with db down when the database is unreachable', async () => {
    // Port 1 on localhost refuses connections immediately.
    expect(await health({ BUILD_SHA: 'abc123', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' })).toEqual({
      status: 503,
      body: { status: 'error', db: 'down', revision: 'abc123' },
    });
  });
});
