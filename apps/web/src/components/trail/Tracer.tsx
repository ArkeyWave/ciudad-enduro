'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { formatDistance } from '../../lib/profile';
import { canMark, pathLengthM, readPoints, toGpx, type Fix, type Point } from '../../lib/tracer';
import { uploadTrail, type TrailFailure } from '../../lib/trails-client';
import { Icon } from '../Icon';
import { baseMap, CYAN, LIME } from './tiles';
import { TrailFailureAlert } from './TrailFailureAlert';
import { TrailFields } from './TrailFields';

/** The marked points survive a reload until the submit (plan §8 G3). */
const STORAGE_KEY = 'ce:tracer-points';
const CHIMBOTE: L.LatLngTuple = [-9.0745, -78.5936];
const FIX_ZOOM = 17;

const stored = () => readPoints(sessionStorage.getItem(STORAGE_KEY));
const latLng = (p: Point): L.LatLngTuple => [p.lat, p.lng];

/**
 * Marcar (plan §8 G3, G4): points from the GPS fix ("Marcar punto", gated on the accuracy) or a tap on
 * the map; on submit a GPX without elevations goes to the same upload as "Importar GPX".
 */
export default function Tracer() {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const route = useRef<L.LayerGroup | null>(null);
  const here = useRef<L.LayerGroup | null>(null);
  const watch = useRef<number | null>(null);
  const centred = useRef(false);
  const [points, setPoints] = useState<Point[]>(stored);
  const [fix, setFix] = useState<Fix | null>(null);
  // The clock of the age gate: ticks while there is a fix, so the button turns off when it goes stale.
  const [now, setNow] = useState(() => Date.now());
  const [noLocation, setNoLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TrailFailure | null>(null);

  useEffect(() => {
    if (!container.current) return;
    // No double-click zoom: a double tap is two points, never a zoom that moves the next tap.
    const m = baseMap(container.current, { doubleClickZoom: false });
    map.current = m;
    route.current = L.layerGroup().addTo(m);
    here.current = L.layerGroup().addTo(m);
    const initial = stored();
    if (initial.length >= 2) m.fitBounds(L.latLngBounds(initial.map(latLng)), { padding: [32, 32] });
    else m.setView(initial[0] ? latLng(initial[0]) : CHIMBOTE, initial[0] ? FIX_ZOOM : 13);
    // A tap adds a point: a rider at home traces a ride without GPS.
    m.on('click', (event) => setPoints((current) => [...current, { lat: event.latlng.lat, lng: event.latlng.lng }]));
    return () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
      m.remove();
    };
  }, []);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(points));
    const layer = route.current;
    if (!layer) return;
    layer.clearLayers();
    if (points.length >= 2) L.polyline(points.map(latLng), { className: 'trail-path', color: LIME, weight: 4 }).addTo(layer);
    for (const p of points) {
      L.circleMarker(latLng(p), { className: 'trace-point', radius: 5, color: '#0A0A0A', weight: 2, fillColor: LIME, fillOpacity: 1 }).addTo(layer);
    }
  }, [points]);

  useEffect(() => {
    const layer = here.current;
    if (!layer) return;
    layer.clearLayers();
    if (!fix) return;
    // Not interactive, so a tap on the dot still reaches the map.
    L.circle(latLng(fix), { className: 'fix-accuracy', radius: fix.accuracy, color: CYAN, weight: 1, fillOpacity: 0.12, interactive: false }).addTo(layer);
    L.circleMarker(latLng(fix), { className: 'fix-dot', radius: 7, color: '#F5F5F5', weight: 2, fillColor: CYAN, fillOpacity: 1, interactive: false }).addTo(layer);
    if (!centred.current) {
      centred.current = true;
      map.current?.setView(latLng(fix), FIX_ZOOM);
    }
  }, [fix]);

  useEffect(() => {
    if (!fix) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fix]);

  // A hidden page gets no position updates: its fix is stale on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setFix(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const locate = () => {
    if (fix) map.current?.setView(latLng(fix), FIX_ZOOM);
    if (watch.current !== null) return;
    if (!('geolocation' in navigator)) return setNoLocation(true);
    setNoLocation(false);
    centred.current = false;
    watch.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setNow(Date.now());
        setFix({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp });
      },
      (error) => {
        // No fix to mark until the next one. Position unavailable or a timeout is transient: the
        // watch goes on. Only a denied permission ends it.
        setFix(null);
        if (error.code !== error.PERMISSION_DENIED) return;
        if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
        setNoLocation(true);
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  };

  const mark = () => {
    if (canMark(fix, Date.now())) setPoints((current) => [...current, { lat: fix.lat, lng: fix.lng }]);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.append('gpx', new Blob([toGpx(points)], { type: 'application/gpx+xml' }), 'ruta.gpx');
    setBusy(true);
    setFailure(null);
    void uploadTrail(form).then((result) => {
      if (result.ok) {
        sessionStorage.removeItem(STORAGE_KEY);
        return router.push(`/rutas/${result.trail.slug}`);
      }
      setBusy(false);
      setFailure(result);
    });
  };

  const count = points.length === 1 ? '1 punto' : `${points.length} puntos`;
  return (
    <>
      <div ref={container} role="region" aria-label="Mapa para marcar la ruta" data-testid="tracer-map" className="map-box rounded tracer-map" />
      <div className="tracer-controls">
        <button type="button" className="chip" onClick={locate}>
          <Icon name="location" size={18} />
          Mi ubicación
        </button>
        <button type="button" className="chip" onClick={mark} disabled={!canMark(fix, now)}>
          <Icon name="plus" size={18} />
          {fix ? `Marcar punto (±${Math.round(fix.accuracy)} m)` : 'Marcar punto'}
        </button>
        <button type="button" className="chip" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={points.length === 0}>
          Deshacer
        </button>
      </div>
      {noLocation && (
        <p role="alert" className="alert">
          Sin acceso a tu ubicación. Toca el mapa para marcar puntos.
        </p>
      )}
      <p className="muted" aria-live="polite" data-testid="trace-summary">
        {count} · {formatDistance(pathLengthM(points))}
      </p>
      {/* Always mounted, so the typed fields survive an undo below 2 points. */}
      <form onSubmit={submit} className="form">
        <TrailFields />
        <button type="submit" disabled={busy || points.length < 2} className="cta">
          {busy ? 'Subiendo…' : 'Subir ruta'}
        </button>
        {failure && <TrailFailureAlert failure={failure} />}
      </form>
    </>
  );
}
