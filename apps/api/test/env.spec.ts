import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'OTP_HMAC_SECRET',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'TURNSTILE_SECRET_KEY',
  'R2_SECRET_ACCESS_KEY',
] as const;
// Cloudflare's Turnstile test secrets: always pass, always fail, already spent.
const TURNSTILE_DUMMY_SECRETS = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
];

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
  WEB_ORIGIN: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_live_key',
  EMAIL_FROM: 'Ciudad Enduro <no-reply@example.com>',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-real',
  OTP_HMAC_SECRET: 'b'.repeat(32),
  TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal-turnstile-secret',
  R2_ACCOUNT_ID: 'account-id',
  R2_ACCESS_KEY_ID: 'access-key-id',
  R2_SECRET_ACCESS_KEY: 'r2-real-secret',
  R2_MEDIA_BUCKET: 'ciudad-enduro-media',
  R2_PRIVATE_BUCKET: 'ciudad-enduro-media-private',
  MEDIA_PUBLIC_BASE_URL: 'https://media.enduro.vops.pe',
};

const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));

describe('loadEnv', () => {
  it('returns a typed env with defaults for valid input', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.BUILD_SHA).toBe('unknown');
  });

  it('treats an empty BUILD_SHA as unknown', () => {
    expect(loadEnv({ ...valid, BUILD_SHA: '' }).BUILD_SHA).toBe('unknown');
    expect(loadEnv({ ...valid, BUILD_SHA: 'abc123' }).BUILD_SHA).toBe('abc123');
  });

  it('accepts the .env.example values outside production', () => {
    expect(() => loadEnv(example)).not.toThrow();
  });

  it('rejects a 31-char secret and names the key without the value', () => {
    const value = 'z'.repeat(31);
    expect(() => loadEnv({ ...valid, OTP_HMAC_SECRET: value })).toThrow(/OTP_HMAC_SECRET/);
    expect(() => loadEnv({ ...valid, OTP_HMAC_SECRET: value })).not.toThrow(new RegExp(value));
  });

  it('rejects a missing TURNSTILE_SECRET_KEY', () => {
    expect(() => loadEnv({ ...valid, TURNSTILE_SECRET_KEY: undefined })).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it('rejects a missing NODE_ENV', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: undefined })).toThrow(/NODE_ENV/);
  });
});

describe('photo storage (plan §9 V1, V6)', () => {
  it('needs R2_ACCOUNT_ID or S3_ENDPOINT, and either one is enough', () => {
    expect(() => loadEnv({ ...valid, R2_ACCOUNT_ID: undefined })).toThrow(/R2_ACCOUNT_ID or S3_ENDPOINT is required/);
    expect(() => loadEnv({ ...valid, R2_ACCOUNT_ID: undefined, S3_ENDPOINT: 'http://127.0.0.1:9090' })).not.toThrow();
  });

  it.each(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_MEDIA_BUCKET', 'R2_PRIVATE_BUCKET', 'MEDIA_PUBLIC_BASE_URL'])('requires %s', (key) => {
    expect(() => loadEnv({ ...valid, [key]: undefined })).toThrow(new RegExp(key));
  });

  it('refuses a public base URL with a trailing slash', () => {
    expect(() => loadEnv({ ...valid, MEDIA_PUBLIC_BASE_URL: 'https://media.enduro.vops.pe/' })).toThrow(/MEDIA_PUBLIC_BASE_URL/);
  });

  it('takes an empty key prefix by default and a prefix that ends with a slash', () => {
    expect(loadEnv(valid).MEDIA_KEY_PREFIX).toBe('');
    expect(loadEnv({ ...valid, MEDIA_KEY_PREFIX: 'staging/' }).MEDIA_KEY_PREFIX).toBe('staging/');
    for (const value of ['staging', '/staging/', '../x/']) {
      expect(() => loadEnv({ ...valid, MEDIA_KEY_PREFIX: value }), value).toThrow(/MEDIA_KEY_PREFIX/);
    }
  });
});

describe('auth URLs are bare origins', () => {
  // trustedOrigins and the CSRF check compare exact origins; a trailing slash breaks every sign-in.
  it.each(['BETTER_AUTH_URL', 'WEB_ORIGIN'])('rejects a trailing slash or a path in %s', (key) => {
    for (const value of ['http://localhost:3000/', 'http://localhost:3000/app']) {
      expect(() => loadEnv({ ...valid, [key]: value }), value).toThrow(new RegExp(`${key}: must be an origin`));
    }
  });

  it('accepts an origin with a port', () => {
    expect(() => loadEnv({ ...valid, WEB_ORIGIN: 'http://127.0.0.1:3100', BETTER_AUTH_URL: 'http://127.0.0.1:3100' })).not.toThrow();
  });
});

describe('loadEnv in production', () => {
  const prod = { ...valid, NODE_ENV: 'production', WEB_ORIGIN: 'https://enduro.example', BETTER_AUTH_URL: 'https://enduro.example' };

  it('accepts real secrets', () => {
    expect(() => loadEnv(prod)).not.toThrow();
  });

  it.each(SECRET_KEYS)('rejects the .env.example value of %s', (key) => {
    expect(() => loadEnv({ ...prod, [key]: example[key] })).toThrow(new RegExp(key));
  });

  it.each(['dev-', 'test-'])('rejects a secret that starts with %s', (prefix) => {
    const value = `${prefix}${'x'.repeat(32)}`;
    expect(() => loadEnv({ ...prod, GOOGLE_CLIENT_SECRET: value })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => loadEnv({ ...prod, GOOGLE_CLIENT_SECRET: value })).not.toThrow(new RegExp(value));
  });

  it.each(TURNSTILE_DUMMY_SECRETS)('rejects the Cloudflare test secret %s', (value) => {
    expect(() => loadEnv({ ...prod, TURNSTILE_SECRET_KEY: value })).toThrow(/TURNSTILE_SECRET_KEY: must be a real secret in production/);
  });

  it.each(['BETTER_AUTH_URL', 'WEB_ORIGIN'])('rejects an http:// %s', (key) => {
    expect(() => loadEnv({ ...prod, [key]: 'http://enduro.example' })).toThrow(new RegExp(`${key}: must be https`));
  });

  // Better Auth sets Secure cookies only when baseURL.startsWith('https://') (cookies/index.mjs:23).
  it.each(['BETTER_AUTH_URL', 'WEB_ORIGIN'])('rejects %s values that do not start with https:// exactly', (key) => {
    for (const value of ['HTTPS://enduro.example', ' https://enduro.example']) {
      expect(() => loadEnv({ ...prod, [key]: value }), value).toThrow(new RegExp(`${key}: must be https`));
    }
  });

  it('rejects a set BETTER_AUTH_TRUSTED_ORIGINS (Better Auth adds it to the trusted origins)', () => {
    expect(() => loadEnv({ ...prod, BETTER_AUTH_TRUSTED_ORIGINS: 'https://other.example' })).toThrow(
      /BETTER_AUTH_TRUSTED_ORIGINS: must not be set in production/,
    );
  });

  it('requires an https MEDIA_PUBLIC_BASE_URL and refuses S3_ENDPOINT in production, not outside it', () => {
    expect(() => loadEnv({ ...prod, MEDIA_PUBLIC_BASE_URL: 'http://media.enduro.vops.pe' })).toThrow(/MEDIA_PUBLIC_BASE_URL: must be https in production/);
    expect(() => loadEnv({ ...prod, S3_ENDPOINT: 'http://127.0.0.1:9090' })).toThrow(/S3_ENDPOINT: must not be set in production/);
    expect(() => loadEnv({ ...valid, MEDIA_PUBLIC_BASE_URL: 'http://127.0.0.1:9090/b', S3_ENDPOINT: 'http://127.0.0.1:9090' })).not.toThrow();
  });

  it('accepts production without BETTER_AUTH_TRUSTED_ORIGINS', () => {
    expect(loadEnv(prod).NODE_ENV).toBe('production');
  });

  it('allows http:// URLs outside production', () => {
    expect(() => loadEnv({ ...valid, WEB_ORIGIN: 'http://localhost:3000', BETTER_AUTH_URL: 'http://localhost:3000' })).not.toThrow();
  });

  it.each(TURNSTILE_DUMMY_SECRETS)('allows the Cloudflare test secret %s outside production', (value) => {
    expect(() => loadEnv({ ...valid, TURNSTILE_SECRET_KEY: value })).not.toThrow();
  });

  it('allows dev- values outside production', () => {
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_SECRET: 'dev-anything' })).not.toThrow();
  });
});
