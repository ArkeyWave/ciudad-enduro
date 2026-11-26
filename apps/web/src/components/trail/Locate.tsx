'use client';

import L from 'leaflet';
import { useEffect, useRef, type RefObject } from 'react';
import type { useGeolocation } from '../../lib/geolocation';
import { Icon } from '../Icon';
import { CYAN } from './tiles';

type Geo = ReturnType<typeof useGeolocation>;
const FIX_ZOOM = 17;

/**
 * The device position on a map (plan §10 L3-5, A11): a cyan dot with its accuracy circle that
 * follows each fix and goes when the fix goes (a hidden page drops it, `useGeolocation`). With
 * `centre`, the map centres once on the first fix of each watch. Returns the chip's action:
 * re-centre on the fix and start the watch.
 */
export function useHere(map: RefObject<L.Map | null>, geo: Geo, centre: boolean): () => void {
  const fix = geo.fix;
  const centred = useRef(!centre);

  useEffect(() => {
    const m = map.current;
    if (!m || !fix) return;
    const at: L.LatLngTuple = [fix.lat, fix.lng];
    // Not interactive, so a tap on the dot still reaches the map.
    const layer = L.layerGroup([
      L.circle(at, { className: 'fix-accuracy', radius: fix.accuracy, color: CYAN, weight: 1, fillOpacity: 0.12, interactive: false }),
      L.circleMarker(at, { className: 'fix-dot', radius: 7, color: '#F5F5F5', weight: 2, fillColor: CYAN, fillOpacity: 1, interactive: false }),
    ]).addTo(m);
    if (!centred.current) {
      centred.current = true;
      m.setView(at, FIX_ZOOM);
    }
    return () => {
      layer.remove();
    };
  }, [map, fix]);

  return () => {
    if (fix) map.current?.setView([fix.lat, fix.lng], FIX_ZOOM);
    // A new watch (first tap, or after a denial) centres again on its first fix.
    if (centre && (geo.status === 'idle' || geo.status === 'denied' || geo.status === 'unavailable')) centred.current = false;
    geo.start();
  };
}

/** "Mi ubicación": no pressed state; the state is text in a live region (A11). */
export function LocateChip({ geo, onClick }: { geo: Geo; onClick: () => void }) {
  return (
    <>
      <button type="button" className={geo.status === 'active' ? 'chip located' : 'chip'} onClick={onClick} aria-label="Centrar en mi ubicación">
        <span className={geo.status === 'searching' ? 'spin' : undefined}>
          <Icon name={geo.status === 'searching' ? 'gps' : 'location'} size={18} />
        </span>
        Mi ubicación
      </button>
      <span aria-live="polite" className="chip-state" data-testid="locate-state">
        {geo.status === 'searching' ? 'Buscando…' : geo.fix ? `±${Math.round(geo.fix.accuracy)} m` : ''}
      </span>
    </>
  );
}
