import type { ProfilePoint } from '../../db/schema/index.js';
import type { LngLat } from '../../db/types/geo.js';
import { GpxError } from './parse-gpx.js';

const EARTH_RADIUS_M = 6_371_008.8;
/** The calibration knob (plan D6, D11): a change below this many metres is noise. */
export const ELEVATION_THRESHOLD_M = 5;
const PROFILE_BUCKETS = 296;
const INT4_MAX = 2_147_483_647;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The one distance helper: summary and profile x axis both come from it. */
export function haversineM(a: LngLat, b: LngLat): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Extrema hysteresis (plan M11): a leg counts from one confirmed extremum to the next, and an
 * extremum is confirmed once the track turns back by T. Every counted leg is at least T; a final
 * tail smaller than T after the last candidate is ignored.
 */
export function elevationChange(eles: number[], threshold = ELEVATION_THRESHOLD_M): { gainM: number; lossM: number } {
  let gainM = 0;
  let lossM = 0;
  let ref = eles[0] ?? 0; // last confirmed extremum
  let cand = ref; // candidate extremum
  let dir: 'none' | 'up' | 'down' = 'none';
  for (const e of eles.slice(1)) {
    if (dir === 'none') {
      if (e - ref >= threshold) [dir, cand] = ['up', e];
      else if (ref - e >= threshold) [dir, cand] = ['down', e];
    } else if (dir === 'up') {
      if (e > cand) cand = e;
      else if (cand - e >= threshold) {
        gainM += cand - ref;
        [ref, dir, cand] = [cand, 'down', e];
      }
    } else if (e < cand) cand = e;
    else if (e - cand >= threshold) {
      lossM += ref - cand;
      [ref, dir, cand] = [cand, 'up', e];
    }
  }
  if (dir === 'up') gainM += cand - ref;
  else if (dir === 'down') lossM += ref - cand;
  return { gainM, lossM };
}

/** ≤ 300 points: the last point of each equal-distance bucket, plus the first, last, min and max. */
export function elevationProfile(cum: number[], eles: number[]): ProfilePoint[] {
  const total = cum.at(-1) ?? 0;
  const keep = new Set<number>([0, eles.length - 1]);
  let min = 0;
  let max = 0;
  const lastInBucket = new Map<number, number>();
  eles.forEach((e, i) => {
    if (e < eles[min]!) min = i;
    if (e > eles[max]!) max = i;
    lastInBucket.set(total > 0 ? Math.min(PROFILE_BUCKETS - 1, Math.floor((cum[i]! / total) * PROFILE_BUCKETS)) : 0, i);
  });
  keep.add(min).add(max);
  for (const i of lastInBucket.values()) keep.add(i);
  return [...keep].sort((a, b) => a - b).map((i) => [Math.round(cum[i]!), Math.round(eles[i]! * 10) / 10]);
}

function int4(value: number): number {
  const n = Math.round(value);
  if (n > INT4_MAX) throw new GpxError('GPX_INVALID');
  return n;
}

export type TrackMetrics = {
  distanceM: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  elevationProfile: ProfilePoint[] | null;
};

export function trackMetrics(points: LngLat[], elevations: number[] | null): TrackMetrics {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  const distanceM = int4(cum.at(-1)!);
  if (distanceM === 0) throw new GpxError('GPX_EMPTY');
  if (!elevations) return { distanceM, elevationGainM: null, elevationLossM: null, elevationProfile: null };
  const { gainM, lossM } = elevationChange(elevations);
  return { distanceM, elevationGainM: int4(gainM), elevationLossM: int4(lossM), elevationProfile: elevationProfile(cum, elevations) };
}
