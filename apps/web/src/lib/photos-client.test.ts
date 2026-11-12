import { describe, expect, it } from 'vitest';
import { MESSAGES } from './auth-errors';
import { photoErrorMessage, positionFields } from './photos-client';

describe('photoErrorMessage', () => {
  it('maps the API codes of plan §9 to their Spanish messages, before the status', () => {
    expect(photoErrorMessage({ status: 422, code: 'NO_TRAIL_NEARBY' })).toBe('No hay un sendero a menos de 50 m.');
    expect(photoErrorMessage({ status: 400, code: 'NO_POSITION' })).toBe('No sabemos dónde tomaste la foto. Activa tu ubicación.');
    expect(photoErrorMessage({ status: 429, code: 'TOO_MANY_PENDING' })).toBe('Tienes 20 vistas en revisión. Espera la aprobación.');
    // 413 also has a status message: the code must still win.
    expect(photoErrorMessage({ status: 413, code: 'PHOTO_TOO_LARGE' })).toBe('La foto tiene demasiados píxeles.');
  });

  it('maps a file over the multipart limit (413, no code) and a wrong type (415) by status', () => {
    expect(photoErrorMessage({ status: 413 })).toBe('La foto pesa más de 10 MB.');
    expect(photoErrorMessage({ status: 415 })).toBe('La foto debe ser JPEG, PNG o WebP.');
  });

  it.each(['toString', 'UNKNOWN'])('falls back to the status for the unknown code %s', (code) => {
    expect(photoErrorMessage({ status: 400, code })).toBe(MESSAGES.generic);
    expect(photoErrorMessage({ status: 403, code })).toBe('No tienes permiso para esta acción.');
  });
});

describe('positionFields (the tracer gate, plan §9 V2)', () => {
  const now = 1_000_000;
  const fix = { lat: -9.0925, lng: -78.52, accuracy: 30, at: now - 10_000 };

  it('sends a fix of 30 m that is 10 s old', () => {
    expect(positionFields(fix, now)).toEqual({ lat: '-9.0925', lng: '-78.52' });
  });

  it('sends nothing for no fix, a worse accuracy or an older fix', () => {
    expect(positionFields(null, now)).toBeNull();
    expect(positionFields({ ...fix, accuracy: 31 }, now)).toBeNull();
    expect(positionFields({ ...fix, at: now - 10_001 }, now)).toBeNull();
  });
});
