// Plan §10 L3-5 … L3-7 and §10.1 A9–A11: the "Mi ubicación" chip states, the pin on /vistas/nueva
// (tap, drag, "Poner aquí"; a fix never moves it), the trail pick without a fix, `?ruta=` and the
// "Agregar vista" button. One context has a real denied permission; the other a mocked geolocation
// whose fixes and errors the tests send.
import { expect, type BrowserContext, type Page, type Request } from '@playwright/test';
import { deleteTrail, makeDraftOf, seedLineTrail } from './db.ts';
import { ORIGIN_PORT } from './ports.ts';
import { signIn } from './session.ts';
import { stubTurnstile, test } from './turnstile.ts';
import { axe, expectTarget, stubTiles } from './ui.ts';

const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
const TRAIL = { slug: 'e2e-ubicacion', name: 'Sendero de la Ubicación' };
const DRAFT = { slug: 'e2e-ubicacion-borrador', name: 'Borrador de la Ubicación' };
// Due south, about 1.1 km, away from the other seeded trails.
const LINE: [number, number][] = [
  [-78.61, -9.02],
  [-78.61, -9.03],
];
/** A 96 × 64 JPEG without EXIF (as in photos.spec.ts). */
const JPEG = {
  name: 'vista.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAGADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmgM1KAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=',
    'base64',
  ),
};

type GeoMock = { watches: number; ok?: PositionCallback; err?: PositionErrorCallback };
const watches = (page: Page) => page.evaluate(() => (window as unknown as { __geo: GeoMock }).__geo.watches);
/** Sends a fix to the page's latest watch. */
const sendFix = (page: Page, latitude: number, longitude: number, accuracy: number) =>
  page.evaluate(
    ([latitude, longitude, accuracy]) =>
      (window as unknown as { __geo: GeoMock }).__geo.ok!({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() } as GeolocationPosition),
    [latitude, longitude, accuracy] as const,
  );
const sendDenial = (page: Page) =>
  page.evaluate(() => (window as unknown as { __geo: GeoMock }).__geo.err!({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError));

const chip = (page: Page) => page.getByRole('button', { name: 'Centrar en mi ubicación' });
const state = (page: Page) => page.getByTestId('locate-state');
const photoMap = (page: Page) => page.getByTestId('photo-map');
const pin = (page: Page) => photoMap(page).locator('.photo-pin');
const tapCentre = async (page: Page, testId: string) => {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
/** The pin's place inside the map, whatever the page scroll. */
const pinOnMap = async (page: Page) => {
  const [p, m] = [(await pin(page).boundingBox())!, (await photoMap(page).boundingBox())!];
  return { x: p.x - m.x, y: p.y - m.y };
};
/** One text field of a multipart body. */
const field = (body: string, name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
const bodyOf = (request: Request) => request.postDataBuffer()!.toString('latin1');
const isUpload = (request: Request) => request.method() === 'POST' && request.url().endsWith('/api/photos');

test.use({ viewport: { width: 390, height: 844 } });

test.describe('location on the maps', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  let denied: BrowserContext;
  let mocked: BrowserContext;
  let deniedPage: Page;
  let mockedPage: Page;
  const deniedEmail = `rider-denied-${Date.now()}@example.com`;

  test.beforeAll(async ({ browser }) => {
    await seedLineTrail(TRAIL.slug, TRAIL.name, LINE);
    await seedLineTrail(DRAFT.slug, DRAFT.name, LINE.map(([lng, lat]) => [lng + 0.01, lat]));
    // No permission granted: Chromium denies the position.
    denied = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTurnstile(denied);
    await stubTiles(denied);
    deniedPage = await denied.newPage();
    await signIn(deniedPage, deniedEmail);
    await makeDraftOf(DRAFT.slug, deniedEmail);

    mocked = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTurnstile(mocked);
    await stubTiles(mocked);
    await mocked.addInitScript(() => {
      const geo: GeoMock = { watches: 0 };
      (window as unknown as { __geo: GeoMock }).__geo = geo;
      navigator.geolocation.watchPosition = (ok, err) => {
        geo.watches += 1;
        geo.ok = ok;
        geo.err = err ?? undefined;
        return geo.watches;
      };
      navigator.geolocation.clearWatch = () => undefined;
    });
    mockedPage = await mocked.newPage();
    await signIn(mockedPage, `rider-mocked-${Date.now()}@example.com`);
  });

  test.afterAll(async () => {
    await denied?.close();
    await mocked?.close();
    await deleteTrail(TRAIL.slug);
    await deleteTrail(DRAFT.slug);
  });

  test('the tracer chip: "Buscando…", then "±N m" with a dot that follows each fix, then the denied alert; never aria-pressed', async () => {
    const page = mockedPage;
    await page.goto('/rutas/nueva');
    await expect(chip(page)).not.toHaveAttribute('aria-pressed');
    await expectTarget(chip(page));
    await expect(state(page)).toHaveText('');
    await chip(page).click();
    await expect(state(page)).toHaveText('Buscando…');
    await expect.poll(() => watches(page)).toBe(1);

    await sendFix(page, -9.0745, -78.5936, 12.4);
    await expect(state(page)).toHaveText('±12 m');
    await expect(chip(page)).toHaveClass(/located/);
    await expect(chip(page)).not.toHaveAttribute('aria-pressed');
    const dot = page.getByTestId('tracer-map').locator('path.fix-dot');
    await expect(dot).toHaveCount(1);
    await expect(page.getByTestId('tracer-map').locator('path.fix-accuracy')).toHaveCount(1);
    // The 13 → 17 zoom on the first fix may still run: wait until the dot stands still.
    await expect.poll(async () => (await dot.boundingBox())?.width).toBe(16);
    const before = (await dot.boundingBox())!;
    await sendFix(page, -9.0749, -78.5932, 20);
    await expect(state(page)).toHaveText('±20 m');
    await expect.poll(async () => (await dot.boundingBox())!.x).not.toBe(before.x);
    expect((await axe(page)).violations).toEqual([]);

    await sendDenial(page);
    await expect(page.locator('main').getByRole('alert')).toHaveText('Sin acceso a tu ubicación. Toca el mapa para marcar puntos.');
    await expect(state(page)).toHaveText('');
    await expect(dot).toHaveCount(0);
    await expect(chip(page)).not.toHaveClass(/located/);
  });

  test('denied: the rider picks a trail, its line shows, a tap places the pin and the upload sends its lat/lng and the trail', async () => {
    const page = deniedPage;
    await page.goto('/vistas/nueva');
    await expect(page.locator('main').getByRole('alert')).toHaveText('Sin acceso a tu ubicación. Elige el sendero.');
    await expect(photoMap(page)).toHaveCount(0);
    const pick = page.getByRole('link', { name: TRAIL.name, exact: true });
    await expectTarget(pick);
    await pick.click();
    await expect(page).toHaveURL(`${ORIGIN}/vistas/nueva?ruta=${TRAIL.slug}`);
    await expect(photoMap(page).locator('path.trail-path')).toHaveCount(1);
    await expect(page.locator('main').getByRole('alert')).toHaveText('Sin acceso a tu ubicación. Toca el mapa donde tomaste la foto.');
    await tapCentre(page, 'photo-map');
    await expect(pin(page)).toHaveCount(1);
    await expect(page.getByTestId('photo-position')).toHaveText('Punto marcado en el mapa');
    expect((await axe(page)).violations).toEqual([]);

    await page.locator('input[name="photo"]').setInputFiles(JPEG);
    const upload = page.waitForRequest(isUpload);
    await page.getByRole('button', { name: 'Publicar vista' }).click();
    const body = bodyOf(await upload);
    expect(field(body, 'trail')).toBe(TRAIL.slug);
    // The tap is on the line (the map fits it): about -78.61, between -9.02 and -9.03.
    expect(Number(field(body, 'lng'))).toBeCloseTo(-78.61, 3);
    expect(Number(field(body, 'lat'))).toBeGreaterThan(-9.03);
    expect(Number(field(body, 'lat'))).toBeLessThan(-9.02);
    await expect(page).toHaveURL(`${ORIGIN}/rutas/${TRAIL.slug}`);
    await expect(page.getByTestId('photo-timeline').getByTestId('photo-status')).toHaveText('En revisión');
  });

  test('"Poner aquí" places the pin at the map centre without a pointer', async () => {
    const page = deniedPage;
    await page.goto(`/vistas/nueva?ruta=${TRAIL.slug}`);
    await expect(photoMap(page).locator('path.trail-path')).toHaveCount(1);
    await expect(pin(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Poner aquí' }).focus();
    await page.keyboard.press('Enter');
    await expect(pin(page)).toHaveCount(1);
    await expect(page.getByTestId('photo-position')).toHaveText('Punto marcado en el mapa');
  });

  test('a dragged pin stays when a fix comes; the upload sends the pin, never the fix', async () => {
    const page = mockedPage;
    const bodies: string[] = [];
    // The API answers are not the point here: every upload gets a 422 and the page stays.
    await page.route('**/api/photos', async (route) => {
      bodies.push(bodyOf(route.request()));
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'NO_TRAIL_NEARBY' }) });
    });
    try {
      await page.goto(`/vistas/nueva?ruta=${TRAIL.slug}`);
      await expect(photoMap(page).locator('path.trail-path')).toHaveCount(1);
      await page.locator('input[name="photo"]').setInputFiles(JPEG);
      const submit = async () => {
        const before = bodies.length;
        await page.getByRole('button', { name: 'Publicar vista' }).click();
        await expect(page.locator('main').getByRole('alert')).toHaveText('No hay un sendero a menos de 50 m.');
        await expect.poll(() => bodies.length).toBe(before + 1);
        const body = bodies.at(-1)!;
        return { lat: field(body, 'lat'), lng: field(body, 'lng'), trail: field(body, 'trail') };
      };

      await tapCentre(page, 'photo-map');
      await expect(pin(page)).toHaveCount(1);
      const tapped = await submit();
      expect(tapped.trail).toBe(TRAIL.slug);

      // The submit scrolled the page: bring the map back before the pointer drag.
      await photoMap(page).scrollIntoViewIfNeeded();
      const start = (await pin(page).boundingBox())!;
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(start.x + start.width / 2 + 40, start.y + start.height / 2 + 30, { steps: 8 });
      await page.mouse.up();
      expect(Math.abs((await pin(page).boundingBox())!.x - start.x - 40)).toBeLessThan(3);
      const dragged = await pinOnMap(page);
      const afterDrag = await submit();
      expect(afterDrag.lat).not.toBe(tapped.lat);
      expect(afterDrag.lng).not.toBe(tapped.lng);

      expect(await watches(page)).toBe(1);
      // A good fix (±8 m, now) elsewhere: the same dot as the tracer, and the pin does not move.
      await sendFix(page, -9.021, -78.6095, 8);
      await expect(state(page)).toHaveText('±8 m');
      await expect(photoMap(page).locator('path.fix-dot')).toHaveCount(1);
      expect(await pinOnMap(page)).toEqual(dragged);
      await expect(page.getByTestId('photo-position')).toHaveText('Punto marcado en el mapa');
      const afterFix = await submit();
      expect(afterFix).toEqual(afterDrag);
    } finally {
      await page.unroute('**/api/photos');
    }
  });

  test('"Agregar vista" opens the form on a published trail; not on the own draft; not for an anonymous visitor', async ({ browser }) => {
    const page = deniedPage;
    await page.goto(`/rutas/${TRAIL.slug}`);
    const add = page.getByRole('link', { name: 'Agregar vista' });
    await expectTarget(add);
    await add.click();
    await expect(page).toHaveURL(`${ORIGIN}/vistas/nueva?ruta=${TRAIL.slug}`);
    await expect(photoMap(page).locator('path.trail-path')).toHaveCount(1);

    // The rider sees the own draft (its chip), without the button.
    await page.goto(`/rutas/${DRAFT.slug}`);
    await expect(page.getByTestId('trail-status')).toHaveText('En revisión');
    await expect(page.getByRole('link', { name: 'Agregar vista' })).toHaveCount(0);

    const anonymous = await browser.newContext({ baseURL: ORIGIN });
    await stubTiles(anonymous);
    const visitor = await anonymous.newPage();
    await visitor.goto(`/rutas/${TRAIL.slug}`);
    await expect(visitor.getByRole('heading', { level: 1, name: TRAIL.name })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Agregar vista' })).toHaveCount(0);
    await anonymous.close();
  });

  test('an unavailable ?ruta= (a draft, an unknown slug) shows "Este sendero no está disponible." and no map', async () => {
    const page = deniedPage;
    for (const slug of [DRAFT.slug, 'no-existe']) {
      await page.goto(`/vistas/nueva?ruta=${slug}`);
      await expect(page.locator('main').getByRole('alert')).toHaveText('Este sendero no está disponible.');
      await expect(photoMap(page)).toHaveCount(0);
      await expect(page.locator('input[name="photo"]')).toHaveCount(0);
    }
  });
});
