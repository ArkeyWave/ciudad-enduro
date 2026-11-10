import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3100;
const API_PORT = 3101;

// The API runs on ciudad_enduro_test_<TEST_DB_SUFFIX>, the database e2e/prepare-db.ts recreates.
const databaseUrl = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/ciudad_enduro');
databaseUrl.pathname = `/ciudad_enduro_test_${process.env.TEST_DB_SUFFIX ?? 'main'}`;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The API runs from source, so an API change needs no rebuild before an e2e run.
      command: 'node ../web/e2e/prepare-db.ts && node --import @swc-node/register/esm-register src/main.ts',
      cwd: '../api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl.href,
        WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
        BETTER_AUTH_URL: `http://127.0.0.1:${WEB_PORT}`,
        RESEND_API_KEY: 'test-resend-api-key',
        EMAIL_FROM: 'Ciudad Enduro <no-reply@example.com>',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        OTP_HMAC_SECRET: 'test-otp-hmac-secret-0123456789abcdef',
      },
    },
    {
      // Serves the production build: run `pnpm build` first.
      command: `next start -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
