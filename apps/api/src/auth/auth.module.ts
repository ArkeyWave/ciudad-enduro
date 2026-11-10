import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../db/db.provider.js';
import { createAuth } from './auth.factory.js';
import { authBodyLimit } from './body-limit.js';
import { MAIL_TRANSPORT, OtpMailer, resendTransport } from './mailer.js';
import { OtpThrottle } from './otp-throttle.js';

/**
 * Cloudflare's siteverify URL override. Null (Cloudflare) in every runtime; only the test
 * entrypoints replace it with a local stub. Deliberately not an env variable: no deployment can
 * point captcha checks elsewhere.
 */
export const TURNSTILE_SITEVERIFY_URL = Symbol('TURNSTILE_SITEVERIFY_URL');

/** Providers the Better Auth instance needs. Tests replace MAIL_TRANSPORT and TURNSTILE_SITEVERIFY_URL only. */
@Module({
  providers: [
    { provide: MAIL_TRANSPORT, inject: [ENV], useFactory: (env: Env) => resendTransport(env) },
    { provide: TURNSTILE_SITEVERIFY_URL, useValue: null },
    OtpMailer,
    OtpThrottle,
  ],
  exports: [OtpMailer, OtpThrottle, TURNSTILE_SITEVERIFY_URL],
})
export class AuthDepsModule {}

// Mounts Better Auth on /api/auth and registers its global guard: every route needs a
// session unless it carries @AllowAnonymous().
export const appAuthModule = AuthModule.forRootAsync({
  imports: [AuthDepsModule],
  inject: [DB, ENV, OtpMailer, OtpThrottle, TURNSTILE_SITEVERIFY_URL],
  useFactory: (db: Database, env: Env, mailer: OtpMailer, throttle: OtpThrottle, siteVerifyUrl: string | null) => ({
    auth: createAuth({ db, env, mailer, throttle, siteVerifyUrl }),
    // Same origin behind Traefik: no CORS. The adapter would otherwise answer the trusted origins.
    disableTrustedOriginsCors: true,
    bodyParser: { json: { limit: '1mb' } },
    middleware: authBodyLimit,
  }),
});
