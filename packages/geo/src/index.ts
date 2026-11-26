import rows from './districts.json' with { type: 'json' };

/**
 * A district of Peru. `ubigeo` is the INEI code; `lat`/`lng` is the district capital point (not a
 * centroid), null when the source has none. One exception: `130112` Alto Trujillo has the centroid
 * of its INEI 2025 polygon (no INEI capital point found; scripts/build-districts.mjs).
 */
export type District = { ubigeo: string; name: string; province: string; department: string; lat: number | null; lng: number | null };
export type Point = { lat: number; lng: number };

type Row = [string, string, string, string, number | null, number | null];

export const DISTRICTS: readonly District[] = (rows as Row[]).map(([ubigeo, name, province, department, lat, lng]) => ({
  ubigeo,
  name,
  province,
  department,
  lat,
  lng,
}));

const byUbigeo = new Map(DISTRICTS.map((d) => [d.ubigeo, d]));

/** Every valid code, for the API's `@IsIn`. */
export const UBIGEOS: readonly string[] = [...byUbigeo.keys()];

export const districtByUbigeo = (ubigeo: string): District | undefined => byUbigeo.get(ubigeo);

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const index = DISTRICTS.map((d) => ({ d, name: fold(d.name), all: fold(`${d.name} ${d.province} ${d.department}`) }));

/**
 * The districts whose "district province department" holds every word of the query, accent- and
 * case-insensitive: names that start with the query first, then names that contain it, then the rest.
 */
export function searchDistricts(query: string, limit = 8): District[] {
  const q = fold(query).trim();
  const words = q.split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return [];
  const rank = (name: string) => (name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2);
  return index
    .filter(({ all }) => words.every((w) => all.includes(w)))
    .map((entry) => ({ entry, rank: rank(entry.name) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ entry }) => entry.d);
}

const located = DISTRICTS.filter((d): d is District & Point => d.lat !== null && d.lng !== null);

/**
 * The district whose capital point is nearest (shortcut: capital point, not point-in-polygon; a
 * border trail may get the neighbour district and the rider corrects it). Districts without a
 * capital point are never returned.
 */
export function nearestDistrict({ lat, lng }: Point): District | undefined {
  const k = Math.cos((lat * Math.PI) / 180);
  let best: District | undefined;
  let bestD = Infinity;
  for (const d of located) {
    const dist = (d.lat - lat) ** 2 + ((d.lng - lng) * k) ** 2;
    if (dist < bestD) [best, bestD] = [d, dist];
  }
  return best;
}
