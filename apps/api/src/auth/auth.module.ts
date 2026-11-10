import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../db/db.provider.js';
import { createAuth } from './auth.factory.js';
import { authBodyLimit } from './body-limit.js';
import { MAIL_TRANSPORT, OtpMailer, resendTransport } from './mailer.js';
import { OtpThrottle } from './otp-throttle.js';

/** Providers the Better Auth instance needs. Tests replace MAIL_TRANSPORT only. */
@Module({
  providers: [
    { provide: MAIL_TRANSPORT, inject: [ENV], useFactory: (env: Env) => resendTransport(env) },
    OtpMailer,
    OtpThrottle,
  ],
  exports: [OtpMailer, OtpThrottle],
})
export class AuthDepsModule {}

// Mounts Better Auth on /api/auth and registers its global guard: every route needs a
// session unless it carries @AllowAnonymous().
export const appAuthModule = AuthModule.forRootAsync({
  imports: [AuthDepsModule],
  inject: [DB, ENV, OtpMailer, OtpThrottle],
  useFactory: (db: Database, env: Env, mailer: OtpMailer, throttle: OtpThrottle) => ({
    auth: createAuth({ db, env, mailer, throttle }),
    // Same origin behind Traefik: no CORS. The adapter would otherwise answer the trusted origins.
    disableTrustedOriginsCors: true,
    bodyParser: { json: { limit: '1mb' } },
    middleware: authBodyLimit,
  }),
});
