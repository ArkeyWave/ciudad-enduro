import { z } from 'zod';

const secret = z.string().min(32);
const required = z.string().min(1);

// Secrets that production must never run with an example or dev/test value.
const SECRET_KEYS = ['BETTER_AUTH_SECRET', 'OTP_HMAC_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET', 'TURNSTILE_SECRET_KEY'] as const;
const NON_PRODUCTION_PREFIXES = ['dev-', 'test-'];
// Cloudflare's Turnstile test secrets (1x/2x/3x0…0AA) accept only a dummy token.
const TURNSTILE_TEST_SECRET = /^\dx0+AA$/;
const HTTPS_KEYS = ['BETTER_AUTH_URL', 'WEB_ORIGIN'] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.url(),
    // Raw strings: z.url() would trim the value; the refine below checks the exact text.
    WEB_ORIGIN: required,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: required,
    // Better Auth adds this list to trustedOrigins on its own (context/helpers.mjs:83-84).
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    RESEND_API_KEY: required,
    EMAIL_FROM: required,
    GOOGLE_CLIENT_ID: required,
    GOOGLE_CLIENT_SECRET: required,
    OTP_HMAC_SECRET: secret,
    TURNSTILE_SECRET_KEY: required,
    // Fills the elevations of a GPX that has none (plan §8 G5). Tests point it at a stub.
    ELEVATION_API_URL: z.url().default('https://api.open-meteo.com/v1/elevation'),
    // An unset Docker build arg arrives as an empty string; treat it like a missing value.
    BUILD_SHA: z.preprocess((v) => (v === '' ? undefined : v), required.default('unknown')),
  })
  .superRefine((env, ctx) => {
    // trustedOrigins and the CSRF check compare exact origins: a trailing slash or a path breaks sign-in.
    for (const key of HTTPS_KEYS) {
      if (!URL.canParse(env[key]) || new URL(env[key]).origin !== env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be an origin (scheme://host[:port], no path)' });
      }
    }
    if (env.NODE_ENV !== 'production') return;
    for (const key of SECRET_KEYS) {
      if (NON_PRODUCTION_PREFIXES.some((prefix) => env[key].startsWith(prefix))) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be a real secret in production' });
      }
    }
    if (TURNSTILE_TEST_SECRET.test(env.TURNSTILE_SECRET_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET_KEY'], message: 'must be a real secret in production' });
    }
    // Better Auth's own predicate for Secure, __Secure- cookies (cookies/index.mjs:23).
    for (const key of HTTPS_KEYS) {
      if (!env[key].startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be https in production' });
      }
    }
    if (env.BETTER_AUTH_TRUSTED_ORIGINS !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_TRUSTED_ORIGINS'], message: 'must not be set in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

/** Parses the environment. Call it lazily (inside a provider), never at import time. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  // The issue messages never contain the input value, so secrets stay out of the error.
  const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment: ${issues.join('; ')}`);
}
