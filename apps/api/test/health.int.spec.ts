import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './test-db.js';

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

  it('answers 503 with db down when the database is unreachable', async () => {
    // Port 1 on localhost refuses connections immediately.
    expect(await health({ BUILD_SHA: 'abc123', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' })).toEqual({
      status: 503,
      body: { status: 'error', db: 'down', revision: 'abc123' },
    });
  });
});
