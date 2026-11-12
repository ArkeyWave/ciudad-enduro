// The pure parts of the GPS tracer on /rutas/nueva (plan §8 G3, G4).

export type Point = { lat: number; lng: number };
/** A GPS fix: `at` is the position's timestamp (ms since the epoch). */
export type Fix = Point & { accuracy: number; at: number };

/** "Marcar punto" needs a fix this good or better (plan §8 G3). */
export const MAX_ACCURACY_M = 30;
/** An older fix is stale: the rider may have moved since (a hidden page gets no updates). */
export const MAX_FIX_AGE_MS = 10_000;

export const canMark = (fix: Fix | null, now: number): fix is Fix =>
  fix !== null && fix.accuracy <= MAX_ACCURACY_M && now - fix.at <= MAX_FIX_AGE_MS;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;
const haversineM = (a: Point, b: Point) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** The live distance of the marked line. */
export const pathLengthM = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + haversineM(points[i] as Point, p), 0);

/**
 * A GPX 1.1 document of one track: `<trkpt>` without `<ele>` (the API fills the elevations, G5). No
 * name: the API takes the name from the form field.
 */
export function toGpx(points: Point[]): string {
  if (points.length < 2) throw new Error('A route needs at least 2 points');
  const trkpts = points.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"/>`).join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Ciudad Enduro" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `<trk><trkseg>\n${trkpts}\n</trkseg></trk>\n</gpx>\n`
  );
}

const isPoint = (value: unknown): value is Point =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Point).lat) &&
  Number.isFinite((value as Point).lng);

/** The points kept in sessionStorage; anything else (missing, corrupt) is an empty route. */
export function readPoints(stored: string | null): Point[] {
  try {
    const value: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(value) && value.every(isPoint) ? value.map(({ lat, lng }) => ({ lat, lng })) : [];
  } catch {
    return [];
  }
}
