// Plan §10 L3-3/L3-4 and §10.1 A7: where the district suggestion comes from, when the page may use
// the device position, and that the one watch stops with the page. The browser's geolocation is
// Playwright's; an init script records the watchPosition and clearWatch calls.
import { fileURLToPath } from 'node:url';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { ORIGIN_PORT } from './ports.ts';
import { signIn } from './session.ts';
import { stubTurnstile, test } from './turnstile.ts';
import { stubTiles } from './ui.ts';

const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
const IMPORT = '/rutas/nueva?modo=gpx';
// Its first point (-9.09, -78.52) is nearest to the Nuevo Chimbote capital point.
const GPX = fileURLToPath(new URL('../../api/test/fixtures/one-segment.gpx', import.meta.url));
const TRUJILLO_FIX = { latitude: -8.101, longitude: -79.03, accuracy: 8 };
const CHIMBOTE_POINT = { lat: -9.0745, lng: -78.5936 };

type GeoCalls = { watched: number[]; cleared: number[] };
const geoCalls = (page: Page) => page.evaluate(() => (window as unknown as { __geo: GeoCalls }).__geo);
const district = (page: Page) => page.getByRole('combobox', { name: 'Distrito' });

test.describe('the district suggestion', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  let context: BrowserContext;
  let rider: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTurnstile(context);
    await stubTiles(context);
    await context.addInitScript(() => {
      const geo = navigator.geolocation;
      const calls: GeoCalls = { watched: [], cleared: [] };
      (window as unknown as { __geo: GeoCalls }).__geo = calls;
      const watch = geo.watchPosition.bind(geo);
      const clear = geo.clearWatch.bind(geo);
      geo.watchPosition = (...args) => {
        const id = watch(...args);
        calls.watched.push(id);
        return id;
      };
      geo.clearWatch = (id) => {
        calls.cleared.push(id);
        clear(id);
      };
    });
    rider = await context.newPage();
    await signIn(rider, `rider-districts-${Date.now()}@example.com`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('"Importar GPX" starts no watch while the permission is not granted', async () => {
    await context.clearPermissions();
    await rider.goto(IMPORT);
    await expect(district(rider)).toBeVisible();
    // The page asked for the permission state; that answer is in before this one.
    await rider.evaluate(() => navigator.permissions.query({ name: 'geolocation' }));
    expect((await geoCalls(rider)).watched).toEqual([]);
    await expect(district(rider)).toHaveValue('');
  });

  test('a text that is not a district blocks the submit: no POST', async () => {
    await context.clearPermissions();
    await rider.goto(IMPORT);
    let posts = 0;
    rider.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/trails')) posts += 1;
    });
    // Typed first, so the GPX start suggests nothing over it.
    await district(rider).fill('xyz');
    await rider.locator('input[name="gpx"]').setInputFiles(GPX);
    await rider.getByLabel('Nombre').fill('Ruta sin distrito');
    await rider.getByRole('button', { name: 'Subir ruta' }).click();
    await expect(district(rider)).toHaveValue('xyz');
    expect(await district(rider).evaluate((input: HTMLInputElement) => input.validationMessage)).toBe('Elige un distrito de la lista.');
    await rider.waitForTimeout(500);
    expect(posts).toBe(0);
    await expect(rider).toHaveURL(`${ORIGIN}${IMPORT}`);
  });

  test('a district typed over the suggestion and left with Tab blocks the submit: no POST', async () => {
    await context.clearPermissions();
    await rider.goto(IMPORT);
    let posts = 0;
    rider.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/trails')) posts += 1;
    });
    await rider.locator('input[name="gpx"]').setInputFiles(GPX);
    await expect(district(rider)).toHaveValue('Nuevo Chimbote, Santa, Ancash');
    await district(rider).fill('Coishco');
    await district(rider).press('Tab');
    // The blur keeps the typed text: the old value must not go to the API under it.
    await expect(district(rider)).toHaveValue('Coishco');
    await rider.getByLabel('Nombre').fill('Ruta en otro distrito');
    await rider.getByRole('button', { name: 'Subir ruta' }).click();
    expect(await district(rider).evaluate((input: HTMLInputElement) => input.validationMessage)).toBe('Elige un distrito de la lista.');
    await rider.waitForTimeout(500);
    expect(posts).toBe(0);
    await expect(rider).toHaveURL(`${ORIGIN}${IMPORT}`);
  });

  test('with the permission granted, "Importar GPX" suggests the district of the fix', async () => {
    await context.grantPermissions(['geolocation'], { origin: ORIGIN });
    await context.setGeolocation(TRUJILLO_FIX);
    await rider.goto(IMPORT);
    await expect(district(rider)).toHaveValue('Trujillo, Trujillo, La Libertad');
    expect((await geoCalls(rider)).watched).toHaveLength(1);
  });

  test('the GPX start wins over the fix', async () => {
    await rider.goto(IMPORT);
    await expect(district(rider)).toHaveValue('Trujillo, Trujillo, La Libertad');
    await rider.locator('input[name="gpx"]').setInputFiles(GPX);
    await expect(district(rider)).toHaveValue('Nuevo Chimbote, Santa, Ancash');
  });

  test('the tracer: the first point wins over the fix', async () => {
    await rider.goto('/rutas/nueva');
    await rider.evaluate((point) => sessionStorage.setItem('ce:tracer-points', JSON.stringify([point])), CHIMBOTE_POINT);
    await rider.reload();
    await expect(district(rider)).toHaveValue('Chimbote, Santa, Ancash');
    await rider.getByRole('button', { name: 'Mi ubicación' }).click();
    await expect(rider.getByRole('button', { name: /^Marcar punto/ })).toHaveText('Marcar punto (±8 m)');
    await expect(district(rider)).toHaveValue('Chimbote, Santa, Ancash');
  });

  test('the watch stops when the page goes away', async () => {
    const { watched } = await geoCalls(rider);
    expect(watched).toHaveLength(1);
    // A client navigation unmounts the tracer without a page load (the app has no client links yet).
    await rider.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push('/'));
    await expect(rider).toHaveURL(`${ORIGIN}/`);
    await expect.poll(async () => (await geoCalls(rider)).cleared).toEqual(watched);
    await rider.evaluate(() => sessionStorage.clear());
  });
});
