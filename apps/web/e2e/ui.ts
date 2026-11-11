// Shared e2e helpers for the UI layer: touch targets, axe scans and the OSM tile stub.
import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/** A 1×1 PNG: the suite never calls OpenStreetMap. */
export const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** OSM tile requests stubbed so far in this worker: the proof that a map asks for the policy URL. */
export const tiles = { requests: 0 };

/** Routes OSM tiles to a blank PNG, counted in `tiles.requests`. */
export const stubTiles = (context: BrowserContext) =>
  context.route('https://tile.openstreetmap.org/**', (route) => {
    tiles.requests += 1;
    return route.fulfill({ contentType: 'image/png', body: BLANK_PNG });
  });

/** No rendered text below 11 px (plan D3). Returns nothing; fails with the offending texts. */
export async function expectMinFontSize(page: Page) {
  const small = await page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || el.getClientRects().length === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 11) found.push(`${size}px: ${text.slice(0, 40)}`);
    }
    return found;
  });
  expect(small).toEqual([]);
}

export const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

/** The WCAG 2.5.5 touch target: at least 44 × 44 CSS px. */
export async function expectTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'the target is rendered').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}
