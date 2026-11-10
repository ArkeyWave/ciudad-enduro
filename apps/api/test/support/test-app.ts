import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { MAIL_TRANSPORT, type MailTransport } from '../../src/auth/mailer.js';
import { hmacSha256 } from '../../src/auth/otp-hash.js';
import { ENV, loadEnv } from '../../src/config/env.js';
import { configureApp } from '../../src/configure-app.js';
import { testDatabaseUrl } from '../test-db.js';
import { captureTransport, type CapturedMail } from './capture-mailer.js';

export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
export const OTP_SECRET = process.env.OTP_HMAC_SECRET ?? '';

export type AuthTestApp = {
  app: INestApplication;
  url: string;
  mails: CapturedMail[];
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  get: (path: string, headers?: Record<string, string>) => Promise<Response>;
};

/** Boots the real AppModule on the test database with a capturing (or given) mail transport. */
export async function createAuthTestApp(
  options: { transport?: MailTransport; logger?: LoggerService | false } = {},
): Promise<AuthTestApp> {
  const capture = captureTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(loadEnv({ ...process.env, DATABASE_URL: testDatabaseUrl() }))
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(options.transport ?? capture.transport)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: options.logger ?? false, bodyParser: false }));
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    app,
    url,
    mails: capture.mails,
    post: (path, body, headers = {}) =>
      fetch(`${url}${path}`, {
        method: 'POST',
        redirect: 'manual',
        // Node's fetch sends Sec-Fetch-Mode, so Better Auth requires an Origin, as a browser sends.
        headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, 'cf-connecting-ip': uniqueIp(), ...headers },
        body: JSON.stringify(body),
      }),
    get: (path, headers = {}) =>
      fetch(`${url}${path}`, { redirect: 'manual', headers: { 'cf-connecting-ip': uniqueIp(), ...headers } }),
  };
}

let ipCounter = 0;
/**
 * A fresh client IP per request. Better Auth's in-memory rate limiter is a module-level Map
 * (rate-limiter/index.mjs:6) that a new app does not reset, so tests never share a bucket.
 */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export const AUTH_TABLES = '"user", session, account, verification, otp_send_log';

export async function truncateAuth(client: pg.Client): Promise<void> {
  await client.query(`TRUNCATE ${AUTH_TABLES} CASCADE`);
}

export function emailHash(email: string): string {
  return hmacSha256(OTP_SECRET, email.toLowerCase());
}

/** `name=value; name2=value2` from a response's Set-Cookie headers. */
export function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

export async function sendOtp(t: AuthTestApp, email: string, type = 'sign-in', headers: Record<string, string> = {}) {
  return t.post('/api/auth/email-otp/send-verification-otp', { email, type }, headers);
}

export function lastOtp(t: AuthTestApp, email: string): string {
  const mail = t.mails.findLast((m) => m.to === email);
  if (!mail) throw new Error(`no mail captured for ${email}`);
  return mail.otp;
}

/** Full email-code sign-in; returns the session cookie header. */
export async function signInWithOtp(t: AuthTestApp, email: string, extraBody: Record<string, unknown> = {}): Promise<string> {
  const sent = await sendOtp(t, email);
  if (sent.status !== 200) throw new Error(`send failed: ${sent.status}`);
  const res = await t.post('/api/auth/sign-in/email-otp', { email, otp: lastOtp(t, email), ...extraBody });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return cookieHeader(res);
}
