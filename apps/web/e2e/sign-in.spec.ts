import { randomBytes } from 'node:crypto';
import { expect, type Page, type Request } from '@playwright/test';
import pg from 'pg';
import { codesFor } from './codes.ts';
import { ORIGIN_PORT } from './ports.ts';
import { nextTokenBad, SITE_KEY, test, widgetCall, widgetState } from './turnstile.ts';

const INVALID = 'Código inválido o vencido.';
const LOCKED = 'Demasiados intentos con este código. Pide un código nuevo.';
const RATE_LIMITED = 'Demasiados intentos. Espera un minuto.';
const GENERIC = 'No pudimos completar la solicitud. Intenta de nuevo.';
const CAPTCHA = 'No pudimos verificar que eres una persona. Intenta de nuevo.';
const SEND_PATH = '/api/auth/email-otp/send-verification-otp';

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
  await expect(page.getByLabel('Código')).toBeFocused();
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
  const start = page.waitForRequest((request) => request.url().endsWith('/api/auth/sign-in/social'));
  const google = page.waitForRequest((request) => request.url().startsWith('https://accounts.google.com/'));
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  const body = (await start).postDataJSON() as { callbackURL?: string; errorCallbackURL?: string };
  expect(body.callbackURL).toBe(`http://127.0.0.1:${ORIGIN_PORT}/`);
  // Without it, Google errors would land on Better Auth's own page instead of /ingresar.
  expect(body.errorCallbackURL).toBe(`http://127.0.0.1:${ORIGIN_PORT}/ingresar`);
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

test('a code check that never answers ends after 10 s with the generic message', async ({ page }) => {
  const { code } = await requestCode(page);
  await page.route('**/api/auth/sign-in/email-otp', () => {}); // never answered
  await page.getByLabel('Código').fill(code);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(formAlert(page)).toHaveText(GENERIC, { timeout: 15_000 });
});

const isSend = (request: Request) => request.url().endsWith(SEND_PATH);

/** Ages every cooldown row by 61 s, so the next send for the address really mails. */
async function endCooldown() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/ciudad_enduro');
  url.pathname = `/ciudad_enduro_test_${process.env.TEST_DB_SUFFIX ?? 'main'}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("update otp_send_log set created_at = created_at - interval '61 seconds'");
  } finally {
    await client.end();
  }
}

test('the widget gets the runtime site key, the send_code action and Spanish', async ({ page }) => {
  await page.goto('/ingresar');
  await expect.poll(async () => (await widgetState(page)).renders).toEqual([{ sitekey: SITE_KEY, action: 'send_code', language: 'es' }]);
});

test('Enviar otro código really resends, with a fresh token, and the new code signs in', async ({ page }) => {
  const tokens: (string | null)[] = [];
  page.on('request', (request) => {
    if (isSend(request)) tokens.push(request.headers()['x-captcha-response'] ?? null);
  });
  const { email } = await requestCode(page);
  await endCooldown();

  await freshIp(page);
  const resent = page.waitForResponse((response) => isSend(response.request()));
  await page.getByRole('button', { name: 'Enviar otro código' }).click();
  expect((await resent).status()).toBe(200);
  await expect.poll(() => codesFor(email).length).toBe(2);
  // One widget for both steps, a new token per send.
  expect((await widgetState(page)).renders).toHaveLength(1);
  expect(tokens).toHaveLength(2);
  expect(tokens[0]).toMatch(/^stub~/);
  expect(tokens[1]).toMatch(/^stub~/);
  expect(tokens[1]).not.toBe(tokens[0]);

  await freshIp(page);
  await submitCode(page, codesFor(email)[1] as string);
  await expect(page.getByTestId('session-email')).toHaveText(email);
});

test('a refused token shows the captcha message; the retry gets a fresh token and sends', async ({ page }) => {
  const email = uniqueEmail();
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(email);
  await expect(page.getByRole('button', { name: 'Enviar código' })).toBeEnabled();
  await nextTokenBad(page);
  await widgetCall(page, 'issueAll');

  await freshIp(page);
  const refused = page.waitForResponse((response) => isSend(response.request()));
  await page.getByRole('button', { name: 'Enviar código' }).click();
  expect((await refused).status()).toBe(403);
  await expect(formAlert(page)).toHaveText(CAPTCHA);
  expect(codesFor(email)).toHaveLength(0);

  await freshIp(page);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByText(`Te enviamos un código a ${email}.`)).toBeVisible();
  await expect.poll(() => codesFor(email).length).toBe(1);
});

test('an expired or failed widget disables the send until a new token arrives', async ({ page }) => {
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(uniqueEmail());
  const send = page.getByRole('button', { name: 'Enviar código' });
  await expect(send).toBeEnabled();
  for (const event of ['expire', 'error'] as const) {
    await widgetCall(page, event);
    await expect(send).toBeDisabled();
    await widgetCall(page, 'issueAll');
    await expect(send).toBeEnabled();
  }
});
