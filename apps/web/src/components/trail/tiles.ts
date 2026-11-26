import L from 'leaflet';
import { OSM_COPYRIGHT_URL, OSM_TILES } from '../../lib/osm';

// The dark look is a CSS filter on the tile pane (globals.css, plan D11).
const ATTRIBUTION = `© <a href="${OSM_COPYRIGHT_URL}">OpenStreetMap</a>`;

/** Open-Meteo elevation data is CC BY 4.0: credited on a map whose trail shows a profile (plan §8 G5). */
export const ELEVATION_CREDIT = 'Elevación: <a href="https://open-meteo.com/">Open-Meteo</a> (Copernicus GLO-90)';

/** A Leaflet map with the OSM base layer and the Spanish zoom control at the top right. */
export function baseMap(container: HTMLElement, options: L.MapOptions = {}): L.Map {
  const map = L.map(container, { scrollWheelZoom: false, zoomControl: false, ...options });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}

// Leaflet SVG paths take colours as attributes, where var() does not resolve.
export const LIME = '#CCFF00';
export const CYAN = '#00D4FF';
export const DIFFICULTY_COLOURS = { facil: '#00E676', intermedio: '#FFB020', dificil: '#FF5555' } as const;
