import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, rawRequest, signInWithOtp, truncateAuth, WEB_ORIGIN, type AuthTestApp } from '../support/test-app.js';

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

const LIMIT = 16 * 1024;
const verifyBody = (bytes: number) => {
  const base = { email: 'size@x.pe', otp: '000000', pad: '' };
  return { ...base, pad: 'x'.repeat(bytes - JSON.stringify(base).length) };
};

describe('auth request body limit (16 KiB)', () => {
  it('answers 413 to a body above the limit', async () => {
    const body = verifyBody(LIMIT + 1);
    expect(JSON.stringify(body).length).toBe(LIMIT + 1);
    expect((await t.post('/api/auth/sign-in/email-otp', body)).status).toBe(413);
  });

  it('passes a body exactly at the limit to the endpoint', async () => {
    const body = verifyBody(LIMIT);
    expect(JSON.stringify(body).length).toBe(LIMIT);
    const res = await t.post('/api/auth/sign-in/email-otp', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_OTP' });
  });

  it('answers 413 to a large body on /sign-out', async () => {
    expect((await t.post('/api/auth/sign-out', { pad: 'x'.repeat(3_000_000) })).status).toBe(413);
  });

  it('answers 413 to a chunked body, which has no Content-Length to check', async () => {
    const res = await rawRequest(t.url, {
      method: 'POST',
      path: '/api/auth/sign-in/email-otp',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, 'transfer-encoding': 'chunked' },
      chunks: ['{"email":"size@x.pe",', '"otp":"000000"}'],
    });
    expect(res.status).toBe(413);
  });

  it('still signs in with a normal body', async () => {
    expect(await signInWithOtp(t, 'normal@x.pe')).toContain('better-auth.session_token=');
  });
});

describe('user fields from sign-up (databaseHooks.user.create.before)', () => {
  const stored = async (email: string) =>
    (await client.query<{ name: string; image: string | null }>('select name, image from "user" where email = $1', [email])).rows[0];

  it('trims the name and cuts it to 100 characters', async () => {
    await signInWithOtp(t, 'long@x.pe', { name: `  ${'n'.repeat(3000)}  ` });
    expect((await stored('long@x.pe'))?.name).toBe('n'.repeat(100));
  });

  it('keeps a normal name as given, without the outer spaces', async () => {
    await signInWithOtp(t, 'ana@x.pe', { name: '  Ana Pérez  ' });
    expect((await stored('ana@x.pe'))?.name).toBe('Ana Pérez');
  });

  it.each(['javascript:alert(1)', 'http://example.com/a.png', 'not a url'])('drops the image %s', async (image) => {
    await signInWithOtp(t, 'img@x.pe', { image });
    expect((await stored('img@x.pe'))?.image).toBeNull();
  });

  it('keeps an https:// image', async () => {
    await signInWithOtp(t, 'img@x.pe', { image: 'https://example.com/a.png' });
    expect((await stored('img@x.pe'))?.image).toBe('https://example.com/a.png');
  });
});
