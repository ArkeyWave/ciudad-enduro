import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, PUBLISHED } from './fixtures.ts';
import { ORIGIN_PORT } from './ports.ts';
import { signIn } from './session.ts';
import { stubTurnstile, test } from './turnstile.ts';

const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
// Six points, gain 12 m, loss 12 m, min 100 m, max 112 m (the API's own fixture).
const GPX = fileURLToPath(new URL('../../api/test/fixtures/one-segment.gpx', import.meta.url));
const UPLOADED = { name: 'Ruta E2E Subida', slug: 'ruta-e2e-subida' };
// Seeded with a start point only: no path, no profile.
const NO_PATH = PUBLISHED[0] as (typeof PUBLISHED)[number];
const NOT_FOUND = 'No encontramos esta página';
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// The suite never calls OpenStreetMap; the count proves the map asks for the policy URL.
let tileRequests = 0;
const stubTiles = (context: BrowserContext) =>
  context.route('https://tile.openstreetmap.org/**', (route) => {
    tileRequests += 1;
    return route.fulfill({ contentType: 'image/png', body: BLANK_PNG });
  });

const fact = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`);
const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

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

// One sign-in per address and run (the API allows one code per address per 60 s), so these tests
// share two signed-in pages and run in order; after a failure the rest are skipped, not retried.
test.describe('admin and rider', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  let admin: Page;
  let rider: Page;

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
    rider = await signedIn(`rider-trails-${Date.now()}@example.com`);
  });

  test.afterAll(async () => {
    await admin?.context().close();
    await rider?.context().close();
  });

  test('the admin uploads a GPX, sees the draft with its map and profile, publishes it, and the home lists it', async ({
    page,
  }) => {
    await admin.goto('/');
    await admin.getByRole('link', { name: 'Nueva ruta' }).click();
    await expect(admin).toHaveURL(`${ORIGIN}/rutas/nueva`);
    await admin.getByLabel('Archivo GPX').setInputFiles(GPX);
    await admin.getByLabel('Nombre').fill(UPLOADED.name);
    await admin.getByLabel('Ciudad').selectOption('Trujillo');
    await admin.getByLabel('Dificultad').selectOption({ label: 'Difícil' });
    await admin.getByLabel('Tipo').selectOption({ label: 'Cross-country' });
    await admin.getByRole('button', { name: 'Subir ruta' }).click();

    // The draft, which only an admin's forwarded cookie can load.
    await expect(admin).toHaveURL(`${ORIGIN}/rutas/${UPLOADED.slug}`);
    await expect(admin.getByRole('heading', { level: 1, name: UPLOADED.name })).toBeVisible();
    await expect(admin.getByText('Trujillo · Difícil · Cross-country · Borrador')).toBeVisible();
    await expect(admin.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    await expect(admin.getByTestId('trail-map').locator('path.trail-start')).toHaveCount(1);
    await expect(admin.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    await expect.poll(() => tileRequests).toBeGreaterThan(0);
    await expect(admin.getByTestId('elevation-profile')).toBeVisible();
    await expect(fact(admin, 'Desnivel positivo')).toHaveText('12 m');
    await expect(fact(admin, 'Desnivel negativo')).toHaveText('12 m');
    await expect(fact(admin, 'Altura mínima')).toHaveText('100 m');
    await expect(fact(admin, 'Altura máxima')).toHaveText('112 m');
    expect((await page.request.get(`/rutas/${UPLOADED.slug}`)).status()).toBe(404);

    await admin.getByRole('button', { name: 'Publicar' }).click();
    await expect(admin.getByText('Trujillo · Difícil · Cross-country · Publicada')).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Ocultar' })).toBeVisible();

    await admin.getByLabel('Descripción').fill('Bajada de prueba E2E');
    await admin.getByRole('button', { name: 'Guardar' }).click();
    await expect(admin.getByTestId('trail-description')).toHaveText('Bajada de prueba E2E');

    await page.goto('/');
    await page.getByRole('link', { name: UPLOADED.name }).click();
    await expect(page).toHaveURL(`${ORIGIN}/rutas/${UPLOADED.slug}`);
    await expect(page.getByTestId('trail-description')).toHaveText('Bajada de prueba E2E');
  });

  test('a rider gets HTTP 404 on /rutas/nueva and sees no admin controls', async ({ page }) => {
    await expect(rider.getByTestId('session-email')).toBeVisible();
    const response = await rider.goto('/rutas/nueva');
    expect(response?.status()).toBe(404);
    await expect(rider.getByRole('heading', { name: NOT_FOUND })).toBeVisible();
    await expect(rider.getByRole('link', { name: 'Nueva ruta' })).toHaveCount(0);
    expect((await page.goto('/rutas/nueva'))?.status()).toBe(404);

    await rider.goto(`/rutas/${NO_PATH.slug}`);
    await expect(rider.getByRole('heading', { level: 1, name: NO_PATH.name })).toBeVisible();
    for (const name of ['Publicar', 'Ocultar', 'Guardar']) {
      await expect(rider.getByRole('button', { name })).toHaveCount(0);
    }
  });

  test('the upload form and the trail detail have no WCAG A/AA violations', async () => {
    await admin.goto('/rutas/nueva');
    await expect(admin.getByRole('button', { name: 'Subir ruta' })).toBeVisible();
    expect((await axe(admin)).violations).toEqual([]);

    await admin.goto(`/rutas/${UPLOADED.slug}`);
    await expect(admin.getByTestId('trail-map').locator('path.trail-path')).toHaveCount(1);
    await expect(admin.getByTestId('elevation-profile')).toBeVisible();
    expect((await axe(admin)).violations).toEqual([]);
  });
});
