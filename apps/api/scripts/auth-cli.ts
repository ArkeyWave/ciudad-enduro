// Config for the Better Auth CLI only (`auth generate`). It lives outside src/, so it never
// reaches the image. The pool never connects: generation only reads the options.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createAuth } from '../src/auth/auth.factory.js';
import { OtpMailer } from '../src/auth/mailer.js';
import type { OtpThrottle } from '../src/auth/otp-throttle.js';
import { loadEnv } from '../src/config/env.js';
import * as schema from '../src/db/schema/index.js';

const env = loadEnv({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://cli:cli@localhost:1/cli',
  WEB_ORIGIN: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'cli-only-secret-0123456789abcdef0123',
  BETTER_AUTH_URL: 'http://localhost:3000',
  RESEND_API_KEY: 'cli',
  EMAIL_FROM: 'cli@example.com',
  GOOGLE_CLIENT_ID: 'cli',
  GOOGLE_CLIENT_SECRET: 'cli',
  OTP_HMAC_SECRET: 'cli-only-secret-0123456789abcdef0123',
  TURNSTILE_SECRET_KEY: 'cli',
});

export const auth = createAuth({
  env,
  db: drizzle(new pg.Pool({ connectionString: env.DATABASE_URL }), { schema }),
  mailer: new OtpMailer(async () => {}),
  throttle: {} as OtpThrottle,
});
