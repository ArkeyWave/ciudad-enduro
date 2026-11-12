import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillElevations, MAX_SAMPLES, samplesAlong } from '../src/trails/gpx/fill-elevations.js';
import { haversineM } from '../src/trails/gpx/metrics.js';

// Pure checks of the G5 sampling and of the answer check; the integration spec covers the service.

const A = { lat: -8.11, lng: -79.03 };
const B = { lat: -8.11004, lng: -79.03 }; // ~4 m
const C = { lat: -8.1125, lng: -79.0315 }; // ~320 m
const D = { lat: -8.1128, lng: -79.0315 }; // ~33 m
const gaps = (points: { lat: number; lng: number }[]) => points.slice(1).map((p, i) => haversineM(points[i]!, p));

describe('samplesAlong', () => {
  it('walks uneven legs and a repeated point: no gap above 10 m, the first and last points exact', () => {
    const { cum, points } = samplesAlong([A, B, B, C, D]);
    expect(Math.max(...gaps(points))).toBeLessThanOrEqual(10 + 1e-6);
    expect(points[0]).toEqual(A);
    expect(points.at(-1)!.lat).toBeCloseTo(D.lat, 12);
    expect(points.at(-1)!.lng).toBeCloseTo(D.lng, 12);
    expect(cum).toHaveLength(points.length);
    expect(cum.at(-1)).toBeCloseTo(gaps([A, B, C, D]).reduce((a, b) => a + b), 6);
  });

  it('stops at MAX_SAMPLES on a long line (~60 km)', () => {
    const { points } = samplesAlong([A, { lat: A.lat - 0.54, lng: A.lng }]);
    expect(points).toHaveLength(MAX_SAMPLES);
  });
});

describe('fillElevations', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A fetch that answers every call with `value` for each coordinate it was sent. */
  const answer = (value: unknown, status = 200) =>
    vi.stubGlobal('fetch', (url: URL) => {
      const n = url.searchParams.get('latitude')!.split(',').length;
      return Promise.resolve(new Response(JSON.stringify({ elevation: Array.from({ length: n }, () => value) }), { status }));
    });

  it('gives one elevation per sample for a valid answer', async () => {
    answer(120.5);
    const result = await fillElevations([A, C], 'http://stub/v1/elevation');
    expect(result).toMatchObject({ elevations: expect.arrayContaining([120.5]) as unknown });
    if (!('elevations' in result)) throw new Error('no elevations');
    expect(result.elevations).toHaveLength(result.cum.length);
  });

  it.each([null, 9999, '100'])('refuses an answer with %j (bad_answer)', async (value) => {
    answer(value);
    expect(await fillElevations([A, C], 'http://stub/v1/elevation')).toEqual({ reason: 'bad_answer' });
  });

  it('names the failure: an HTTP status, or the error name for a timeout; never the URL', async () => {
    answer(100, 503);
    expect(await fillElevations([A, C], 'http://secret-host/v1/elevation')).toEqual({ reason: 'http_503' });
    vi.stubGlobal('fetch', (_url: URL, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason as Error))));
    expect(await fillElevations([A, C], 'http://secret-host/v1/elevation', 20)).toEqual({ reason: 'TimeoutError' });
  });
});
