// Plan §8 G1–G4: the FAB sheet and the GPS tracer on /rutas/nueva. The browser's geolocation is
// Playwright's; the API's elevation source is a closed port (playwright.config.ts), so a traced route
// is stored without elevations.
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN_PORT } from './ports.ts';
import { signIn } from './session.ts';
import { stubTurnstile, test } from './turnstile.ts';
import { axe, expectMinFontSize, expectTarget, stubTiles } from './ui.ts';

const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
const FIRST = { latitude: -9.0745, longitude: -78.5936 };
const SECOND = { latitude: -9.076, longitude: -78.592 };

const summary = (page: Page) => page.getByTestId('trace-summary');
const markButton = (page: Page) => page.getByRole('button', { name: /^Marcar punto/ });
const tracePoints = (page: Page) => page.getByTestId('tracer-map').locator('path.trace-point');
const tapMap = async (page: Page) => {
  const box = (await page.getByTestId('tracer-map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const submitButton = (page: Page) => page.getByRole('button', { name: 'Subir ruta' });
/** Emulates the page going to the background (Playwright cannot hide a page). */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test.use({ viewport: { width: 390, height: 844 } });

// One sign-in per run (one code per address per 60 s): the tests share the rider and run in order.
test.describe('the FAB sheet and the tracer', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  let context: BrowserContext;
  let rider: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTurnstile(context);
    await stubTiles(context);
    rider = await context.newPage();
    await signIn(rider, `rider-tracer-${Date.now()}@example.com`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('the FAB opens a sheet with Sendero and a disabled Vista; Escape closes it', async () => {
    await rider.goto('/');
    const fab = rider.getByRole('button', { name: 'Registrar ruta' });
    await expectTarget(fab);
    await fab.click();
    const sheet = rider.getByRole('dialog', { name: 'Registrar' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Sendero' })).toHaveAttribute('href', '/rutas/nueva');
    await expect(sheet.getByRole('button', { name: 'Vista (pronto)' })).toBeDisabled();
    for (const target of [sheet.getByRole('link', { name: 'Sendero' }), sheet.getByRole('button', { name: 'Vista (pronto)' }), sheet.getByRole('button', { name: 'Cerrar' })]) {
      await expectTarget(target);
    }
    expect((await axe(rider)).violations).toEqual([]);
    await expectMinFontSize(rider);
    await rider.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await fab.click();
    await sheet.getByRole('button', { name: 'Cerrar' }).click();
    await expect(sheet).toBeHidden();
    // A tap on the backdrop, above the sheet, closes it.
    await fab.click();
    await expect(sheet).toBeVisible();
    await rider.mouse.click(195, 40);
    await expect(sheet).toBeHidden();
  });

  test('a denied location shows a message, and a tap on the map still marks a point', async () => {
    await context.clearPermissions();
    await rider.goto('/rutas/nueva');
    await rider.evaluate(() => sessionStorage.clear());
    await rider.reload();
    await rider.getByRole('button', { name: 'Mi ubicación' }).click();
    await expect(rider.locator('main').getByRole('alert')).toHaveText('Sin acceso a tu ubicación. Toca el mapa para marcar puntos.');
    await expect(markButton(rider)).toBeDisabled();
    // The form is there from the start; its submit waits for 2 points, and an undo keeps the name.
    await expect(submitButton(rider)).toBeDisabled();
    await tapMap(rider);
    await expect(tracePoints(rider)).toHaveCount(1);
    await expect(summary(rider)).toContainText('1 punto');
    await rider.getByLabel('Nombre').fill('Nombre que queda');
    await expect(submitButton(rider)).toBeDisabled();
    await tapMap(rider);
    await expect(tracePoints(rider)).toHaveCount(2);
    await expect(submitButton(rider)).toBeEnabled();
    await rider.getByRole('button', { name: 'Deshacer' }).click();
    await expect(submitButton(rider)).toBeDisabled();
    await expect(rider.getByLabel('Nombre')).toHaveValue('Nombre que queda');
    await rider.getByRole('button', { name: 'Deshacer' }).click();
    await expect(tracePoints(rider)).toHaveCount(0);
  });

  test('a rider marks GPS points (gated on the accuracy), taps, undoes, reloads, submits: "En revisión"', async () => {
    await context.grantPermissions(['geolocation'], { origin: ORIGIN });
    await context.setGeolocation({ ...FIRST, accuracy: 45 });
    await rider.goto('/rutas/nueva');
    await rider.evaluate(() => sessionStorage.clear());
    await rider.reload();
    await expect(rider.getByRole('heading', { level: 1, name: 'Marcar ruta' })).toBeVisible();
    await expect(rider.getByRole('navigation', { name: 'Modo' }).getByRole('link', { name: 'Marcar' })).toHaveAttribute('aria-current', 'page');

    await rider.getByRole('button', { name: 'Mi ubicación' }).click();
    // Worse than 30 m: the button says the accuracy and stays disabled.
    await expect(markButton(rider)).toHaveText('Marcar punto (±45 m)');
    await expect(markButton(rider)).toBeDisabled();
    await expect(rider.getByTestId('tracer-map').locator('path.fix-dot')).toHaveCount(1);

    await context.setGeolocation({ ...FIRST, accuracy: 8 });
    await expect(markButton(rider)).toHaveText('Marcar punto (±8 m)');
    await markButton(rider).click();
    // A page sent to the background drops its fix: no point from a stale position.
    await setVisibility(rider, 'hidden');
    await expect(markButton(rider)).toHaveText('Marcar punto');
    await expect(markButton(rider)).toBeDisabled();
    await setVisibility(rider, 'visible');
    await context.setGeolocation({ ...SECOND, accuracy: 12 });
    await expect(markButton(rider)).toHaveText('Marcar punto (±12 m)');
    await markButton(rider).click();
    await expect(tracePoints(rider)).toHaveCount(2);
    await expect(rider.getByTestId('tracer-map').locator('path.trail-path')).toHaveCount(1);
    await expect(summary(rider)).toHaveText('2 puntos · 242 m');

    // A double tap is exactly two points (2 + 2 = 4) and no zoom: the first point stays where it was.
    const first = tracePoints(rider).first();
    // The 13 → 17 zoom on the first fix may still run (Leaflet scales the layer): wait for the 12 px dot.
    await expect.poll(async () => (await first.boundingBox())?.width).toBe(12);
    const before = await first.boundingBox();
    const box = (await rider.getByTestId('tracer-map').boundingBox())!;
    await rider.mouse.dblclick(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await expect(tracePoints(rider)).toHaveCount(4);
    // The real double click's `dblclick` lands on the dot its first click drew, which Leaflet does not
    // zoom on; a `dblclick` on the bare map does zoom when doubleClickZoom is on. It must add no point.
    await rider.getByTestId('tracer-map').dispatchEvent('dblclick', { clientX: box.x + 60, clientY: box.y + 60 });
    await rider.waitForTimeout(500); // Leaflet's zoom animation is 250 ms
    await expect(tracePoints(rider)).toHaveCount(4);
    expect(await first.boundingBox()).toEqual(before);
    await rider.getByRole('button', { name: 'Deshacer' }).click();
    await rider.getByRole('button', { name: 'Deshacer' }).click();
    await expect(tracePoints(rider)).toHaveCount(2);

    // The points survive a reload until the submit.
    await rider.reload();
    await expect(tracePoints(rider)).toHaveCount(2);
    await expect(summary(rider)).toHaveText('2 puntos · 242 m');
    for (const button of await rider.locator('.tracer-controls button').all()) await expectTarget(button);
    expect((await axe(rider)).violations).toEqual([]);
    await expectMinFontSize(rider);

    await rider.getByLabel('Nombre').fill('Ruta Marcada E2E');
    await rider.getByRole('button', { name: 'Subir ruta' }).click();
    await expect(rider).toHaveURL(`${ORIGIN}/rutas/ruta-marcada-e2e`);
    await expect(rider.getByTestId('trail-meta').getByTestId('trail-status')).toHaveText('En revisión');
    await expect(rider.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    // Stored without elevations here (the e2e elevation source is a closed port): no credit.
    await expect(rider.getByRole('link', { name: 'Open-Meteo' })).toHaveCount(0);

    await rider.goto('/rutas/nueva');
    await expect(summary(rider)).toHaveText('0 puntos · 0 m');
  });
});
