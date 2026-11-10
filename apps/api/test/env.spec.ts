import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const SECRET_KEYS = ['BETTER_AUTH_SECRET', 'OTP_HMAC_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET'] as const;

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

  it('rejects a missing NODE_ENV', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: undefined })).toThrow(/NODE_ENV/);
  });
});

describe('loadEnv in production', () => {
  const prod = { ...valid, NODE_ENV: 'production' };

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

  it('allows dev- values outside production', () => {
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_SECRET: 'dev-anything' })).not.toThrow();
  });
});
