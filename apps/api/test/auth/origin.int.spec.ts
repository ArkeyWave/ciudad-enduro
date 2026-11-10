import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, rawRequest, signInWithOtp, truncateAuth, WEB_ORIGIN, type AuthTestApp } from '../support/test-app.js';

// NODE_ENV=test turns Better Auth's origin check off unless the options set
// disableOriginCheck: false (create-context.mjs:211); these tests run with the real options.
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

const EVIL = 'https://evil.example';

describe('origin check on cookie-carrying requests', () => {
  // The router checks the Origin only when the request has a Cookie header (origin-check.mjs:101-108).
  const verify = (origin: string) =>
    t.post('/api/auth/sign-in/email-otp', { email: 'o@x.pe', otp: '000000' }, { origin, cookie: 'unrelated=1' });

  it('refuses a hostile Origin', async () => {
    expect((await verify(EVIL)).status).toBe(403);
  });

  it('lets the web origin through to the endpoint', async () => {
    const res = await verify(WEB_ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_OTP' });
  });
});

describe('callbackURL', () => {
  const social = (callbackURL: string) => t.post('/api/auth/sign-in/social', { provider: 'google', callbackURL });

  it('refuses a callback to another site', async () => {
    expect((await social(`${EVIL}/x`)).status).toBe(403);
  });

  it('accepts a callback to the web origin', async () => {
    expect((await social(`${WEB_ORIGIN}/`)).status).toBe(200);
  });
});

describe('no CORS (same origin behind Traefik)', () => {
  it('sends no Access-Control-Allow-* header to the web origin', async () => {
    const cookie = await signInWithOtp(t, 'cors@x.pe');
    for (const path of ['/api/me', '/api/auth/get-session']) {
      const res = await t.get(path, { origin: WEB_ORIGIN, cookie });
      expect(res.status).toBe(200);
      const cors = [...res.headers.keys()].filter((key) => key.startsWith('access-control-allow'));
      expect(cors, path).toEqual([]);
    }
  });
});

describe('sign-out CSRF (no cookie: the router origin check skips, origin-check.mjs:108)', () => {
  it('refuses a cross-site sign-out without a cookie and sends no cookie deletion', async () => {
    const res = await fetch(`${t.url}/api/auth/sign-out`, { method: 'POST', redirect: 'manual', headers: { origin: EVIL } });
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('signs out a session from the web origin', async () => {
    const cookie = await signInWithOtp(t, 'out@x.pe');
    const res = await t.post('/api/auth/sign-out', {}, { origin: WEB_ORIGIN, cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('better-auth.session_token=;') || /Max-Age=0/i.test(c))).toBe(true);
    expect((await client.query<{ n: number }>('select count(*)::int as n from session')).rows[0]?.n).toBe(0);
  });
});

describe('sign-in CSRF without a cookie (defence in depth)', () => {
  const body = JSON.stringify({ email: 'csrf@x.pe', otp: '000000' });
  const verify = (headers: Record<string, string>) =>
    rawRequest(t.url, {
      method: 'POST',
      path: '/api/auth/sign-in/email-otp',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length), ...headers },
      chunks: [body],
    });

  it('refuses a hostile Origin', async () => {
    expect((await verify({ origin: EVIL })).status).toBe(403);
  });

  it('passes a client that sends no Origin and no Sec-Fetch headers (mobile app)', async () => {
    const res = await verify({});
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'INVALID_OTP' });
  });

  it('passes the web origin', async () => {
    const res = await verify({ origin: WEB_ORIGIN, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'INVALID_OTP' });
  });
});
