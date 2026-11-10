import { format } from 'node:util';
import type { LoggerService } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resendTransport, type MailTransport } from '../../src/auth/mailer.js';
import { loadEnv } from '../../src/config/env.js';
import { openTestClient } from '../test-db.js';
import { GoogleStub } from '../support/google-stub.js';
import { createAuthTestApp, sendOtp, truncateAuth, type AuthTestApp } from '../support/test-app.js';

// Every line written through the Nest logger or console while auth runs. No line may carry an
// OTP code, a session token or a plaintext e-mail address.
const lines: string[] = [];
const captureLogger: LoggerService = {
  log: (...args: unknown[]) => void lines.push(format(...args)),
  error: (...args: unknown[]) => void lines.push(format(...args)),
  warn: (...args: unknown[]) => void lines.push(format(...args)),
  debug: (...args: unknown[]) => void lines.push(format(...args)),
  verbose: (...args: unknown[]) => void lines.push(format(...args)),
  fatal: (...args: unknown[]) => void lines.push(format(...args)),
};

const codes: string[] = [];
const failures: unknown[] = [];
const google = new GoogleStub();
let t: AuthTestApp;
let client: pg.Client;

beforeAll(async () => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
  }
  google.install();
  google.resendFails();
  const real = resendTransport(loadEnv());
  // The real Resend transport (its API stubbed to fail for one address); the codes are recorded
  // here only so the assertions know what must not appear.
  const transport: MailTransport = async (message) => {
    codes.push(/\b\d{6}\b/.exec(message.text)?.[0] ?? 'missing');
    if (message.to !== 'fails@x.pe') return;
    try {
      await real(message);
    } catch (error) {
      failures.push(error);
      throw error;
    }
  };
  t = await createAuthTestApp({ transport, logger: captureLogger });
  client = await openTestClient();
  await truncateAuth(client);
});
afterAll(async () => {
  await client.end();
  await t.app.close();
  await google.uninstall();
  vi.restoreAllMocks();
});

describe('auth writes no secrets to the logs', () => {
  it('logs no code, session token or e-mail during a send, a failed send and a verification', async () => {
    expect((await sendOtp(t, 'logs@x.pe')).status).toBe(200);
    expect((await sendOtp(t, 'fails@x.pe')).status).toBe(200);
    await vi.waitFor(() => expect(failures).toHaveLength(1));

    const wrong = await t.post('/api/auth/sign-in/email-otp', { email: 'logs@x.pe', otp: codes[0] === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const res = await t.post('/api/auth/sign-in/email-otp', { email: 'logs@x.pe', otp: codes[0] });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    // A request with a cookie from another origin makes Better Auth log the rejected origin.
    await t.post('/api/auth/sign-in/email-otp', { email: 'logs@x.pe', otp: '000000' }, { origin: 'https://evil.example', cookie: 'x=1' });
    await new Promise((resolve) => setTimeout(resolve, 100)); // let background logging settle

    expect(codes).toHaveLength(2);
    expect(lines.length).toBeGreaterThan(0);
    const secrets = [...codes, token, 'logs@x.pe', 'fails@x.pe'];
    const leaks = lines.filter((line) => secrets.some((secret) => line.includes(secret)));
    expect(leaks).toEqual([]);
  });
});
