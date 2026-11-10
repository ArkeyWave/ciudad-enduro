import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Local default: the dev database from docker-compose.dev.yml. CI sets its own.
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5434/ciudad_enduro';

// Turbo passes only DATABASE_URL, TEST_DB_SUFFIX and CI to the test task, so every other
// variable the API needs gets a dummy value here.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration specs share one test database; run files one at a time.
    fileParallelism: false,
    // The fs module cache keys on file content only. The SWC transform also depends on
    // tsconfig.json (decorator metadata), so a cached module can hide a tsconfig change.
    fsModuleCache: false,
    env: {
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
      BETTER_AUTH_URL: 'http://localhost:3000',
      RESEND_API_KEY: 'test-resend-api-key',
      EMAIL_FROM: 'Ciudad Enduro <no-reply@example.com>',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      OTP_HMAC_SECRET: 'test-otp-hmac-secret-0123456789abcdef',
      TURNSTILE_SECRET_KEY: 'test-turnstile-secret-key',
    },
  },
});
