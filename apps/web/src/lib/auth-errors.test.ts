import { describe, expect, it } from 'vitest';
import { MESSAGES, googleErrorMessage, sendErrorMessage, verifyErrorMessage } from './auth-errors';

describe('verifyErrorMessage', () => {
  it.each([
    ['INVALID_OTP', 400],
    ['OTP_EXPIRED', 400],
    [undefined, 400],
    ['SOMETHING_NEW', 400],
  ])('maps %s (%i) to the invalid-code message', (code, status) => {
    expect(verifyErrorMessage({ status, code })).toBe('Código inválido o vencido.');
  });

  it('never shows the raw API message', () => {
    expect(verifyErrorMessage({ status: 400, code: 'INVALID_OTP' })).not.toMatch(/OTP|Invalid/i);
  });

  it.each([0, 500, 503])('maps status %i (network failure, server error) to the generic message', (status) => {
    expect(verifyErrorMessage({ status, code: 'INVALID_OTP' })).toBe(MESSAGES.generic);
  });

  it('maps 429 to the rate-limit message', () => {
    expect(verifyErrorMessage({ status: 429 })).toBe('Demasiados intentos. Espera un minuto.');
  });

  it('gives TOO_MANY_ATTEMPTS its own message, not the 429 one', () => {
    const message = verifyErrorMessage({ status: 403, code: 'TOO_MANY_ATTEMPTS' });
    expect(message).toBe(MESSAGES.codeLocked);
    expect(message).not.toBe(MESSAGES.rateLimited);
    expect(message).not.toBe(MESSAGES.invalidCode);
  });
});

describe('sendErrorMessage', () => {
  it('maps 429 to the rate-limit message', () => {
    expect(sendErrorMessage({ status: 429 })).toBe('Demasiados intentos. Espera un minuto.');
  });

  it('maps any other failure to a generic message', () => {
    expect(sendErrorMessage({ status: 500 })).toBe(MESSAGES.generic);
  });
});

describe('googleErrorMessage', () => {
  it('maps account_not_linked to the email-code hint', () => {
    expect(googleErrorMessage('account_not_linked')).toBe('Esta cuenta ingresa con código por correo.');
  });

  it('maps google_email_unverified', () => {
    expect(googleErrorMessage('google_email_unverified')).toBe('Tu correo de Google no está verificado.');
  });

  it.each(['state_mismatch', '<script>', 'toString'])('maps the unknown value %s to a generic message', (value) => {
    expect(googleErrorMessage(value)).toBe(MESSAGES.googleFailed);
  });

  it('shows nothing without an error', () => {
    expect(googleErrorMessage(null)).toBeNull();
  });
});
