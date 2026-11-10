import { AuthService } from '@thallesp/nestjs-better-auth';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISABLED_AUTH_PATHS, ENABLED_AUTH_PATHS } from '../../src/auth/auth-paths.js';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, lastOtp, sendOtp, truncateAuth, type AuthTestApp } from '../support/test-app.js';

let t: AuthTestApp;
let client: pg.Client;

beforeAll(async () => {
  t = await createAuthTestApp();
  client = await openTestClient();
});
afterAll(async () => {
  await client.end();
  await t.app.close();
});
beforeEach(async () => {
  await truncateAuth(client);
  t.mails.length = 0;
});

describe('auth paths are an allowlist', () => {
  it('enables exactly the allowlisted endpoints and disables every other one', () => {
    const api = t.app.get(AuthService).api as Record<string, { path?: string }>;
    const all = Object.values(api)
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => path !== undefined);
    const enabled = all.filter((path) => !DISABLED_AUTH_PATHS.includes(path));
    expect([...enabled].sort()).toEqual([...ENABLED_AUTH_PATHS].sort());
    // No stale entry: every disabled path is a real endpoint.
    expect(DISABLED_AUTH_PATHS.filter((path) => !all.includes(path))).toEqual([]);
  });

  it.each(DISABLED_AUTH_PATHS.map((path) => [path]))('%s answers 404', async (path) => {
    expect((await t.post(`/api/auth${path}`, { email: 'a@x.pe' })).status).toBe(404);
    expect((await t.get(`/api/auth${path}`)).status).toBe(404);
  });

  it('serves an enabled path', async () => {
    expect((await t.get('/api/auth/ok')).status).toBe(200);
  });
});

describe('the send answers before the mail I/O', () => {
  it('answers 200 within 1 s when the mail transport never resolves', async () => {
    const stuck = await createAuthTestApp({ transport: () => new Promise<void>(() => {}) });
    try {
      const started = performance.now();
      const res = await sendOtp(stuck, 'slow@x.pe');
      expect(res.status).toBe(200);
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      await stuck.app.close();
    }
  });
});

describe('the throttle hook leaves the sign-in endpoint alone', () => {
  it('signs in with the right code and rejects a wrong one with the endpoint error', async () => {
    await sendOtp(t, 'hook@x.pe');
    const otp = lastOtp(t, 'hook@x.pe');
    const wrong = await t.post('/api/auth/sign-in/email-otp', { email: 'hook@x.pe', otp: otp === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: 'INVALID_OTP' });
    const right = await t.post('/api/auth/sign-in/email-otp', { email: 'hook@x.pe', otp });
    expect(right.status).toBe(200);
    expect(await right.json()).toMatchObject({ user: { email: 'hook@x.pe' } });
  });
});
