// Browser calls to the Better Auth routes on the same origin (Traefik routes /api to the API).
// Plain fetch: every call is a JSON POST, so the browser sends `Origin`, which the API's CSRF check
// needs (also on /sign-out; a form navigation is not a substitute).
import type { AuthFailure } from './auth-errors';

/** A browser auth call that takes longer is aborted and counts as a network failure (status 0). */
export const AUTH_TIMEOUT_MS = 10_000;

export type AuthResult<T = unknown> = ({ ok: true } & T) | ({ ok: false } & AuthFailure);

async function post<T>(path: string, body: object, headers: Record<string, string> = {}): Promise<AuthResult<{ data: T }>> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0 }; // network failure or timeout
  }
  const json = (await response.json().catch(() => null)) as (T & { code?: string }) | null;
  if (!response.ok) return { ok: false, status: response.status, code: json?.code };
  return { ok: true, data: json as T };
}

/**
 * Always answers success for a valid address (the API never tells whether it has an account).
 * `captchaToken` is a Turnstile token; the API accepts each token once.
 */
export const sendCode = (email: string, captchaToken: string) =>
  post('/email-otp/send-verification-otp', { email, type: 'sign-in' }, { 'x-captcha-response': captchaToken });

export const verifyCode = (email: string, otp: string) => post('/sign-in/email-otp', { email, otp });

export const signOut = () => post('/sign-out', {});

/** Starts the Google redirect flow; the result's `url` is Google's consent page. */
export function startGoogleSignIn(origin: string) {
  return post<{ url?: string }>('/sign-in/social', {
    provider: 'google',
    callbackURL: `${origin}/`,
    errorCallbackURL: `${origin}/ingresar`,
  });
}
