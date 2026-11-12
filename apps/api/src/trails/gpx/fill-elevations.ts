import type { LngLat } from '../../db/types/geo.js';
import { cumulativeM } from './metrics.js';
import { ELE_MAX, ELE_MIN } from './parse-gpx.js';

/** Sample spacing along the line (plan §8 G5). */
export const SAMPLE_SPACING_M = 10;
/**
 * ponytail: at most 2 000 samples (20 calls) per trail, far below the 100 000-point GPX cap: the
 * Copernicus GLO-90 cells are 90 m, so above 20 km the spacing grows (≤ 50 m up to 100 km) with no
 * loss. Raise it if the elevation source gets finer.
 */
export const MAX_SAMPLES = 2000;
/** Open-Meteo answers at most 100 coordinates per call. */
const BATCH = 100;
export const ELEVATION_TIMEOUT_MS = 5000;

/** Evenly spaced points along the line, first and last kept, ≤ SAMPLE_SPACING_M apart, with their distance from the start. */
export function samplesAlong(points: LngLat[]): { cum: number[]; points: LngLat[] } {
  const along = cumulativeM(points);
  const total = along.at(-1)!;
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(total / SAMPLE_SPACING_M) + 1));
  const cum = Array.from({ length: n }, (_, i) => (total * i) / (n - 1));
  let seg = 0;
  const samples = cum.map((d) => {
    while (seg < points.length - 2 && along[seg + 1]! < d) seg += 1;
    const [a, b] = [points[seg]!, points[seg + 1]!];
    const length = along[seg + 1]! - along[seg]!;
    const f = length > 0 ? Math.min(1, (d - along[seg]!) / length) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  });
  return { cum, points: samples };
}

async function fetchBatch(url: string, points: LngLat[], signal: AbortSignal): Promise<number[]> {
  const request = new URL(url);
  request.searchParams.set('latitude', points.map((p) => p.lat.toFixed(6)).join(','));
  request.searchParams.set('longitude', points.map((p) => p.lng.toFixed(6)).join(','));
  const response = await fetch(request, { signal });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const { elevation } = (await response.json()) as { elevation?: unknown };
  const valid =
    Array.isArray(elevation) &&
    elevation.length === points.length &&
    elevation.every((e) => typeof e === 'number' && Number.isFinite(e) && e >= ELE_MIN && e <= ELE_MAX);
  if (!valid) throw new Error('bad_answer');
  return elevation as number[];
}

/**
 * Elevations from an Open-Meteo-compatible API for samples along the line, or the reason of a failure
 * (`http_<status>`, `bad_answer`, or the error name such as `TimeoutError`; never the URL): the caller
 * then stores the trail without them.
 */
export async function fillElevations(
  points: LngLat[],
  url: string,
  timeoutMs = ELEVATION_TIMEOUT_MS,
): Promise<{ cum: number[]; elevations: number[] } | { reason: string }> {
  const { cum, points: samples } = samplesAlong(points);
  const signal = AbortSignal.timeout(timeoutMs);
  const batches = Array.from({ length: Math.ceil(samples.length / BATCH) }, (_, i) => samples.slice(i * BATCH, (i + 1) * BATCH));
  try {
    const elevations = (await Promise.all(batches.map((batch) => fetchBatch(url, batch, signal)))).flat();
    return { cum, elevations };
  } catch (error) {
    // A plain Error carries one of our codes; any other error (fetch, abort, JSON) only its name.
    const reason = error instanceof Error ? (error.constructor === Error ? error.message : error.name) : 'unknown';
    return { reason };
  }
}
