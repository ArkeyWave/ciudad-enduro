// The OSM tile policy: this exact URL and a visible, linked attribution. No Leaflet here, so the
// server-rendered card slider can use it too.
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

const ZOOM = 14;

/**
 * The 2×2 tiles at zoom 14 around a point, in reading order, and the point's place in the mosaic
 * (0…1 from the left and from the top; always within 0.25…0.75).
 */
export function tileMosaic({ lat, lng }: { lat: number; lng: number }) {
  const n = 2 ** ZOOM;
  const tx = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const ty = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n;
  const x0 = Math.round(tx) - 1;
  const y0 = Math.round(ty) - 1;
  const url = (x: number, y: number) =>
    OSM_TILES.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
  return {
    tiles: [url(x0, y0), url(x0 + 1, y0), url(x0, y0 + 1), url(x0 + 1, y0 + 1)],
    x: (tx - x0) / 2,
    y: (ty - y0) / 2,
  };
}
