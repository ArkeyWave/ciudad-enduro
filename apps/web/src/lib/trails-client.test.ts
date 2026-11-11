import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from './auth-errors';
import { trailErrorMessage, updateTrail, uploadTrail } from './trails-client';

describe('trailErrorMessage', () => {
  it('maps an API code to its message, before the status', () => {
    expect(trailErrorMessage({ status: 400, code: 'GPX_MULTI_SEGMENT' })).toBe(
      'El GPX tiene más de un tramo. Sube un solo recorrido continuo.',
    );
    expect(trailErrorMessage({ status: 409, code: 'GPX_DUPLICATE', slug: 'cerro' })).toBe('Este GPX ya está subido.');
    // 413 also has a status message: the code must still win.
    expect(trailErrorMessage({ status: 413, code: 'GPX_TOO_LARGE' })).toBe('El GPX tiene demasiados puntos.');
  });

  it('maps a file over the multipart limit (413, no code) to the size message', () => {
    expect(trailErrorMessage({ status: 413 })).toBe('El archivo pesa más de 10 MB.');
  });

  it.each(['toString', 'UNKNOWN'])('falls back to the status for the unknown code %s', (code) => {
    expect(trailErrorMessage({ status: 400, code })).toBe(MESSAGES.generic);
    expect(trailErrorMessage({ status: 401, code })).toBe('Tu sesión venció. Ingresa de nuevo.');
  });

  it('maps the pending limit (429 TOO_MANY_PENDING) to its message, not the generic one', () => {
    expect(trailErrorMessage({ status: 429, code: 'TOO_MANY_PENDING' })).toBe('Tienes 3 rutas en revisión. Espera la aprobación.');
    expect(trailErrorMessage({ status: 429 })).toBe(MESSAGES.generic);
  });

  it('shows the generic message for a network failure', () => {
    expect(trailErrorMessage({ status: 0 })).toBe(MESSAGES.generic);
  });
});

describe('updateTrail', () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: string) =>
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status })));

  it('is ok with the trail for a 2xx JSON body', async () => {
    answer(200, JSON.stringify({ slug: 'cerro' }));
    expect(await updateTrail('cerro', { status: 'published' })).toEqual({ ok: true, trail: { slug: 'cerro' } });
  });

  it('reads a 409 GPX_DUPLICATE without a slug as the duplicate, with no slug', async () => {
    answer(409, JSON.stringify({ code: 'GPX_DUPLICATE' }));
    const result = await uploadTrail(new FormData());
    expect(result).toEqual({ ok: false, status: 409, code: 'GPX_DUPLICATE', slug: undefined });
    expect(trailErrorMessage(result as { status: number; code?: string })).toBe('Este GPX ya está subido.');
  });

  it('keeps the slug of a 409 that sends one', async () => {
    answer(409, JSON.stringify({ code: 'GPX_DUPLICATE', slug: 'cerro' }));
    expect(await uploadTrail(new FormData())).toEqual({ ok: false, status: 409, code: 'GPX_DUPLICATE', slug: 'cerro' });
  });

  it('fails for a 2xx body that is not JSON (a proxy page, not the trail)', async () => {
    answer(200, '<html>proxy</html>');
    expect(await updateTrail('cerro', { status: 'published' })).toEqual({ ok: false, status: 200 });
  });
});
