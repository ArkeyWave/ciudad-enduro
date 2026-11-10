import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, SEND_PATH, truncateAuth, uniqueIp, type AuthTestApp } from '../support/test-app.js';
import { startTurnstileStub, turnstileToken } from '../support/turnstile-stub.js';

// The captcha plugin's onRequest runs before the origin check and our hooks.before
// (better-auth dist/api/index.mjs:167-183), so a refused token must leave no trace: no cooldown
// slot, no cap row, no mail.

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

const logRows = async () => (await client.query<{ n: number }>('select count(*)::int as n from otp_send_log')).rows[0]?.n;
const send = (email: string, headers: Record<string, string> = {}) =>
  t.post(SEND_PATH, { email, type: 'sign-in' }, { 'cf-connecting-ip': uniqueIp(), ...headers });
const withToken = (token: string) => ({ 'x-captcha-response': token });

async function expectRefused(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(((await res.json()) as { code?: string }).code).toBe(code);
  expect(await logRows()).toBe(0);
  expect(t.mails).toHaveLength(0);
}

describe('the send path needs a Turnstile token', () => {
  it('refuses a send without a token: 400 MISSING_RESPONSE, 0 rows, no mail, no siteverify call', async () => {
    const calls = t.turnstile.calls.length;
    await expectRefused(await send('none@x.pe'), 400, 'MISSING_RESPONSE');
    expect(t.turnstile.calls.length).toBe(calls);
  });

  it('refuses a token siteverify rejects: 403 VERIFICATION_FAILED, 0 rows, no mail', async () => {
    await expectRefused(await send('bad@x.pe', withToken('not-a-token')), 403, 'VERIFICATION_FAILED');
  });

  it('accepts a valid token: 1 row, 1 mail; siteverify gets the secret and the client IP', async () => {
    const ip = uniqueIp();
    const token = turnstileToken();
    const res = await send('ok@x.pe', { ...withToken(token), 'cf-connecting-ip': ip });
    expect(res.status).toBe(200);
    expect(await logRows()).toBe(1);
    expect(t.mails.map((m) => m.to)).toEqual(['ok@x.pe']);
    expect(t.turnstile.calls.at(-1)).toEqual({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip });
  });

  it('a refused send uses no cooldown slot: a valid send for the same address right after mails', async () => {
    await expectRefused(await send('retry@x.pe', withToken('not-a-token')), 403, 'VERIFICATION_FAILED');
    expect((await send('retry@x.pe', withToken(turnstileToken()))).status).toBe(200);
    expect(t.mails.map((m) => m.to)).toEqual(['retry@x.pe']);
  });

  it('refuses a token used before, also for another address', async () => {
    const token = turnstileToken();
    expect((await send('first@x.pe', withToken(token))).status).toBe(200);
    t.mails.length = 0;
    await client.query('truncate otp_send_log');
    await expectRefused(await send('second@x.pe', withToken(token)), 403, 'VERIFICATION_FAILED');
  });

  it('refuses a token issued for another hostname', async () => {
    await expectRefused(await send('host@x.pe', withToken(turnstileToken({ hostname: 'evil.example' }))), 403, 'VERIFICATION_FAILED');
  });

  it('refuses a token issued for another action', async () => {
    await expectRefused(await send('action@x.pe', withToken(turnstileToken({ action: 'login' }))), 403, 'VERIFICATION_FAILED');
  });
});

describe('no other auth path needs a token', () => {
  it('serves the code check, the Google start and the session read without one', async () => {
    const check = await t.post('/api/auth/sign-in/email-otp', { email: 'a@x.pe', otp: '000000' });
    expect(((await check.json()) as { code?: string }).code).not.toBe('MISSING_RESPONSE');
    const google = await t.post('/api/auth/sign-in/social', { provider: 'google', callbackURL: '/' });
    expect(google.status).toBe(200);
    expect((await t.get('/api/auth/get-session')).status).toBe(200);
  });
});

describe('siteverify unreachable fails closed', () => {
  it('answers 500 UNKNOWN_ERROR when the provider is down: 0 rows, no mail', async () => {
    const down = await startTurnstileStub();
    await down.close();
    const app = await createAuthTestApp({ turnstile: down });
    try {
      const res = await app.post(SEND_PATH, { email: 'down@x.pe', type: 'sign-in' }, withToken(turnstileToken()));
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code?: string }).code).toBe('UNKNOWN_ERROR');
      expect(await logRows()).toBe(0);
      expect(app.mails).toHaveLength(0);
    } finally {
      await app.app.close();
    }
  });

  it('answers 500 UNKNOWN_ERROR after the 10 s timeout when the provider hangs: 0 rows, no mail', { timeout: 20_000 }, async () => {
    const hung = await startTurnstileStub();
    hung.hang = true;
    const app = await createAuthTestApp({ turnstile: hung });
    try {
      const res = await app.post(SEND_PATH, { email: 'hung@x.pe', type: 'sign-in' }, withToken(turnstileToken()));
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code?: string }).code).toBe('UNKNOWN_ERROR');
      expect(await logRows()).toBe(0);
      expect(app.mails).toHaveLength(0);
    } finally {
      await app.app.close();
      await hung.close();
    }
  });
});
