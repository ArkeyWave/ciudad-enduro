'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { Coordinates } from 'api-client';
import { MAP_HEIGHT } from './map-size';
import { baseMap, LIME } from './tiles';

export interface TrailMapProps {
  /** The map is built once per trail: a `router.refresh()` gives new prop arrays, not a new trail. */
  slug: string;
  /** `[lng, lat]` pairs (GeoJSON order), or null when the trail has only a start point. */
  path: number[][] | null;
  start: Coordinates;
  end: Coordinates | null;
}

const point = (c: Coordinates): L.LatLngTuple => [c.lat, c.lng];
const dot = (className: string) => ({ className, radius: 6, color: '#0A0A0A', weight: 2, fillColor: LIME, fillOpacity: 1 });

export default function TrailMap({ slug, path, start, end }: TrailMapProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = baseMap(container.current);
    const line = path && path.length >= 2 ? path.map(([lng = 0, lat = 0]): L.LatLngTuple => [lat, lng]) : null;
    if (line) {
      const layer = L.polyline(line, { className: 'trail-path', color: LIME, weight: 4 }).addTo(map);
      map.fitBounds(layer.getBounds(), { padding: [16, 16] });
    } else {
      map.setView(point(start), 14);
    }
    L.circleMarker(point(start), dot('trail-start')).addTo(map);
    if (line && end) L.circleMarker(point(end), dot('trail-end')).addTo(map);
    return () => {
      map.remove();
    };
  }, [slug]); // the geometry of this render; a refresh of the same trail keeps the map

  return (
    <div
      ref={container}
      role="region"
      aria-label="Mapa del sendero"
      data-testid="trail-map"
      className="map-box"
      style={{ height: MAP_HEIGHT }}
    />
  );
}
