import { describe, expect, it } from 'vitest';
import { MESSAGES } from './auth-errors';
import { trailErrorMessage } from './trails-client';

describe('trailErrorMessage', () => {
  it('maps an API code to its message, before the status', () => {
    expect(trailErrorMessage({ status: 400, code: 'GPX_MULTI_SEGMENT' })).toBe(
      'El GPX tiene más de un tramo. Sube un solo recorrido continuo.',
    );
    expect(trailErrorMessage({ status: 409, code: 'GPX_DUPLICATE', slug: 'cerro' })).toBe('Este GPX ya está subido.');
  });

  it('maps a file over the multipart limit (413, no code) to the size message', () => {
    expect(trailErrorMessage({ status: 413 })).toBe('El archivo pesa más de 10 MB.');
  });

  it.each(['toString', 'UNKNOWN'])('falls back to the status for the unknown code %s', (code) => {
    expect(trailErrorMessage({ status: 400, code })).toBe(MESSAGES.generic);
    expect(trailErrorMessage({ status: 401, code })).toBe('Tu sesión venció. Ingresa de nuevo.');
  });

  it('shows the generic message for a network failure', () => {
    expect(trailErrorMessage({ status: 0 })).toBe(MESSAGES.generic);
  });
});
