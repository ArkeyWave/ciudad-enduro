import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacSha256 } from '../../src/auth/otp-hash.js';
import { openTestClient } from '../test-db.js';
import { cookieHeader, createAuthTestApp, lastOtp, OTP_SECRET, sendOtp, truncateAuth, type AuthTestApp } from '../support/test-app.js';

// Better Auth checks the OTP TTL with the JS clock, so only Date is faked. Every request has its own
// cf-connecting-ip (test-app.ts), so the per-IP limiter on /sign-in/email-otp never answers 429.
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = (ms = 1000) => vi.setSystemTime(Date.now() + ms);
const signIn = (email: string, otp: string) => t.post('/api/auth/sign-in/email-otp', { email, otp });
const wrongFor = (otp: string) => (otp === '000000' ? '111111' : '000000');
const sessions = async () => (await client.query<{ n: number }>('select count(*)::int as n from session')).rows[0]?.n;

async function sendCode(email: string): Promise<string> {
  expect((await sendOtp(t, email)).status).toBe(200);
  tick();
  return lastOtp(t, email);
}

describe('expiry (10 minutes)', () => {
  it('accepts the code just before 10 minutes and sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const otp = await sendCode('ttl1@x.pe');
    tick(600_000 - 2_000);
    const res = await signIn('ttl1@x.pe', otp);
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects the code at 10 minutes + 1 s', async () => {
    const otp = await sendCode('ttl2@x.pe');
    tick(600_000);
    const res = await signIn('ttl2@x.pe', otp);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'OTP_EXPIRED' });
  });
});

describe('attempts (5)', () => {
  it('accepts the right code after 4 wrong ones', async () => {
    const otp = await sendCode('att4@x.pe');
    for (let i = 0; i < 4; i += 1) {
      expect((await signIn('att4@x.pe', wrongFor(otp))).status).toBe(400);
      tick();
    }
    expect((await signIn('att4@x.pe', otp)).status).toBe(200);
  });

  it('rejects the right code after 5 wrong ones with TOO_MANY_ATTEMPTS', async () => {
    const otp = await sendCode('att5@x.pe');
    for (let i = 0; i < 5; i += 1) {
      expect((await signIn('att5@x.pe', wrongFor(otp))).status).toBe(400);
      tick();
    }
    const res = await signIn('att5@x.pe', otp);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });
});

describe('storage', () => {
  it('stores the HMAC of the code, not the code and not its plain SHA-256', async () => {
    const otp = await sendCode('store@x.pe');
    const { rows } = await client.query<{ value: string }>(
      `select value from verification where identifier = 'sign-in-otp-store@x.pe'`,
    );
    const [stored, attempts] = (rows[0]?.value ?? '').split(':');
    expect(attempts).toBe('0');
    expect(stored).toBe(hmacSha256(OTP_SECRET, otp));
    expect(stored).not.toBe(createHash('sha256').update(otp).digest('base64url'));
    expect(stored).not.toBe(otp);
  });
});

describe('single use', () => {
  it('rejects a code reused after a successful sign-in', async () => {
    const otp = await sendCode('once@x.pe');
    expect((await signIn('once@x.pe', otp)).status).toBe(200);
    tick();
    expect((await signIn('once@x.pe', otp)).status).toBe(400);
  });

  it('creates exactly one session when one code is verified twice at once', async () => {
    const otp = await sendCode('twice@x.pe');
    const results = await Promise.all([signIn('twice@x.pe', otp), signIn('twice@x.pe', otp)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await sessions()).toBe(1);
  });

  it('rotates on resend: the old code is rejected, the new one works', async () => {
    const first = await sendCode('rot@x.pe');
    await client.query('truncate otp_send_log'); // the 60 s cooldown uses the real DB clock
    const second = await sendCode('rot@x.pe');
    expect(second).not.toBe(first);
    const old = await signIn('rot@x.pe', first);
    expect(old.status).toBe(400);
    tick();
    const fresh = await signIn('rot@x.pe', second);
    expect(fresh.status).toBe(200);
    expect(cookieHeader(fresh)).toContain('better-auth.session_token=');
  });
});
