const round = (n: number) => Math.round(n * 10) / 10;

/**
 * SVG polyline points for an elevation profile (`[distance_m, ele_m]` pairs) in a width × height box,
 * y down. A flat profile draws a flat line across the middle, and so does a profile with no distance.
 */
export function profilePolyline(profile: number[][], width: number, height: number): string {
  const mid = height / 2;
  const maxD = Math.max(...profile.map(([d = 0]) => d));
  if (profile.length < 2 || !(maxD > 0)) return `0,${mid} ${width},${mid}`;
  const eles = profile.map(([, e = 0]) => e);
  const minE = Math.min(...eles);
  const span = Math.max(...eles) - minE;
  return profile
    .map(([d = 0, e = 0]) => `${round((d / maxD) * width)},${round(span > 0 ? height - ((e - minE) / span) * height : mid)}`)
    .join(' ');
}

const number = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });

export const formatM = (meters: number) => `${number.format(meters)} m`;
/** Under 1 km in metres ("715 m"), from 1 km in kilometres ("4.2 km"). */
export const formatDistance = (meters: number) =>
  meters < 1000 ? `${Math.round(meters)} m` : `${number.format(meters / 1000)} km`;

/**
 * `count` points of the profile, evenly spaced by index, first and last kept; a shorter profile as is.
 * For the card's mini profile.
 */
export function sampleProfile(profile: number[][], count: number): number[][] {
  if (profile.length <= count) return profile;
  return Array.from({ length: count }, (_, i) => profile[Math.round((i * (profile.length - 1)) / (count - 1))] as number[]);
}

/** The Desnivel a trail shows: a Descenso shows its loss as a negative number, every other type its gain. */
export function shownDrop(type: string, gainM: number | null | undefined, lossM: number | null | undefined): number | null {
  if (type === 'descenso') return lossM == null ? null : -lossM;
  return gainM ?? null;
}

/** Mean grade in degrees, atan(|drop| / distance), or null when it cannot be computed. */
export function gradeDeg(dropM: number | null, distanceM: number | null | undefined): number | null {
  if (dropM == null || distanceM == null || distanceM === 0) return null;
  return (Math.atan(Math.abs(dropM) / distanceM) * 180) / Math.PI;
}

export const formatDrop = (meters: number) => (meters < 0 ? `−${formatM(-meters)}` : formatM(meters));
export const formatGrade = (deg: number) => `${number.format(deg)}°`;
