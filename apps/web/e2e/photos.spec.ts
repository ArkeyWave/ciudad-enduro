// Plan §9 V2–V5: a rider uploads a "vista" through the FAB with the phone position, sees it
// "En revisión" on the trail, the admin publishes it in "Revisión", and everyone sees it in the
// timeline and on the map. The photos go to the S3 mock (playwright.config.ts), which the browser
// reads directly, as it reads media.enduro.vops.pe in production.
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { deleteTrail, insertAdmin, seedLineTrail } from './db.ts';
import { ORIGIN_PORT } from './ports.ts';
import { signIn } from './session.ts';
import { stubTurnstile, test } from './turnstile.ts';
import { axe, expectMinFontSize, expectTarget, stubTiles } from './ui.ts';

const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
const TRAIL = { slug: 'e2e-vista-sendero', name: 'Sendero de la Vista' };
// Due south, about 1.1 km, away from the other seeded trails.
const LINE: [number, number][] = [
  [-78.58, -9.05],
  [-78.58, -9.06],
];
const ON_LINE = { latitude: -9.055, longitude: -78.5801, accuracy: 8 };
const FAR = { latitude: -9.2, longitude: -78.7, accuracy: 8 };
/** A 96 × 64 JPEG without EXIF: the position must come from the phone. */
const JPEG = {
  name: 'vista.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAGADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmgM1KAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=',
    'base64',
  ),
};

const timeline = (page: Page) => page.getByTestId('photo-timeline');
const markers = (page: Page) => page.getByTestId('trail-map').locator('.photo-marker');

test.use({ viewport: { width: 390, height: 844 } });

// One sign-in per address per run: the tests share the rider and the admin and run in order.
test.describe('vistas', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  let riderContext: BrowserContext;
  let rider: Page;

  test.beforeAll(async ({ browser }) => {
    await seedLineTrail(TRAIL.slug, TRAIL.name, LINE);
    riderContext = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTurnstile(riderContext);
    await stubTiles(riderContext);
    await riderContext.grantPermissions(['geolocation'], { origin: ORIGIN });
    rider = await riderContext.newPage();
    await signIn(rider, `rider-vista-${Date.now()}@example.com`);
  });

  test.afterAll(async () => {
    await riderContext?.close();
    await deleteTrail(TRAIL.slug);
  });

  test('far from every trail, the upload shows "No hay un sendero a menos de 50 m."', async () => {
    await riderContext.setGeolocation(FAR);
    await rider.goto('/');
    await rider.getByRole('button', { name: 'Registrar ruta' }).click();
    const vista = rider.getByRole('dialog', { name: 'Registrar' }).getByRole('link', { name: 'Vista' });
    await expectTarget(vista);
    await vista.click();
    await expect(rider).toHaveURL(`${ORIGIN}/vistas/nueva`);
    await expect(rider.getByTestId('photo-position')).toHaveText('Ubicación lista (±8 m)');
    await rider.locator('input[name="photo"]').setInputFiles(JPEG);
    await rider.getByRole('button', { name: 'Publicar vista' }).click();
    await expect(rider.locator('main').getByRole('alert')).toHaveText('No hay un sendero a menos de 50 m.');
  });

  test('near the trail, the rider uploads a vista and sees it "En revisión" in the timeline and on the map', async () => {
    await riderContext.setGeolocation(ON_LINE);
    await rider.goto('/vistas/nueva');
    await expect(rider.getByRole('heading', { level: 1, name: 'Nueva vista' })).toBeVisible();
    await expect(rider.locator('input[name="photo"]')).toHaveAttribute('capture', 'environment');
    await expect(rider.getByTestId('photo-position')).toHaveText('Ubicación lista (±8 m)');
    await rider.locator('input[name="photo"]').setInputFiles(JPEG);
    await expect(rider.getByRole('img', { name: 'Vista previa' })).toBeVisible();
    await expectTarget(rider.getByRole('button', { name: 'Publicar vista' }));
    expect((await axe(rider)).violations).toEqual([]);
    await expectMinFontSize(rider);

    await rider.getByRole('button', { name: 'Publicar vista' }).click();
    await expect(rider).toHaveURL(`${ORIGIN}/rutas/${TRAIL.slug}`);
    await expect(timeline(rider).locator('.tl-photo')).toHaveCount(1);
    await expect(timeline(rider).getByTestId('photo-status')).toHaveText('En revisión');
    await expect(markers(rider)).toHaveCount(1);
  });

  test('another visitor does not see the draft', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: ORIGIN });
    await stubTiles(context);
    const page = await context.newPage();
    await page.goto(`/rutas/${TRAIL.slug}`);
    await expect(page.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    await expect(timeline(page)).toHaveCount(0);
    await expect(markers(page)).toHaveCount(0);
    await context.close();
  });

  test('the admin publishes it in "Revisión"; the trail shows one thumbnail and one marker; a tap opens it full-screen', async ({ browser }) => {
    const adminEmail = `admin-vista-${Date.now()}@example.com`;
    await insertAdmin(adminEmail);
    const context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTurnstile(context);
    await stubTiles(context);
    const admin = await context.newPage();
    await signIn(admin, adminEmail);
    await admin.goto('/admin/rutas');
    const review = admin.getByTestId('photo-review');
    await expect(review).toHaveCount(1);
    await expect(review.getByRole('link', { name: TRAIL.name })).toHaveAttribute('href', `/rutas/${TRAIL.slug}`);
    await expect(review).toContainText('rider-vista-');
    await expect(review.getByRole('img', { name: `Vista en ${TRAIL.name}` })).toBeVisible();
    for (const name of ['Publicar', 'Ocultar']) await expectTarget(review.getByRole('button', { name }));
    expect((await axe(admin)).violations).toEqual([]);
    await review.getByRole('button', { name: 'Publicar' }).click();
    await expect(admin.getByText('No hay vistas en revisión.')).toBeVisible();
    await context.close();

    const visitor = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    await stubTiles(visitor);
    const page = await visitor.newPage();
    await page.goto(`/rutas/${TRAIL.slug}`);
    const thumb = timeline(page).getByRole('button', { name: /^Vista a / });
    await expect(thumb).toHaveCount(1);
    await expect(timeline(page).getByTestId('photo-status')).toHaveCount(0);
    await expect(markers(page)).toHaveCount(1);
    await expectTarget(thumb);
    // The thumbnail really loads from the media origin.
    await expect.poll(() => thumb.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(160);
    expect((await axe(page)).violations).toEqual([]);
    await expectMinFontSize(page);

    const viewer = page.locator('dialog.photo-viewer');
    await thumb.click();
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96);
    expect((await axe(page)).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await thumb.click();
    await expectTarget(viewer.getByRole('button', { name: 'Cerrar' }));
    await viewer.getByRole('button', { name: 'Cerrar' }).click();
    await expect(viewer).toBeHidden();
    await visitor.close();
  });
});
