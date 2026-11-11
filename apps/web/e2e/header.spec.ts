import { expect, type Page } from '@playwright/test';
import { PUBLISHED } from './fixtures.ts';
import { signIn } from './session.ts';
import { test } from './turnstile.ts';
import { stubTiles } from './ui.ts';

// Found live at 390 px: a long address pushed "Salir" off-screen and widened the page. No hyphen:
// the browser wraps a word at a hyphen, and a real address often has none.
const LONG_EMAIL = 'unadireccionmuylargaparaprobar@example.com';

test.use({ viewport: { width: 390, height: 844 } });

async function expectFits(page: Page) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  await expect(page.getByRole('button', { name: 'Salir' })).toBeInViewport({ ratio: 1 });
}

test('at 390 px a long e-mail does not push "Salir" off-screen or widen the page', async ({ page, context }) => {
  await stubTiles(context);
  await signIn(page, LONG_EMAIL);
  await page.goto('/');
  await expectFits(page);
  await page.goto(`/rutas/${(PUBLISHED[0] as (typeof PUBLISHED)[number]).slug}`);
  await expect(page.getByTestId('trail-map')).toBeVisible();
  await expectFits(page);
});
