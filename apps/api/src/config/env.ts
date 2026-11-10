import { z } from 'zod';

const secret = z.string().min(32);
const required = z.string().min(1);

// Secrets that production must never run with an example or dev/test value.
const SECRET_KEYS = ['BETTER_AUTH_SECRET', 'OTP_HMAC_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET'] as const;
const NON_PRODUCTION_PREFIXES = ['dev-', 'test-'];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.url(),
    WEB_ORIGIN: z.url(),
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: z.url(),
    RESEND_API_KEY: required,
    EMAIL_FROM: required,
    GOOGLE_CLIENT_ID: required,
    GOOGLE_CLIENT_SECRET: required,
    OTP_HMAC_SECRET: secret,
    // An unset Docker build arg arrives as an empty string; treat it like a missing value.
    BUILD_SHA: z.preprocess((v) => (v === '' ? undefined : v), required.default('unknown')),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of SECRET_KEYS) {
      if (NON_PRODUCTION_PREFIXES.some((prefix) => env[key].startsWith(prefix))) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be a real secret in production' });
      }
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
