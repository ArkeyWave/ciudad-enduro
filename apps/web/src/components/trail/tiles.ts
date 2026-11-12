import L from 'leaflet';

// The OSM tile policy: this exact URL and a visible, linked attribution. The dark look is a CSS
// filter on the tile pane (globals.css, plan D11).
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** A Leaflet map with the OSM base layer and the Spanish zoom control at the top right. */
export function baseMap(container: HTMLElement): L.Map {
  const map = L.map(container, { scrollWheelZoom: false, zoomControl: false });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}

// Leaflet SVG paths take colours as attributes, where var() does not resolve.
export const LIME = '#CCFF00';
export const CYAN = '#00D4FF';
export const DIFFICULTY_COLOURS = { facil: '#00E676', intermedio: '#FFB020', dificil: '#FF5555' } as const;
