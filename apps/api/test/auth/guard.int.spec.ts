import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, signInWithOtp, truncateAuth, type AuthTestApp } from '../support/test-app.js';

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
});

describe('global guard', () => {
  it('answers /api/me with 401 without a session', async () => {
    expect((await t.get('/api/me')).status).toBe(401);
  });

  it('answers /api/me with the signed-in user', async () => {
    const cookie = await signInWithOtp(t, 'me@x.pe');
    const res = await t.get('/api/me', { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: expect.any(String) as string, email: 'me@x.pe', name: '', role: 'rider' });
  });

  it('serves trails and health anonymously', async () => {
    expect((await t.get('/api/trails')).status).toBe(200);
    expect((await t.get('/api/health')).status).toBe(200);
  });

  it('answers 401 once the session row is deleted', async () => {
    const cookie = await signInWithOtp(t, 'del@x.pe');
    await client.query('delete from session');
    expect((await t.get('/api/me', { cookie })).status).toBe(401);
  });

  it('answers 401 for an expired session', async () => {
    const cookie = await signInWithOtp(t, 'exp@x.pe');
    await client.query(`update session set expires_at = now() - interval '1 minute'`);
    expect((await t.get('/api/me', { cookie })).status).toBe(401);
  });
});

describe('role is not client input', () => {
  it('gives role rider to a sign-up that asks for admin', async () => {
    // Better Auth replaces an `input: false` field with its default (db/schema.mjs:68-72).
    await signInWithOtp(t, 'admin@x.pe', { role: 'admin' });
    const { rows } = await client.query<{ role: string }>(`select role from "user" where email = 'admin@x.pe'`);
    expect(rows).toEqual([{ role: 'rider' }]);
  });

  it('gives role rider to a plain sign-up', async () => {
    await signInWithOtp(t, 'plain@x.pe');
    const { rows } = await client.query<{ role: string }>(`select role from "user" where email = 'plain@x.pe'`);
    expect(rows).toEqual([{ role: 'rider' }]);
  });
});
