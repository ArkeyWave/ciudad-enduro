import { expect } from '@playwright/test';
import { HUNG_API_PORT, HUNG_WEB_PORT } from './ports.ts';
import { test } from './turnstile.ts';

// This web server's API accepts the connection and never answers.
const HUNG_WEB = `http://127.0.0.1:${HUNG_WEB_PORT}`;

test('a hung API gives the Spanish error page within 8 s, with no internal details', async ({ page }) => {
  const started = Date.now();
  await page.goto(`${HUNG_WEB}/`);
  await expect(page.getByRole('heading', { name: 'No pudimos cargar esta página' })).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - started).toBeLessThan(8_000); // the 5 s server-side timeout, plus rendering

  // The server HTML carries only an error digest; the boundary renders in the browser.
  const html = await (await page.request.get(`${HUNG_WEB}/`)).text();
  for (const leak of [String(HUNG_API_PORT), 'API_INTERNAL_URL', 'TimeoutError', 'AbortError', 'node_modules', '/api/trails']) {
    expect(html).not.toContain(leak);
  }
  expect(html).not.toMatch(/\bat \S+ \(/); // a stack frame
});

test('with a session cookie and a hung /api/me, /ingresar still renders, signed out', async ({ page, context }) => {
  await context.addCookies([{ name: 'better-auth.session_token', value: 'stale', url: HUNG_WEB }]);
  await page.goto(`${HUNG_WEB}/ingresar`, { timeout: 15_000 });
  await expect(page.getByLabel('Correo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ingresar' })).toBeVisible();
});
