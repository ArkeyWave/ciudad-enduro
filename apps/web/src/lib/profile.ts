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

export const formatKm = (meters: number) => `${number.format(meters / 1000)} km`;
export const formatM = (meters: number) => `${number.format(meters)} m`;

/**
 * `count` points of the profile, evenly spaced by index, first and last kept; a shorter profile as is.
 * For the card's mini profile.
 */
export function sampleProfile(profile: number[][], count: number): number[][] {
  if (profile.length <= count) return profile;
  return Array.from({ length: count }, (_, i) => profile[Math.round((i * (profile.length - 1)) / (count - 1))] as number[]);
}

/** Pendiente in % (prototype formula: gain / distance), or null when it cannot be computed. */
export function slopePct(gainM: number | null | undefined, distanceM: number | null | undefined): number | null {
  if (gainM == null || distanceM == null || distanceM === 0) return null;
  return Math.round((gainM / distanceM) * 100);
}
