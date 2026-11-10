import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { codesFor } from './codes.ts';
import { ORIGIN_PORT } from './ports.ts';

const INVALID = 'Código inválido o vencido.';
const LOCKED = 'Demasiados intentos con este código. Pide un código nuevo.';
const RATE_LIMITED = 'Demasiados intentos. Espera un minuto.';

// Better Auth's per-IP limiter (3 sign-in attempts per 10 s) is shared by every test in the API
// process, and the client IP comes from cf-connecting-ip only. So each request that must not be
// limited gets its own address. Random, not a counter: Playwright restarts the worker after a
// failed test, and a counter would then reuse addresses inside the API's windows.
async function freshIp(page: Page) {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.${[...randomBytes(3)].join('.')}` });
}

let emailCounter = 0;
const uniqueEmail = () => `rider-${Date.now()}-${++emailCounter}@example.com`;

/** Opens /ingresar, requests a code for a new address and returns the address and the code. */
async function requestCode(page: Page) {
  const email = uniqueEmail();
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(email);
  await freshIp(page);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByText(`Te enviamos un código a ${email}.`)).toBeVisible();
  await expect.poll(() => codesFor(email).length).toBe(1);
  return { email, code: codesFor(email)[0] as string };
}

/** Submits a code and waits for the API's answer, so a repeated message is never a stale one. */
async function submitCode(page: Page, code: string) {
  await page.getByLabel('Código').fill(code);
  const answer = page.waitForResponse((response) => response.url().endsWith('/api/auth/sign-in/email-otp'));
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  return answer;
}

// Scoped to <main>: Next's route announcer is an alert too.
const formAlert = (page: Page) => page.locator('main').getByRole('alert');

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

test('signs in with an email code, shows the email, and signs out with fetch', async ({ page }) => {
  const { email, code } = await requestCode(page);
  await freshIp(page);
  await submitCode(page, code);

  await expect(page).toHaveURL(`http://127.0.0.1:${ORIGIN_PORT}/`);
  await expect(page.getByTestId('session-email')).toHaveText(email);
  expect((await page.request.get('/api/me')).status()).toBe(200);

  await freshIp(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('link', { name: 'Ingresar' })).toBeVisible();
  await expect(page.getByTestId('session-email')).toHaveCount(0);
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('5 wrong codes, then the right code shows the locked message, not the 429 one', async ({ page }) => {
  const { code } = await requestCode(page);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await freshIp(page);
    expect((await submitCode(page, wrongCode(code))).status()).toBe(400);
    await expect(formAlert(page)).toHaveText(INVALID);
  }
  await freshIp(page);
  expect((await submitCode(page, code)).status()).toBe(403);
  await expect(formAlert(page)).toHaveText(LOCKED);
  await expect(page).toHaveURL(/\/ingresar$/);
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('a 4th attempt from one IP within 10 s shows the rate-limit message', async ({ page }) => {
  const { code } = await requestCode(page);
  await freshIp(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    expect((await submitCode(page, wrongCode(code))).status()).toBe(400);
  }
  expect((await submitCode(page, wrongCode(code))).status()).toBe(429);
  await expect(formAlert(page)).toHaveText(RATE_LIMITED);
});

test('shows the Google error that Better Auth sends back to /ingresar', async ({ page }) => {
  const cases = [
    ['account_not_linked', 'Esta cuenta ingresa con código por correo.'],
    ['google_email_unverified', 'Tu correo de Google no está verificado.'],
    ['state_mismatch', 'No pudimos ingresar con Google. Intenta de nuevo.'],
  ] as const;
  for (const [error, message] of cases) {
    await page.goto(`/ingresar?error=${error}`);
    await expect(formAlert(page)).toHaveText(message);
  }
});

test('Continuar con Google starts the redirect flow at Google', async ({ page }) => {
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ body: 'google stub' }));
  await page.goto('/ingresar');
  await freshIp(page);
  const google = page.waitForRequest((request) => request.url().startsWith('https://accounts.google.com/'));
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  const consent = new URL((await google).url());
  expect(consent.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${ORIGIN_PORT}/api/auth/callback/google`);
  expect(consent.searchParams.get('state')).toBeTruthy();
});

// Chromium still sends a real Origin under no-referrer, so the sign-out test cannot catch this;
// other browsers send `Origin: null`, which the API's CSRF check answers with 403.
test('the web never sets Referrer-Policy: no-referrer', async ({ page }) => {
  for (const path of ['/', '/ingresar']) {
    const response = await page.goto(path);
    expect(response?.headers()['referrer-policy'] ?? '').not.toMatch(/no-referrer(?!-)/);
    await expect(page.locator('meta[name="referrer"][content="no-referrer"]')).toHaveCount(0);
  }
});
