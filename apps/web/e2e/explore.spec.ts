import { expect, type Page } from '@playwright/test';
import { hidePublished, publishAgain } from './db.ts';
import { DRAFT, PROFILED, PUBLISHED } from './fixtures.ts';
import { signIn } from './session.ts';
import { test } from './turnstile.ts';
import { axe, expectMinFontSize, expectTarget, stubTiles } from './ui.ts';

const BARE = PUBLISHED[0] as (typeof PUBLISHED)[number];
const PROFILED_TRAIL = PUBLISHED[1] as (typeof PUBLISHED)[number];
const card = (page: Page, name: string) => page.getByTestId('trail-card').filter({ hasText: name });
const stat = (scope: ReturnType<typeof card>, label: string) => scope.locator(`[data-stat="${label}"] .val`);
const toggle = (page: Page, name: 'Lista' | 'Mapa') =>
  page.getByRole('navigation', { name: 'Vista' }).getByRole('link', { name, exact: true });

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ context }) => {
  await stubTiles(context);
});

test('each published trail is one card link with its city and type; drafts are not listed', async ({ page }) => {
  await page.goto('/');
  for (const trail of PUBLISHED) await expect(card(page, trail.name)).toHaveAttribute('href', `/rutas/${trail.slug}`);
  await expect(card(page, PROFILED_TRAIL.name).locator('.type-label')).toHaveText('Trujillo · Cross-country');
  await expect(card(page, BARE.name).locator('.type-label')).toHaveText('Chimbote · Descenso');
  await expect(page.getByText(DRAFT.name)).toHaveCount(0);
  await expect(toggle(page, 'Lista')).toHaveAttribute('aria-current', 'page');
  await expect(toggle(page, 'Mapa')).not.toHaveAttribute('aria-current');
  await expectTarget(toggle(page, 'Lista'));
  await expectTarget(toggle(page, 'Mapa'));
});

test('the bare card shows no Pendiente, no Desnivel and no mini profile', async ({ page }) => {
  await page.goto('/');
  const bare = card(page, BARE.name);
  await expect(bare).toBeVisible();
  await expect(bare.locator('[data-stat]')).toHaveCount(0);
  await expect(bare.locator('svg.elev')).toHaveCount(0);
});

test('the profiled card shows Distancia, Desnivel (the gain), Pendiente and one mini profile', async ({ page }) => {
  await page.goto('/');
  const profiled = card(page, PROFILED_TRAIL.name);
  await expect(stat(profiled, 'Distancia')).toHaveText('4.2 km');
  await expect(stat(profiled, 'Desnivel')).toHaveText(`${PROFILED.gainM} m`);
  await expect(stat(profiled, 'Pendiente')).toHaveText('5.2°');
  await expect(profiled.locator('svg.elev')).toHaveCount(1);
});

test('the map toggle shows one pin per trail; a pin picks the mini-card, which opens the detail', async ({ page }) => {
  await page.goto('/');
  const cards = await page.getByTestId('trail-card').count();
  await toggle(page, 'Mapa').click();
  await expect(page).toHaveURL(/\/mapa$/);
  await expect(toggle(page, 'Mapa')).toHaveAttribute('aria-current', 'page');
  await expect(toggle(page, 'Lista')).not.toHaveAttribute('aria-current');
  const pins = page.getByTestId('explore-map').locator('path.trail-pin');
  await expect(pins).toHaveCount(cards);

  const mini = page.getByTestId('mini-card');
  const first = await mini.getAttribute('href');
  const selectedPin = page.locator('path.trail-pin-selected');
  await expect(selectedPin).toHaveCount(1);
  await expect(selectedPin).toHaveAttribute('stroke', '#CCFF00');
  await expect(page.locator('path.trail-pin:not(.trail-pin-selected)').first()).toHaveAttribute('stroke', '#0A0A0A');
  // The selected pin moves to the front (the end of the SVG), so follow the element, not an index.
  const other = await page.locator('path.trail-pin:not(.trail-pin-selected)').first().elementHandle();
  await other.click({ force: true });
  await expect(mini).not.toHaveAttribute('href', first as string);
  await expect(selectedPin).toHaveCount(1);
  expect(await other.evaluate((el) => [el.classList.contains('trail-pin-selected'), el.getAttribute('stroke')])).toEqual([true, '#CCFF00']);
  for (const button of await page.locator('.leaflet-bar a').all()) await expectTarget(button);
  expect((await axe(page)).violations).toEqual([]);
  await expectMinFontSize(page);

  const href = (await mini.getAttribute('href')) as string;
  await mini.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));

  await page.goto('/mapa');
  await page.getByRole('link', { name: 'Ver como lista', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/mapa');
  await toggle(page, 'Lista').click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe('with no published trail', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });
  let hidden: string[] = [];
  test.afterEach(async () => {
    await publishAgain(hidden);
    hidden = [];
  });

  test('the list and the map show the empty state; only a signed-in user gets "Registrar ruta"', async ({ page, browser }) => {
    const rider = page;
    await signIn(rider, `rider-explore-${Date.now()}@example.com`);
    const anonymous = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
    await stubTiles(anonymous.context());
    try {
      hidden = await hidePublished();
      for (const path of ['/', '/mapa']) {
        await anonymous.goto(path);
        await expect(anonymous.getByTestId('empty-trails')).toHaveText('Aún no hay senderos publicados.');
        await expect(anonymous.getByRole('link', { name: 'Registrar ruta' })).toHaveCount(0);
        await expect(anonymous.getByTestId('explore-map')).toHaveCount(0);

        await rider.goto(path);
        await expect(rider.getByTestId('empty-trails').getByRole('link', { name: 'Registrar ruta' })).toHaveAttribute(
          'href',
          '/rutas/nueva',
        );
        await expect(rider.getByTestId('explore-map')).toHaveCount(0);
      }
    } finally {
      await anonymous.context().close();
    }
  });
});
