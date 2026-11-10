import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, SEND_PATH, truncateAuth, uniqueIp, type AuthTestApp } from '../support/test-app.js';
import { turnstileToken } from '../support/turnstile-stub.js';

// Each test takes fresh IPs from uniqueIp(): the limiter's memory is module-level and survives apps.
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

const send = (ip: string, n: number, headers: Record<string, string> = {}) =>
  t.post(SEND_PATH, { email: `rl${n}@x.pe`, type: 'sign-in' }, { 'cf-connecting-ip': ip, 'x-captcha-response': turnstileToken(), ...headers });
const verify = (ip: string, headers: Record<string, string> = {}) =>
  t.post('/api/auth/sign-in/email-otp', { email: 'rl@x.pe', otp: '000000' }, { 'cf-connecting-ip': ip, ...headers });

describe('send path: 5 per 60 s per cf-connecting-ip', () => {
  it('allows 5 sends from one IP, refuses the 6th, and keeps another IP separate', async () => {
    const a = uniqueIp();
    for (let i = 0; i < 5; i += 1) expect((await send(a, i)).status).toBe(200);
    expect((await send(a, 5)).status).toBe(429);
    expect((await send(uniqueIp(), 6)).status).toBe(200);
  });

  it('ignores a spoofed x-forwarded-for', async () => {
    const a = uniqueIp();
    for (let i = 0; i < 5; i += 1) expect((await send(a, i, { 'x-forwarded-for': uniqueIp() })).status).toBe(200);
    expect((await send(a, 5, { 'x-forwarded-for': uniqueIp() })).status).toBe(429);
  });
});

describe('/sign-in/email-otp: 3 per 60 s per cf-connecting-ip', () => {
  it('limits one IP and not another', async () => {
    const a = uniqueIp();
    for (let i = 0; i < 3; i += 1) expect((await verify(a)).status).toBe(400);
    expect((await verify(a)).status).toBe(429);
    expect((await verify(uniqueIp())).status).toBe(400);
  });
});
