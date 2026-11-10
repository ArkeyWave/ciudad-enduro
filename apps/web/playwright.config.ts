import { defineConfig, devices } from '@playwright/test';
import { CODES_FILE } from './e2e/codes.ts';
import { API_PORT, HUNG_API_PORT, HUNG_WEB_PORT, ORIGIN_PORT, WEB_PORT } from './e2e/ports.ts';


// The API runs on ciudad_enduro_test_<TEST_DB_SUFFIX>, the database e2e/prepare-db.ts recreates.
const databaseUrl = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/ciudad_enduro');
databaseUrl.pathname = `/ciudad_enduro_test_${process.env.TEST_DB_SUFFIX ?? 'main'}`;
const origin = `http://127.0.0.1:${ORIGIN_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: origin },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The API runs from source, so an API change needs no rebuild before an e2e run. The e2e
      // entrypoint writes OTP mails to CODES_FILE instead of sending them.
      command: 'node ../web/e2e/prepare-db.ts && node --import @swc-node/register/esm-register test/support/e2e-main.ts',
      cwd: '../api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl.href,
        E2E_CODES_FILE: CODES_FILE,
        WEB_ORIGIN: origin,
        BETTER_AUTH_SECRET: 'test-better-auth-secret-0123456789abcdef',
        BETTER_AUTH_URL: origin,
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
      url: `http://127.0.0.1:${WEB_PORT}/ingresar`,
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}` },
    },
    {
      command: `node e2e/front-proxy.ts ${ORIGIN_PORT} ${WEB_PORT} ${API_PORT}`,
      port: ORIGIN_PORT,
      reuseExistingServer: false,
    },
    {
      command: `node -e "require('node:net').createServer(() => {}).listen(${HUNG_API_PORT}, '127.0.0.1')"`,
      port: HUNG_API_PORT,
      reuseExistingServer: false,
    },
    {
      command: `next start -p ${HUNG_WEB_PORT}`,
      url: `http://127.0.0.1:${HUNG_WEB_PORT}/ingresar`,
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: `http://127.0.0.1:${HUNG_API_PORT}` },
    },
  ],
});
