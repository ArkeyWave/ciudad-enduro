// Full-page screenshots for the owner's comparison with the prototype (plan D14). Not pixel
// baselines: CI uploads apps/web/test-results/ as an artifact.
import { expect } from '@playwright/test';
import { PUBLISHED } from './fixtures.ts';
import { signIn } from './session.ts';
import { test } from './turnstile.ts';
import { stubTiles } from './ui.ts';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const DETAIL = `/rutas/${(PUBLISHED[1] as (typeof PUBLISHED)[number]).slug}`;

test('screens at 390 and 1280 px', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await stubTiles(context);
  const shoot = async (name: string, width: number) =>
    page.screenshot({ path: testInfo.outputPath(`${width}-${name}.png`), fullPage: true });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/ingresar');
    await expect(page.getByLabel('Correo')).toBeVisible();
    await shoot('ingresar', viewport.width);
    await page.goto('/');
    await expect(page.getByTestId('trail-card').first()).toBeVisible();
    await shoot('explorar', viewport.width);
    await page.goto('/mapa');
    await expect(page.getByTestId('explore-map').locator('path.trail-pin').first()).toBeVisible();
    await shoot('mapa', viewport.width);
    await page.goto(DETAIL);
    await expect(page.getByTestId('elevation-profile')).toBeVisible();
    await shoot('detalle', viewport.width);
  }

  await signIn(page, `rider-screens-${Date.now()}@example.com`);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/rutas/nueva?modo=gpx');
    await expect(page.getByLabel('Archivo GPX')).toBeVisible();
    await shoot('importar-gpx', viewport.width);
    await page.goto('/rutas/nueva');
    await expect(page.getByTestId('tracer-map')).toBeVisible();
    await shoot('marcar', viewport.width);
  }
});
