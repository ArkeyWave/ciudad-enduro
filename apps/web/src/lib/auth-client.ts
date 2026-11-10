// Browser calls to the Better Auth routes on the same origin (Traefik routes /api to the API).
// Plain fetch: every call is a JSON POST, so the browser sends `Origin`, which the API's CSRF check
// needs (also on /sign-out; a form navigation is not a substitute).
import type { AuthFailure } from './auth-errors';

export type AuthResult<T = unknown> = ({ ok: true } & T) | ({ ok: false } & AuthFailure);

async function post<T>(path: string, body: object): Promise<AuthResult<{ data: T }>> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, status: 0 }; // network failure
  }
  const json = (await response.json().catch(() => null)) as (T & { code?: string }) | null;
  if (!response.ok) return { ok: false, status: response.status, code: json?.code };
  return { ok: true, data: json as T };
}

/** Always answers success for a valid address (the API never tells whether it has an account). */
export const sendCode = (email: string) => post('/email-otp/send-verification-otp', { email, type: 'sign-in' });

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
