'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { useGeolocation } from '../../lib/geolocation';
import type { Point } from '../../lib/tracer';
import { LocateChip, useHere } from '../trail/Locate';
import { baseMap, LIME } from '../trail/tiles';

const CHIMBOTE: L.LatLngTuple = [-9.0745, -78.5936];

export interface PhotoMapProps {
  /** The named trail's line as `[lng, lat]` pairs (GeoJSON order); the map starts on it. */
  line: number[][] | null;
  geo: ReturnType<typeof useGeolocation>;
  pin: Point | null;
  onPin: (pin: Point) => void;
}

/**
 * Where the photo was taken (plan §10 L3-6, A10): one pin, placed by a tap, a drag or "Poner aquí"
 * (the map centre, for the keyboard). Only these move it: a fix never does.
 */
export default function PhotoMap({ line, geo, pin, onPin }: PhotoMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const place = useRef(onPin);

  useEffect(() => {
    place.current = onPin;
  }, [onPin]);

  useEffect(() => {
    if (!container.current) return;
    // No double-click zoom: a double tap places the pin, never zooms under it.
    const m = baseMap(container.current, { doubleClickZoom: false });
    map.current = m;
    if (line) {
      const layer = L.polyline(
        line.map(([lng = 0, lat = 0]): L.LatLngTuple => [lat, lng]),
        { className: 'trail-path', color: LIME, weight: 4, interactive: false },
      ).addTo(m);
      m.fitBounds(layer.getBounds(), { padding: [24, 24] });
    } else {
      m.setView(CHIMBOTE, 13);
    }
    m.on('click', (event) => place.current({ lat: event.latlng.lat, lng: event.latlng.lng }));
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, [line]);

  useEffect(() => {
    const m = map.current;
    if (!m || !pin) return;
    if (marker.current) {
      marker.current.setLatLng([pin.lat, pin.lng]);
      return;
    }
    // Not keyboard-focusable: "Poner aquí" is the keyboard way to place it.
    const placed = L.marker([pin.lat, pin.lng], { draggable: true, keyboard: false, icon: L.divIcon({ className: 'photo-pin', iconSize: [28, 28] }) }).addTo(m);
    placed.on('dragend', () => {
      const { lat, lng } = placed.getLatLng();
      place.current({ lat, lng });
    });
    marker.current = placed;
  }, [pin]);

  // With a trail line the map stays on it; without one it centres on the first fix.
  const locate = useHere(map, geo, line === null);
  const putHere = () => {
    const centre = map.current?.getCenter();
    if (centre) onPin({ lat: centre.lat, lng: centre.lng });
  };

  return (
    <>
      <div ref={container} role="region" aria-label="Mapa para marcar dónde tomaste la foto" data-testid="photo-map" className="map-box rounded tracer-map" />
      <div className="tracer-controls">
        <LocateChip geo={geo} onClick={locate} />
        <button type="button" className="chip" onClick={putHere}>
          Poner aquí
        </button>
      </div>
    </>
  );
}
