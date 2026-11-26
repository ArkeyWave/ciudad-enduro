// The Explorar card slider (plan §10 L3-8, §10.1 A13, A14): markup, the overlay, the auto-advance.
// The clock is Playwright's: the 3 s wait runs only when a test moves it.
import { expect, type Page } from '@playwright/test';
import { deleteTrail, seedSliderTrail } from './db.ts';
import { PUBLISHED } from './fixtures.ts';
import { test } from './turnstile.ts';
import { axe, BLANK_PNG, expectTarget, stubTiles } from './ui.ts';

const SLIDER = { slug: 'e2e-card-slider', name: 'Loma del Slider' };
const BARE = PUBLISHED[0] as (typeof PUBLISHED)[number];
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const card = (page: Page, name = SLIDER.name) => page.getByTestId('trail-card').filter({ hasText: name });
const slides = (page: Page) => page.getByRole('region', { name: `Mapa y vistas de ${SLIDER.name}` });
/** The slide in view: 0 is the map. */
const slideIndex = (page: Page) => slides(page).evaluate((el) => Math.round(el.scrollLeft / el.clientWidth));
/** The slide once a smooth scroll had time to end: it runs on real time, not on the page clock. */
async function settledIndex(page: Page) {
  await page.waitForTimeout(1000);
  return slideIndex(page);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await deleteTrail(SLIDER.slug);
  await seedSliderTrail(SLIDER.slug, SLIDER.name, 2);
});
test.afterAll(() => deleteTrail(SLIDER.slug));

test.beforeEach(async ({ context }) => {
  await stubTiles(context);
  // The photo files do not exist in the S3 mock.
  await context.route('http://127.0.0.1:9090/**', (route) => route.fulfill({ contentType: 'image/png', body: BLANK_PNG }));
});

/**
 * Explorar with a paused clock. The slider card is the last one, below the screen centre band at
 * load; the room below the list lets the page put it at the screen centre.
 */
async function open(page: Page, viewport = PHONE) {
  await page.setViewportSize(viewport);
  await page.clock.install({ time: new Date('2026-11-25T12:00:00Z') });
  await page.goto('/');
  await expect(slides(page)).toBeVisible();
  await page.addStyleTag({ content: 'main.page { padding-bottom: 100vh; }' });
  await page.clock.pauseAt(new Date('2026-11-25T12:01:00Z'));
}

/** Scrolls the page so the card centre sits `offset` px below the screen centre, then lets the observer report. */
async function centre(page: Page, offset = 0) {
  await card(page).evaluate((el, offset) => {
    const box = el.getBoundingClientRect();
    window.scrollBy({ top: box.top + box.height / 2 - (window.innerHeight / 2 + offset), behavior: 'instant' });
  }, offset);
  // IntersectionObserver reports in a rendering step, which the paused clock does not hold back.
  await page.waitForTimeout(300);
}

test('the card is an article: the title is the only link outside the attribution, a tap on a slide stays on Explorar', async ({ page }) => {
  await open(page);
  const slider = card(page);
  expect(await slider.evaluate((el) => el.tagName)).toBe('ARTICLE');
  const links = slider.getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.filter({ hasNotText: 'OpenStreetMap' })).toHaveCount(1);
  await expect(slider.getByRole('link', { name: SLIDER.name })).toHaveAttribute('href', `/rutas/${SLIDER.slug}`);
  await expect(slider.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');

  await expect(slides(page)).toHaveAttribute('tabindex', '0');
  // Slide 1 is the static map: 4 zoom-14 tiles and the start dot.
  await expect(slides(page).locator('.tile-mosaic img')).toHaveCount(4);
  await expect(slides(page).locator('.tile-mosaic img').first()).toHaveAttribute('src', /^https:\/\/tile\.openstreetmap\.org\/14\/\d+\/\d+\.png$/);
  await expect(slides(page).locator('.start-dot')).toHaveCount(1);
  await expect(slides(page).locator('img[loading="lazy"]')).toHaveCount(6);

  await expect(slider.getByRole('button')).toHaveCount(3);
  for (const [i, name] of ['Mapa', 'Vista 1 de 2', 'Vista 2 de 2'].entries()) {
    const dot = slider.getByRole('button', { name, exact: true });
    await expectTarget(dot);
    if (i === 0) await expect(dot).toHaveAttribute('aria-current', 'true');
    else await expect(dot).not.toHaveAttribute('aria-current');
  }

  // A trail without photos: the map slide only, no dots, no tab stop (nothing scrolls).
  await expect(card(page, BARE.name).getByRole('region')).toHaveCount(1);
  await expect(card(page, BARE.name).getByRole('region')).not.toHaveAttribute('tabindex');
  await expect(card(page, BARE.name).getByRole('button')).toHaveCount(0);
  await expect(card(page, BARE.name).getByRole('link')).toHaveCount(2);

  // axe waits on timers: the clock runs again (scrollable-region-focusable needs the tabindex).
  await page.clock.resume();
  expect((await axe(page)).violations).toEqual([]);

  // The slider sits above the stretched title link: a tap on a slide or a dot does not open the trail.
  await slides(page).click();
  await slider.getByRole('button', { name: 'Vista 2 de 2' }).click();
  await expect.poll(() => slideIndex(page)).toBe(2);
  await expect(slider.getByRole('button', { name: 'Vista 2 de 2' })).toHaveAttribute('aria-current', 'true');
  await expect(slider.getByRole('button', { name: 'Mapa' })).not.toHaveAttribute('aria-current');
  await expect(page).toHaveURL(/\/$/);
  // The rest of the card still opens the trail: the stretched link covers it (so no actionability check).
  await slider.locator('.type-label').click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/rutas/${SLIDER.slug}$`));
});

for (const viewport of [PHONE, DESKTOP]) {
  test(`at ${viewport.width} px it moves once to the first photo, 3 s after the card centre reaches the screen centre`, async ({ page }) => {
    await open(page, viewport);
    // The observed point is the card's vertical centre, not its edge.
    const [cardBox, sentinelBox] = await Promise.all([card(page).boundingBox(), card(page).locator('.card-centre').boundingBox()]);
    expect(sentinelBox!.y + sentinelBox!.height / 2).toBeCloseTo(cardBox!.y + cardBox!.height / 2, 0);

    await centre(page);
    await page.clock.runFor(2900);
    expect(await settledIndex(page)).toBe(0);
    await page.clock.runFor(200);
    await expect.poll(() => slideIndex(page)).toBe(1);
    await expect(card(page).getByRole('button', { name: 'Vista 1 de 2' })).toHaveAttribute('aria-current', 'true');
    // Never loops and never goes on.
    await centre(page, 300);
    await centre(page);
    await page.clock.runFor(10_000);
    expect(await settledIndex(page)).toBe(1);
  });
}

test('leaving the centre band before 3 s cancels the move; a new entry waits 3 s again', async ({ page }) => {
  await open(page);
  await centre(page);
  await page.clock.runFor(2000);
  await centre(page, 300);
  await page.clock.runFor(5000);
  expect(await settledIndex(page)).toBe(0);

  await centre(page);
  await page.clock.runFor(3100);
  await expect.poll(() => slideIndex(page)).toBe(1);
});

const INPUTS: Record<string, (page: Page) => Promise<unknown>> = {
  // A swipe is a scroll of the slider, here forward and back to the map.
  'a swipe back to the map': (page) =>
    slides(page).evaluate((el) => {
      el.scrollTo({ left: el.clientWidth, behavior: 'instant' });
      el.scrollTo({ left: 0, behavior: 'instant' });
    }),
  // Without the focus a mouse press gives, as a tap on some touch browsers.
  'a tap on the slider (pointerdown, pointerup)': async (page) => {
    await slides(page).dispatchEvent('pointerdown');
    await slides(page).dispatchEvent('pointerup');
  },
  'the keyboard focus on the slider': (page) => slides(page).focus(),
};

for (const [input, act] of Object.entries(INPUTS)) {
  test(`${input} stops the move for good`, async ({ page }) => {
    await open(page);
    await centre(page);
    await page.clock.runFor(1000);
    await act(page);
    await page.clock.runFor(10_000);
    expect(await settledIndex(page)).toBe(0);
  });
}

// Plan review F1: a vertical page scroll that starts on the slider is pointerdown, then pointercancel.
test('a page scroll that starts on the slider does not stop the move', async ({ page }) => {
  await open(page);
  await centre(page);
  await page.clock.runFor(1000);
  await slides(page).dispatchEvent('pointerdown');
  await slides(page).dispatchEvent('pointercancel');
  await page.clock.runFor(2100);
  await expect.poll(() => slideIndex(page)).toBe(1);
});

/**
 * Explorar with the page scripts held back (not the stylesheets: they hold the streamed list): `act`
 * runs on the server HTML (a rider who swipes or focuses before hydration), then the scripts load
 * and the slider hydrates.
 */
async function openBeforeHydration(page: Page, act: (page: Page) => Promise<unknown>) {
  let release = () => {};
  const scripts = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/_next/static/chunks/*.js', async (route) => {
    await scripts;
    await route.continue();
  });
  await page.setViewportSize(PHONE);
  await page.clock.install({ time: new Date('2026-11-25T12:00:00Z') });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(slides(page)).toBeVisible();
  await act(page);
  release();
  await page.waitForLoadState('networkidle');
  // Hydration and the effects run on real time.
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: 'main.page { padding-bottom: 100vh; }' });
  await page.clock.pauseAt(new Date('2026-11-25T12:01:00Z'));
}

test('a swipe before hydration: the dots show that slide and the slider never moves by itself', async ({ page }) => {
  await openBeforeHydration(page, (page) => slides(page).evaluate((el) => el.scrollTo({ left: 2 * el.clientWidth, behavior: 'instant' })));
  await expect(card(page).getByRole('button', { name: 'Vista 2 de 2' })).toHaveAttribute('aria-current', 'true');
  await centre(page);
  await page.clock.runFor(10_000);
  expect(await settledIndex(page)).toBe(2);
});

test('a focus before hydration: the slider never moves by itself', async ({ page }) => {
  await openBeforeHydration(page, (page) => slides(page).focus());
  await centre(page);
  await page.clock.runFor(10_000);
  expect(await settledIndex(page)).toBe(0);
});

test('a dot click stops the move for good', async ({ page }) => {
  await open(page);
  await centre(page);
  await page.clock.runFor(1000);
  await card(page).getByRole('button', { name: 'Mapa' }).click();
  await page.clock.runFor(10_000);
  expect(await settledIndex(page)).toBe(0);
});

test('with reduced motion the slider never moves by itself; the dots still work', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await centre(page);
  await page.clock.runFor(10_000);
  expect(await settledIndex(page)).toBe(0);
  await card(page).getByRole('button', { name: 'Vista 1 de 2' }).click();
  await expect.poll(() => slideIndex(page)).toBe(1);
});
