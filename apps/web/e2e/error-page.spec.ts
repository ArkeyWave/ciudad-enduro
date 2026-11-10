import { expect, test } from '@playwright/test';
import { HUNG_API_PORT, HUNG_WEB_PORT } from './ports.ts';

// This web server's API accepts the connection and never answers.
const HUNG_WEB = `http://127.0.0.1:${HUNG_WEB_PORT}/`;

test('a hung API gives the Spanish error page, with no internal details', async ({ page }) => {
  await page.goto(HUNG_WEB);
  await expect(page.getByRole('heading', { name: 'No pudimos cargar esta página' })).toBeVisible({ timeout: 15_000 });

  // The server HTML carries only an error digest; the boundary renders in the browser.
  const html = await (await page.request.get(HUNG_WEB)).text();
  for (const leak of [String(HUNG_API_PORT), 'API_INTERNAL_URL', 'TimeoutError', 'AbortError', 'node_modules', '/api/trails']) {
    expect(html).not.toContain(leak);
  }
  expect(html).not.toMatch(/\bat \S+ \(/); // a stack frame
});
