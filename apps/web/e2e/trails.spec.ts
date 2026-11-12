import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { ADMIN_EMAIL, PROFILED, PUBLISHED } from './fixtures.ts';
import { ORIGIN_PORT } from './ports.ts';
import { signIn } from './session.ts';
import { stubTurnstile, test } from './turnstile.ts';
import { axe, expectMinFontSize, expectTarget, stubTiles, tiles } from './ui.ts';

const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
// Six points, gain 12 m, loss 12 m, min 100 m, max 112 m (the API's own fixture).
const GPX = fileURLToPath(new URL('../../api/test/fixtures/one-segment.gpx', import.meta.url));
const UPLOADED = { name: 'Ruta E2E Subida', slug: 'ruta-e2e-subida' };
// The same ride with another metadata name: another sha256, so not a duplicate.
const gpxVariant = (tag: string) => ({
  name: `${tag}.gpx`,
  mimeType: 'application/gpx+xml',
  buffer: Buffer.from(readFileSync(GPX, 'utf8').replace('<metadata><name>Cerro de prueba</name>', `<metadata><name>${tag}</name>`)),
});
// Seeded with a start point only: no path, no profile.
const NO_PATH = PUBLISHED[0] as (typeof PUBLISHED)[number];
const NOT_FOUND = 'No encontramos esta página';
const IMPORT = '/rutas/nueva?modo=gpx';

const PROFILED_TRAIL = PUBLISHED[1] as (typeof PUBLISHED)[number];
const meta = (page: Page) => page.getByTestId('trail-meta');
/** The meta row of the detail: difficulty pill, type, city and (admin only) the status chip. */
async function expectMeta(page: Page, status: string) {
  await expect(meta(page).locator('.diff-pill')).toHaveText('Difícil');
  await expect(meta(page).locator('.type-label')).toHaveText('Cross-country');
  await expect(meta(page).locator('.eyebrow')).toHaveText('Trujillo');
  await expect(meta(page).getByTestId('trail-status')).toHaveText(status);
}
const stat = (page: Page, label: string) => page.locator(`[data-stat="${label}"] .val`);
const fact = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`);
// By name, not by label: the label is the axe scans' job (a missing label must fail axe, not this).
const gpxInput = (page: Page) => page.locator('input[name="gpx"]');

test.beforeEach(async ({ context }) => {
  await stubTiles(context);
});

test('an unknown slug answers HTTP 404 with the Spanish page', async ({ page }) => {
  expect((await page.goto('/rutas/no-existe-e2e'))?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
});

test('a trail with no path shows its start point, no line and no profile', async ({ page }) => {
  expect((await page.goto(`/rutas/${NO_PATH.slug}`))?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: NO_PATH.name })).toBeVisible();
  await expect(page.getByTestId('trail-map').locator('path.trail-start')).toHaveCount(1);
  await expect(page.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(0);
  await expect(page.getByTestId('elevation-profile')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Perfil de elevación' })).toHaveCount(0);
});

test.describe('the detail at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the map is the hero, with a 44 px "Volver" and zoom, a clear attribution and the stats', async ({ page }) => {
    await page.goto(`/rutas/${PROFILED_TRAIL.slug}`);
    const map = page.getByTestId('trail-map');
    await expect(map.locator('path.trail-start')).toHaveCount(1);
    const header = (await page.locator('header.topbar').boundingBox())!;
    const box = (await map.boundingBox())!;
    expect(box.y).toBeLessThan(header.y + header.height + 10);
    await expectTarget(page.getByRole('link', { name: 'Volver' }));
    for (const button of await page.locator('.leaflet-bar a').all()) await expectTarget(button);

    const credit = page.getByRole('link', { name: 'OpenStreetMap' });
    await expect(credit).toBeVisible();
    const c = (await credit.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x as number, y as number)?.closest('a')?.textContent ?? null,
      [c.x + c.width / 2, c.y + c.height / 2],
    );
    expect(hit).toBe('OpenStreetMap');

    // The gain, not the loss: 380 / 4200 = 9 %, 410 / 4200 would be 10 %.
    await expect(stat(page, 'Distancia')).toHaveText('4.2 km');
    await expect(stat(page, 'Desnivel')).toHaveText('380 m');
    await expect(stat(page, 'Pendiente')).toHaveText('5.2°');
    await expect(meta(page).getByTestId('trail-status')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Cómo llegar al inicio' })).toHaveAttribute(
      'href',
      new RegExp(`destination=${PROFILED.start.lat},${PROFILED.start.lng}&`),
    );
    expect((await axe(page)).violations).toEqual([]);
    await expectMinFontSize(page);
  });

  test('a trail with no numbers hides the stats', async ({ page }) => {
    await page.goto(`/rutas/${NO_PATH.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: NO_PATH.name })).toBeVisible();
    await expect(page.locator('[data-stat]')).toHaveCount(0);
  });
});

// One sign-in per address and run (the API allows one code per address per 60 s), so these tests
// share two signed-in pages and run in order; after a failure the rest are skipped, not retried.
test.describe('admin and rider', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  let admin: Page;
  let rider: Page;
  let riderEmail: string;

  async function riderUpload(name: string) {
    await rider.goto(IMPORT);
    await gpxInput(rider).setInputFiles(gpxVariant(name.replaceAll(' ', '-')));
    await rider.getByLabel('Nombre').fill(name);
    await rider.getByRole('button', { name: 'Subir ruta' }).click();
  }

  test.beforeAll(async ({ browser }) => {
    const signedIn = async (email: string) => {
      const context = await browser.newContext({ baseURL: ORIGIN });
      await stubTurnstile(context);
      await stubTiles(context);
      const page = await context.newPage();
      await signIn(page, email);
      return page;
    };
    admin = await signedIn(ADMIN_EMAIL);
    riderEmail = `rider-trails-${Date.now()}@example.com`;
    rider = await signedIn(riderEmail);
  });

  test.afterAll(async () => {
    await admin?.context().close();
    await rider?.context().close();
  });

  test('the admin uploads a GPX, sees the draft with its map and profile, publishes it, and the home lists it', async ({
    page,
  }) => {
    tiles.requests = 0;
    await admin.goto('/');
    await admin.getByRole('button', { name: 'Registrar ruta' }).click();
    await admin.getByRole('dialog', { name: 'Registrar' }).getByRole('link', { name: 'Sendero' }).click();
    await expect(admin).toHaveURL(`${ORIGIN}/rutas/nueva`);
    await admin.getByRole('navigation', { name: 'Modo' }).getByRole('link', { name: 'Importar GPX' }).click();
    await expect(admin).toHaveURL(`${ORIGIN}${IMPORT}`);
    await gpxInput(admin).setInputFiles(GPX);
    await admin.getByLabel('Nombre').fill(UPLOADED.name);
    await admin.getByLabel('Ciudad').selectOption('Trujillo');
    await admin.getByLabel('Dificultad').selectOption({ label: 'Difícil' });
    await admin.getByLabel('Tipo').selectOption({ label: 'Cross-country' });
    await admin.getByRole('button', { name: 'Subir ruta' }).click();

    // The draft, which only an admin's forwarded cookie can load.
    await expect(admin).toHaveURL(`${ORIGIN}/rutas/${UPLOADED.slug}`);
    await expect(admin.getByRole('heading', { level: 1, name: UPLOADED.name })).toBeVisible();
    await expectMeta(admin, 'Borrador');
    await expect(admin.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    await expect(admin.getByTestId('trail-map').locator('path.trail-start')).toHaveCount(1);
    await expect(admin.getByTestId('trail-map').locator('path.trail-end')).toHaveCount(1);
    await expect(admin.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
    await expect(admin.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    await expect.poll(() => tiles.requests).toBeGreaterThan(0);
    await expect(admin.getByTestId('elevation-profile')).toBeVisible();
    await expect(fact(admin, 'Distancia')).toHaveText('556 m');
    await expect(fact(admin, 'Desnivel positivo')).toHaveText('12 m');
    await expect(fact(admin, 'Desnivel negativo')).toHaveText('12 m');
    await expect(fact(admin, 'Altura mínima')).toHaveText('100 m');
    await expect(fact(admin, 'Altura máxima')).toHaveText('112 m');
    expect((await page.request.get(`/rutas/${UPLOADED.slug}`)).status()).toBe(404);

    // The refresh after a save keeps the map: the tagged line is still the drawn one.
    await admin.locator('path.trail-path').evaluate((line) => line.setAttribute('data-e2e', 'before-refresh'));
    await admin.getByRole('button', { name: 'Publicar' }).click();
    await expectMeta(admin, 'Publicada');
    await expect(admin.locator('path.trail-path[data-e2e="before-refresh"]')).toHaveCount(1);
    await expect(admin.getByRole('button', { name: 'Ocultar' })).toBeVisible();

    // A save in flight: its own pending label, the other control disabled; then a 401 answer.
    const patchRoute = `**/api/trails/${UPLOADED.slug}`;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await admin.route(patchRoute, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await held;
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"statusCode":401}' });
    });
    await admin.getByRole('button', { name: 'Guardar' }).click();
    await expect(admin.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await expect(admin.getByRole('button', { name: 'Ocultar' })).toBeDisabled();
    release();
    await expect(admin.locator('main').getByRole('alert')).toHaveText('Tu sesión venció. Ingresa de nuevo.');
    await expect(admin.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    await admin.unroute(patchRoute);

    await admin.getByLabel('Descripción').fill('Bajada de prueba E2E');
    await admin.getByRole('button', { name: 'Guardar' }).click();
    await expect(admin.getByTestId('trail-description')).toHaveText('Bajada de prueba E2E');

    await page.goto('/');
    await page.getByRole('link', { name: UPLOADED.name }).click();
    await expect(page).toHaveURL(`${ORIGIN}/rutas/${UPLOADED.slug}`);
    await expect(page.getByTestId('trail-description')).toHaveText('Bajada de prueba E2E');
  });

  test('the same GPX again shows the duplicate message with a link to the existing trail', async () => {
    await admin.goto(IMPORT);
    await gpxInput(admin).setInputFiles(GPX);
    await admin.getByLabel('Nombre').fill('Ruta E2E Duplicada');
    await admin.getByRole('button', { name: 'Subir ruta' }).click();
    const alert = admin.locator('main').getByRole('alert');
    await expect(alert).toContainText('Este GPX ya está subido.');
    await expect(alert.getByRole('link', { name: 'Ver la ruta' })).toHaveAttribute('href', `/rutas/${UPLOADED.slug}`);
    await expect(admin).toHaveURL(`${ORIGIN}${IMPORT}`);
    expect((await axe(admin)).violations).toEqual([]);
  });

  test('a rider opens /rutas/nueva from the FAB sheet and sees no admin controls; anonymous gets 404', async ({ page }) => {
    await rider.goto('/');
    await rider.getByRole('button', { name: 'Registrar ruta' }).click();
    await rider.getByRole('dialog', { name: 'Registrar' }).getByRole('link', { name: 'Sendero' }).click();
    await expect(rider).toHaveURL(`${ORIGIN}/rutas/nueva`);
    await expect(rider.getByRole('heading', { level: 1, name: 'Marcar ruta' })).toBeVisible();
    expect((await rider.request.get('/rutas/nueva')).status()).toBe(200);
    expect((await page.goto('/rutas/nueva'))?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar ruta' })).toHaveCount(0);

    await rider.goto(`/rutas/${NO_PATH.slug}`);
    await expect(rider.getByRole('heading', { level: 1, name: NO_PATH.name })).toBeVisible();
    for (const name of ['Publicar', 'Ocultar', 'Guardar']) {
      await expect(rider.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(rider.getByTestId('trail-status')).toHaveCount(0);
  });

  test('the upload file input stays keyboard-focusable inside the dropzone', async () => {
    await admin.goto(IMPORT);
    await expect(admin.getByLabel('Archivo GPX')).toBeVisible();
    await admin.getByRole('navigation', { name: 'Modo' }).getByRole('link', { name: 'Importar GPX' }).focus();
    await admin.keyboard.press('Tab');
    await expect(gpxInput(admin)).toBeFocused();
    await expectMinFontSize(admin);
  });

  test('a rider registers a route: "En revisión", in Mis rutas and the admin queue, then published', async ({ page }) => {
    await riderUpload('Ruta Rider E2E');
    await expect(rider).toHaveURL(`${ORIGIN}/rutas/ruta-rider-e2e`);
    await expect(meta(rider).getByTestId('trail-status')).toHaveText('En revisión');
    await expect(rider.getByRole('button', { name: 'Publicar' })).toHaveCount(0);
    expect((await page.request.get('/rutas/ruta-rider-e2e')).status()).toBe(404);

    const nav = rider.getByRole('navigation', { name: 'Principal' });
    await expectTarget(nav.getByRole('button', { name: 'Registrar ruta' }));
    for (const link of await nav.getByRole('link').all()) await expectTarget(link);
    await nav.getByRole('link', { name: 'Mis rutas' }).click();
    await expect(rider).toHaveURL(`${ORIGIN}/mis-rutas`);
    await expect(nav.getByRole('link', { name: 'Mis rutas' })).toHaveAttribute('aria-current', 'page');
    const mine = rider.getByTestId('trail-card').filter({ hasText: 'Ruta Rider E2E' });
    await expect(mine.getByTestId('trail-status')).toHaveText('En revisión');
    await expect(nav.getByRole('link', { name: 'Revisión' })).toHaveCount(0);
    expect((await rider.request.get('/admin/rutas')).status()).toBe(404);
    expect((await rider.request.get('/mis-rutas')).status()).toBe(200);
    expect((await page.request.get('/mis-rutas')).status()).toBe(404);
    expect((await admin.request.get('/admin/rutas')).status()).toBe(200);
    expect((await axe(rider)).violations).toEqual([]);

    await admin.goto('/');
    const adminNav = admin.getByRole('navigation', { name: 'Principal' });
    await expect(adminNav.getByRole('link')).toHaveCount(3);
    await expect(adminNav.getByRole('button', { name: 'Registrar ruta' })).toHaveCount(1);
    for (const link of await adminNav.getByRole('link').all()) await expectTarget(link);
    await admin.setViewportSize({ width: 390, height: 844 });
    await adminNav.getByRole('link', { name: 'Explorar' }).focus();
    const tabbed: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await admin.keyboard.press('Tab');
      tabbed.push(await admin.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(tabbed).toEqual(['Mis rutas', 'Registrar ruta', 'Revisión']);
    const xs = await adminNav.getByRole('link').evaluateAll((links) => links.map((link) => link.getBoundingClientRect().x));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    await admin.setViewportSize({ width: 1280, height: 720 });
    await adminNav.getByRole('link', { name: 'Revisión' }).click();
    await expect(admin).toHaveURL(`${ORIGIN}/admin/rutas`);
    const queued = admin.getByTestId('trail-card').filter({ hasText: 'Ruta Rider E2E' });
    await expect(queued).toContainText(`Registrada por ${riderEmail}`);
    expect((await axe(admin)).violations).toEqual([]);
    await queued.click();
    await admin.getByRole('button', { name: 'Publicar' }).click();
    await expect(meta(admin).getByTestId('trail-status')).toHaveText('Publicada');
    await admin.goto('/admin/rutas');
    await expect(admin.getByTestId('trail-card').filter({ hasText: 'Ruta Rider E2E' })).toHaveCount(0);

    await rider.goto('/mis-rutas');
    await expect(mine.getByTestId('trail-status')).toHaveText('Publicada');
    await rider.goto('/rutas/ruta-rider-e2e');
    await expect(meta(rider).getByTestId('trail-status')).toHaveCount(0);
  });

  test('a rider who uploads a GPX that is already stored gets the duplicate message', async () => {
    await rider.goto(IMPORT);
    await gpxInput(rider).setInputFiles(GPX);
    await rider.getByLabel('Nombre').fill('Ruta Rider Duplicada');
    await rider.getByRole('button', { name: 'Subir ruta' }).click();
    await expect(rider.locator('main').getByRole('alert')).toContainText('Este GPX ya está subido.');
    await expect(rider).toHaveURL(`${ORIGIN}${IMPORT}`);
  });

  test('a 409 duplicate without a slug says "Esta ruta ya fue registrada." with no link', async () => {
    await rider.route('**/api/trails', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"code":"GPX_DUPLICATE"}' })
        : route.fallback(),
    );
    try {
      await riderUpload('Ruta Ajena');
      const alert = rider.locator('main').getByRole('alert');
      await expect(alert).toHaveText('Esta ruta ya fue registrada.');
      await expect(alert.getByRole('link', { name: 'Ver la ruta' })).toHaveCount(0);
    } finally {
      await rider.unroute('**/api/trails');
    }
  });

  test('a rider with 3 routes in review gets the Spanish limit message on the 4th', async () => {
    for (const n of [1, 2, 3]) {
      await riderUpload(`Ruta Pendiente ${n}`);
      await expect(rider).toHaveURL(`${ORIGIN}/rutas/ruta-pendiente-${n}`);
    }
    await riderUpload('Ruta Pendiente 4');
    await expect(rider.locator('main').getByRole('alert')).toHaveText('Tienes 3 rutas en revisión. Espera la aprobación.');
    await expect(rider).toHaveURL(`${ORIGIN}${IMPORT}`);
  });

  test('the admin refuses a draft: the rider sees "No aprobada" on the detail and in Mis rutas', async () => {
    await admin.goto('/rutas/ruta-pendiente-1');
    await expect(meta(admin).getByTestId('trail-status')).toHaveText('Borrador');
    await expect(admin.getByRole('button', { name: 'Publicar' })).toBeVisible();
    await admin.getByRole('button', { name: 'Ocultar' }).click();
    await expect(meta(admin).getByTestId('trail-status')).toHaveText('Oculta');
    await expect(admin.getByRole('button', { name: 'Ocultar' })).toHaveCount(0);

    await rider.goto('/rutas/ruta-pendiente-1');
    await expect(meta(rider).getByTestId('trail-status')).toHaveText('No aprobada');
    await rider.goto('/mis-rutas');
    await expect(rider.getByTestId('trail-card').filter({ hasText: 'Ruta Pendiente 1' }).getByTestId('trail-status')).toHaveText(
      'No aprobada',
    );
  });

  test('the upload form and the trail detail have no WCAG A/AA violations', async () => {
    await rider.goto(`/rutas/${UPLOADED.slug}`);
    await expect(rider.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    expect((await axe(rider)).violations).toEqual([]);

    await admin.goto(IMPORT);
    await expect(admin.getByRole('button', { name: 'Subir ruta' })).toBeVisible();
    expect((await axe(admin)).violations).toEqual([]);

    await admin.goto(`/rutas/${UPLOADED.slug}`);
    await expect(admin.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    await expect(admin.getByTestId('elevation-profile')).toBeVisible();
    expect((await axe(admin)).violations).toEqual([]);
  });
});
