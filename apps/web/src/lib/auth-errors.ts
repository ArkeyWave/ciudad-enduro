// Maps auth API failures to fixed Spanish messages. The API's own message is never shown, and no
// message tells whether an address has an account.

export const MESSAGES = {
  invalidCode: 'Código inválido o vencido.',
  codeLocked: 'Demasiados intentos con este código. Pide un código nuevo.',
  rateLimited: 'Demasiados intentos. Espera un minuto.',
  generic: 'No pudimos completar la solicitud. Intenta de nuevo.',
  accountNotLinked: 'Esta cuenta ingresa con código por correo.',
  googleUnverified: 'Tu correo de Google no está verificado.',
  googleFailed: 'No pudimos ingresar con Google. Intenta de nuevo.',
} as const;

export type AuthFailure = { status: number; code?: string | undefined };

const RATE_LIMITED = 429;

export function sendErrorMessage({ status }: AuthFailure): string {
  return status === RATE_LIMITED ? MESSAGES.rateLimited : MESSAGES.generic;
}

export function verifyErrorMessage({ status, code }: AuthFailure): string {
  if (status === RATE_LIMITED) return MESSAGES.rateLimited;
  // Status 0 is a network failure or timeout: the code was never checked.
  if (status === 0 || status >= 500) return MESSAGES.generic;
  if (code === 'TOO_MANY_ATTEMPTS') return MESSAGES.codeLocked;
  return MESSAGES.invalidCode;
}

/** The `error` query value Better Auth puts on the `errorCallbackURL` after a Google sign-in. */
export function googleErrorMessage(error: string | null): string | null {
  if (error === null) return null;
  if (error === 'account_not_linked') return MESSAGES.accountNotLinked;
  if (error === 'google_email_unverified') return MESSAGES.googleUnverified;
  return MESSAGES.googleFailed;
}
