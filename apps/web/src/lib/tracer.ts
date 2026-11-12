// The pure parts of the GPS tracer on /rutas/nueva (plan §8 G3, G4).

export type Point = { lat: number; lng: number };
export type Fix = Point & { accuracy: number };

/** "Marcar punto" needs a fix this good or better (plan §8 G3). */
export const MAX_ACCURACY_M = 30;

export const canMark = (fix: Fix | null): fix is Fix => fix !== null && fix.accuracy <= MAX_ACCURACY_M;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;
const haversineM = (a: Point, b: Point) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** The live distance of the marked line. */
export const pathLengthM = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + haversineM(points[i] as Point, p), 0);

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] as string);

/** A GPX 1.1 document of one track: `<trkpt>` without `<ele>` (the API fills the elevations, G5). */
export function toGpx(points: Point[], name: string): string {
  if (points.length < 2) throw new Error('A route needs at least 2 points');
  const trkpts = points.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"/>`).join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Ciudad Enduro" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `<metadata><name>${escapeXml(name)}</name></metadata>\n` +
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
