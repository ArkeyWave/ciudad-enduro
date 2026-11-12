'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import type { Coordinates, Difficulty } from 'api-client';
import { formatDistance, formatDrop, shownDrop } from '../../lib/profile';
import { EXPLORE_MAP_HEIGHT } from './map-size';
import { baseMap, DIFFICULTY_COLOURS, LIME } from './tiles';
import { DifficultyPill } from './TrailStats';

/** Only what the map shows: no profile in the client payload. */
export interface MapTrail {
  slug: string;
  name: string;
  difficulty: Difficulty;
  type: string;
  start: Coordinates;
  distanceM: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
}

/** One pin per trail start. A pin selects its trail; the mini-card link is the keyboard target. */
export default function ExploreMap({ trails }: { trails: MapTrail[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const pins = useRef<L.CircleMarker[]>([]);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = baseMap(container.current);
    mapRef.current = map;
    const points = trails.map((trail): L.LatLngTuple => [trail.start.lat, trail.start.lng]);
    if (points.length === 1) map.setView(points[0] as L.LatLngTuple, 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 });
    pins.current = trails.map((trail, index) =>
      L.circleMarker(points[index] as L.LatLngTuple, {
        className: 'trail-pin',
        radius: 10,
        color: '#0A0A0A',
        weight: 2,
        fillColor: DIFFICULTY_COLOURS[trail.difficulty],
        fillOpacity: 1,
      })
        .on('click', () => setSelected(index))
        .addTo(map),
    );
    return () => {
      map.remove();
    };
  }, [trails]);

  // The selected pin: larger, with a lime ring. Leaflet may add the pins only when the map loads, so
  // the style waits for that too.
  useEffect(() => {
    const apply = () =>
      pins.current.forEach((pin, index) => {
        const on = index === selected;
        pin.setRadius(on ? 14 : 10);
        pin.setStyle({ color: on ? LIME : '#0A0A0A', weight: on ? 3 : 2 });
        pin.getElement()?.classList.toggle('trail-pin-selected', on);
        if (on) pin.bringToFront();
      });
    mapRef.current?.whenReady(apply);
  }, [selected, trails]);

  const trail = trails[selected] as MapTrail;
  const drop = shownDrop(trail.type, trail.elevationGainM, trail.elevationLossM);
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
          {trail.distanceM !== null && <span>{formatDistance(trail.distanceM)}</span>}
          {drop !== null && <span>{formatDrop(drop)}</span>}
        </span>
      </a>
    </>
  );
}
