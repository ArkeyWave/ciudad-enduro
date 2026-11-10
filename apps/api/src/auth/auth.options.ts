import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import type { Env } from '../config/env.js';
import type { Database } from '../db/db.provider.js';
import * as authSchema from '../db/schema/auth.js';
import { DISABLED_AUTH_PATHS } from './auth-paths.js';
import type { OtpMailer } from './mailer.js';
import { hmacSha256 } from './otp-hash.js';
import { authBeforeHook, SEND_OTP_PATH } from './otp-throttle.hook.js';
import type { OtpThrottle } from './otp-throttle.js';

export type AuthDeps = { env: Env; db: Database; mailer: OtpMailer; throttle: OtpThrottle };

// Phase 0 never calls Google APIs after sign-in, so Google's tokens are never stored.
const withoutProviderTokens = <T extends object>(account: T) => ({
  data: { ...account, accessToken: null, refreshToken: null, idToken: null },
});

/** The full Better Auth configuration. Pure: no I/O, so the CLI and the tests can build it. */
export function buildAuthOptions({ env, db, mailer, throttle }: AuthDeps) {
  return {
    basePath: '/api/auth',
    baseURL: env.BETTER_AUTH_URL, // https in staging/prod → Secure + __Secure- cookies
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    user: {
      additionalFields: { role: { type: 'string', defaultValue: 'rider', input: false } },
      // A Google address must be verified on every sign-in, not only the first: without it an
      // attacker could pre-create the account with an unverified address (G1).
      validateUserInfo: ({ source }) => {
        if (source.method === 'oauth' && source.oauth?.providerId === 'google' && source.oauth.profile?.email_verified !== true) {
          return { error: 'google_email_unverified' };
        }
      },
    },
    account: { accountLinking: { enabled: false } },
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    },
    databaseHooks: {
      account: {
        create: { before: async (account) => withoutProviderTokens(account) },
        update: { before: async (account) => withoutProviderTokens(account) },
      },
    },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    rateLimit: {
      enabled: true,
      storage: 'memory', // one container; every window is at most 60 s
      // Per IP, before the throttle hook. Replaces the plugin default of 3 per 60 s.
      customRules: { [SEND_OTP_PATH]: { window: 60, max: 5 } },
    },
    advanced: {
      disableOriginCheck: false, // Better Auth turns the check off when NODE_ENV=test
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      // Answer before the mail I/O finishes: the response time must not reveal anything.
      backgroundTasks: { handler: (promise) => void promise.catch(() => {}) },
    },
    hooks: { before: authBeforeHook(throttle, mailer) },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: { hash: async (otp) => hmacSha256(env.OTP_HMAC_SECRET, otp) },
        resendStrategy: 'rotate',
        sendVerificationOTP: ({ email, otp }, ctx) => mailer.sendOtp(email, otp, ctx),
      }),
    ],
  } satisfies BetterAuthOptions;
}
