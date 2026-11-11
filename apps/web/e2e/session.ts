import { randomBytes } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { codesFor } from './codes.ts';

// Better Auth's per-IP limiter (3 sign-in attempts per 10 s) is shared by every test in the API
// process, and the client IP comes from cf-connecting-ip only. So each request that must not be
// limited gets its own address. Random, not a counter: Playwright restarts the worker after a
// failed test, and a counter would then reuse addresses inside the API's windows.
export async function freshIp(page: Page) {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.${[...randomBytes(3)].join('.')}` });
}

/**
 * Signs `page` in as `email` through the real code flow, with the last code mailed. The page's
 * context needs the Turnstile stub. The API allows one send per address per 60 s, so sign in once
 * per address and run.
 */
export async function signIn(page: Page, email: string) {
  const before = codesFor(email).length;
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(email);
  await freshIp(page);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await expect(page.getByLabel('Código')).toBeFocused();
  await expect.poll(() => codesFor(email).length).toBe(before + 1);
  await page.getByLabel('Código').fill(codesFor(email).at(-1) as string);
  await freshIp(page);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByTestId('session-email')).toHaveText(email);
}
