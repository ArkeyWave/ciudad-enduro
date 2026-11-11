import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrail } from './api';

const answer = (status: number, body: unknown) =>
  vi.fn<(request: Request) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));

beforeEach(() => vi.stubEnv('API_INTERNAL_URL', 'http://api.test'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getTrail', () => {
  it('returns the trail and forwards the cookie', async () => {
    const fetch = answer(200, { slug: 'cerro' });
    vi.stubGlobal('fetch', fetch);
    expect(await getTrail('cerro', 'session=1')).toEqual({ slug: 'cerro' });
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('http://api.test/api/trails/cerro');
    expect(request.headers.get('cookie')).toBe('session=1');
  });

  it('returns null for an API 404 (the page then answers 404)', async () => {
    vi.stubGlobal('fetch', answer(404, { statusCode: 404, message: 'Not Found' }));
    expect(await getTrail('no-existe', '')).toBeNull();
  });

  it.each([500, 401])('throws for an API %i (the error page, not a 404)', async (status) => {
    vi.stubGlobal('fetch', answer(status, { statusCode: status }));
    await expect(getTrail('cerro', '')).rejects.toThrow(`failed with ${status}`);
  });
});
