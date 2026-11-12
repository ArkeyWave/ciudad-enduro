import { z } from 'zod';

const secret = z.string().min(32);
const required = z.string().min(1);

// Secrets that production must never run with an example or dev/test value.
const SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'OTP_HMAC_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'TURNSTILE_SECRET_KEY',
  'R2_SECRET_ACCESS_KEY',
] as const;
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
    // Photo storage (plan §9 V1, V6): Cloudflare R2 through the S3 API. S3_ENDPOINT replaces the R2
    // endpoint (the S3 mock in dev and CI) and switches to path-style addressing.
    R2_ACCOUNT_ID: z.string().optional(),
    S3_ENDPOINT: z.url().optional(),
    R2_ACCESS_KEY_ID: required,
    R2_SECRET_ACCESS_KEY: required,
    // Published photos only, read through the public domain (plan §9 V1c).
    R2_MEDIA_BUCKET: required,
    // Every uploaded photo; no public access. Drafts are read through presigned URLs (V1c).
    R2_PRIVATE_BUCKET: required,
    // The public read origin of the bucket (prod https://media.enduro.vops.pe), no trailing slash.
    MEDIA_PUBLIC_BASE_URL: z.url().refine((url) => !url.endsWith('/'), 'must not end with a slash'),
    // Staging shares the buckets under "staging/". Empty or path segments that each end with "/".
    MEDIA_KEY_PREFIX: z
      .string()
      .regex(/^(?:[a-z0-9-]+\/)*$/, 'must be empty or like "staging/"')
      .default(''),
    // An unset Docker build arg arrives as an empty string; treat it like a missing value.
    BUILD_SHA: z.preprocess((v) => (v === '' ? undefined : v), required.default('unknown')),
  })
  .superRefine((env, ctx) => {
    // A private bucket that is also the public one would publish every draft (plan §9 V1c).
    if (env.R2_PRIVATE_BUCKET === env.R2_MEDIA_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['R2_PRIVATE_BUCKET'], message: 'must differ from R2_MEDIA_BUCKET' });
    }
    if (!env.R2_ACCOUNT_ID && !env.S3_ENDPOINT) {
      ctx.addIssue({ code: 'custom', path: ['R2_ACCOUNT_ID'], message: 'R2_ACCOUNT_ID or S3_ENDPOINT is required' });
    }
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
    if (!env.MEDIA_PUBLIC_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['MEDIA_PUBLIC_BASE_URL'], message: 'must be https in production' });
    }
    // The S3 stand-in is for dev and CI; production talks to R2 only.
    if (env.S3_ENDPOINT !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'must not be set in production' });
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
