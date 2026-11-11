import { expect, test, type Page } from '@playwright/test';
import { PUBLISHED } from './fixtures.ts';
import { axe, expectMinFontSize, expectTarget, stubTiles } from './ui.ts';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const explore = (page: Page) => nav(page).getByRole('link', { name: 'Explorar' });
const DETAIL = `/rutas/${(PUBLISHED[0] as (typeof PUBLISHED)[number]).slug}`;

test.beforeEach(async ({ context }) => {
  await stubTiles(context);
});

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the bottom nav is visible, marks Explorar on / and /mapa only, and has 44 px targets', async ({ page }) => {
    await page.goto('/');
    await expect(nav(page)).toBeInViewport({ ratio: 1 });
    await expect(explore(page)).toHaveAttribute('aria-current', 'page');
    for (const link of await nav(page).getByRole('link').all()) await expectTarget(link);
    // Anonymous: no upload entry, and no map item (the toggle is the way to the map).
    await expect(page.getByRole('link', { name: 'Registrar ruta' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Mapa' })).toHaveCount(0);

    await page.goto('/mapa');
    await expect(explore(page)).toHaveAttribute('aria-current', 'page');
    await page.goto(DETAIL);
    await expect(explore(page)).not.toHaveAttribute('aria-current');
  });

  test('the nav stays above the map when the map sits under it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto('/mapa');
    await expect(page.getByTestId('explore-map').locator('path.trail-pin').first()).toBeVisible();
    const box = (await nav(page).boundingBox())!;
    const map = (await page.getByTestId('explore-map').boundingBox())!;
    const y = box.y + box.height / 2;
    expect(map.y < y && map.y + map.height > y, 'the map lies under the nav centre').toBe(true);
    const inside = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x as number, y as number)?.closest('nav[aria-label="Principal"]'),
      [box.x + box.width / 2, y],
    );
    expect(inside).toBe(true);
  });
});

test('at 1280 px the nav is a row under the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const box = (await nav(page).boundingBox())!;
  expect(box.y).toBeLessThan(200);
});

test('Tab reaches the wordmark, the session, then the nav, with a lime focus ring', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Ingresar' })).toBeVisible();
  const order: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { name: el.textContent?.trim() ?? '', style: style.outlineStyle, colour: style.outlineColor };
    });
    expect(focused.style).toBe('solid');
    expect(focused.colour).toBe('rgb(204, 255, 0)');
    order.push(focused.name);
  }
  expect(order).toEqual(['Ciudad Enduro', 'Ingresar', 'Explorar']);
});

test('the headings use a loaded Bebas Neue face', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((face) => face.family.includes('Bebas') && face.status === 'loaded');
  });
  expect(loaded).toBe(true);
  const family = await page.locator('h1').first().evaluate((h1) => getComputedStyle(h1).fontFamily);
  expect(family).toContain('Bebas');
});

test('the home and the not-found page have no WCAG A/AA violations and no text under 11 px', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('trail-card').first()).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  await expectMinFontSize(page);
  await page.goto('/no-existe-e2e');
  await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  await expectMinFontSize(page);
});
