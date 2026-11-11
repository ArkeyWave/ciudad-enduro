'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import type { Coordinates, Difficulty } from 'api-client';
import { formatKm, formatM } from '../../lib/profile';
import { EXPLORE_MAP_HEIGHT } from './map-size';
import { baseMap, DIFFICULTY_COLOURS } from './tiles';
import { DifficultyPill } from './TrailStats';

/** Only what the map shows: no profile in the client payload. */
export interface MapTrail {
  slug: string;
  name: string;
  difficulty: Difficulty;
  start: Coordinates;
  distanceM: number | null;
  elevationGainM: number | null;
}

/** One pin per trail start. A pin selects its trail; the mini-card link is the keyboard target. */
export default function ExploreMap({ trails }: { trails: MapTrail[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const map = baseMap(container.current);
    const points = trails.map((trail, index) => {
      const point: L.LatLngTuple = [trail.start.lat, trail.start.lng];
      L.circleMarker(point, {
        className: 'trail-pin',
        radius: 10,
        color: '#0A0A0A',
        weight: 2,
        fillColor: DIFFICULTY_COLOURS[trail.difficulty],
        fillOpacity: 1,
      })
        .on('click', () => setSelected(index))
        .addTo(map);
      return point;
    });
    if (points.length === 1) map.setView(points[0] as L.LatLngTuple, 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 });
    return () => {
      map.remove();
    };
  }, [trails]);

  const trail = trails[selected] as MapTrail;
  return (
    <>
      <div
        ref={container}
        role="region"
        aria-label="Mapa de senderos"
        data-testid="explore-map"
        className="map-box rounded"
        style={{ height: EXPLORE_MAP_HEIGHT }}
      />
      <a href={`/rutas/${trail.slug}`} className="mini-card" data-testid="mini-card">
        <DifficultyPill difficulty={trail.difficulty} />
        <span className="swipe-title">{trail.name}</span>
        <span className="mini-stats">
          {trail.distanceM !== null && <span>{formatKm(trail.distanceM)}</span>}
          {trail.elevationGainM !== null && <span>{formatM(trail.elevationGainM)}</span>}
        </span>
      </a>
    </>
  );
}
