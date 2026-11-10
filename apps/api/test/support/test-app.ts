import { request as httpRequest } from 'node:http';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { TURNSTILE_SITEVERIFY_URL } from '../../src/auth/auth.module.js';
import { MAIL_TRANSPORT, type MailTransport } from '../../src/auth/mailer.js';
import { hmacSha256 } from '../../src/auth/otp-hash.js';
import { ENV, loadEnv } from '../../src/config/env.js';
import { configureApp } from '../../src/configure-app.js';
import { testDatabaseUrl } from '../test-db.js';
import { captureTransport, type CapturedMail } from './capture-mailer.js';
import { startTurnstileStub, turnstileToken, type TurnstileStub } from './turnstile-stub.js';

export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
export const OTP_SECRET = process.env.OTP_HMAC_SECRET ?? '';

export type AuthTestApp = {
  app: INestApplication;
  url: string;
  mails: CapturedMail[];
  /** The siteverify stub this app verifies captcha tokens against. */
  turnstile: TurnstileStub;
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
  get: (path: string, headers?: Record<string, string>) => Promise<Response>;
};

let sharedStub: Promise<TurnstileStub> | undefined;

/**
 * Boots the real AppModule on the test database with a capturing (or given) mail transport. The
 * captcha plugin verifies against a local siteverify stub (shared, or the given one), never Cloudflare.
 */
export async function createAuthTestApp(
  options: { transport?: MailTransport; logger?: LoggerService | false; turnstile?: TurnstileStub } = {},
): Promise<AuthTestApp> {
  const capture = captureTransport();
  const turnstile = options.turnstile ?? (await (sharedStub ??= startTurnstileStub()));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(loadEnv({ ...process.env, DATABASE_URL: testDatabaseUrl() }))
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(options.transport ?? capture.transport)
    .overrideProvider(TURNSTILE_SITEVERIFY_URL)
    .useValue(turnstile.url)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: options.logger ?? false, bodyParser: false }));
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    app,
    url,
    mails: capture.mails,
    turnstile,
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

export const SEND_PATH = '/api/auth/email-otp/send-verification-otp';

/** A send as the web makes it: with a fresh captcha token the stub accepts once. */
export async function sendOtp(t: AuthTestApp, email: string, type = 'sign-in', headers: Record<string, string> = {}) {
  return t.post(SEND_PATH, { email, type }, { 'x-captcha-response': turnstileToken(), ...headers });
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

/**
 * A request with exactly the given headers. Node's fetch always adds Sec-Fetch-Mode and computes
 * Content-Length; this one can omit both, or send a chunked body, like a non-browser client.
 */
export function rawRequest(
  url: string,
  options: { method: string; path: string; headers?: Record<string, string>; chunks?: string[] },
): Promise<{ status: number; body: string; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${url}${options.path}`, { method: options.method, headers: { 'cf-connecting-ip': uniqueIp(), ...options.headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, setCookie: res.headers['set-cookie'] ?? [] }));
    });
    req.on('error', reject);
    for (const chunk of options.chunks ?? []) req.write(chunk);
    req.end();
  });
}
