'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { photoErrorMessage, submitPosition, uploadPhoto, type PhotoFailure } from '../../lib/photos-client';
import { useGeolocation } from '../../lib/geolocation';
import { canMark, type Point } from '../../lib/tracer';

// Leaflet exists in the browser only.
const PhotoMap = dynamic(() => import('./PhotoMap'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="map-box skeleton tracer-map" />,
});

export type NamedTrail = { slug: string; name: string; path: number[][] };

/**
 * "Vista" (plan §9 V2, V5; §10 L3-6, L3-7, A10): the camera input, a preview, the map with one pin
 * and "Publicar vista". The position sent is the pin, else a fix that passes the tracer gate, else
 * none (the API reads the photo's EXIF GPS). A named trail (`?ruta=`) goes with the photo; without
 * one and without a good fix the rider first picks a published trail. After the upload the rider
 * lands on the trail, where the photo shows "En revisión".
 */
export function NewPhotoForm({ trail, trails }: { trail: NamedTrail | null; trails: { slug: string; name: string }[] }) {
  const router = useRouter();
  const geo = useGeolocation();
  const { fix, start } = geo;
  const [now, setNow] = useState(() => Date.now());
  const noLocation = geo.status === 'denied' || geo.status === 'unavailable';
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // The file chosen last: a slower load of an earlier choice must not replace its preview.
  const chosen = useRef<string | null>(null);
  const [failure, setFailure] = useState<PhotoFailure | null>(null);
  const [pin, setPin] = useState<Point | null>(null);
  const located = canMark(fix, now);
  // Once there is a map it stays, also when the fix goes stale.
  const [mapShown, setMapShown] = useState(trail !== null);
  if (located && !mapShown) setMapShown(true);

  useEffect(start, [start]);
  useEffect(() => {
    // The clock of the age gate: a fix older than 10 s stops counting.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    setFailure(null);
    if (!file) {
      chosen.current = null;
      return setPreview(null);
    }
    const url = URL.createObjectURL(file);
    chosen.current = url;
    // The preview keeps the photo's own ratio; a file the browser cannot show has no preview.
    const image = new Image();
    image.onload = () => {
      if (chosen.current === url) setPreview({ url, width: image.naturalWidth, height: image.naturalHeight });
      else URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (chosen.current === url) setPreview(null);
    };
    image.src = url;
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const position = submitPosition(pin, fix, Date.now());
    if (position) {
      form.append('lat', position.lat);
      form.append('lng', position.lng);
    }
    if (trail) form.append('trail', trail.slug);
    setBusy(true);
    setFailure(null);
    void uploadPhoto(form).then((result) => {
      if (result.ok) return router.push(`/rutas/${result.photo.trailSlug}`);
      setBusy(false);
      setFailure(result);
    });
  };

  // Not narrowed by canMark: its false branch still may have a fix (a poor or old one).
  const accuracy = fix === null ? null : Math.round(fix.accuracy);
  const where = located ? `Ubicación lista (±${accuracy} m)` : accuracy !== null ? `Ubicación imprecisa (±${accuracy} m)` : 'Buscando tu ubicación…';

  if (!mapShown) {
    return (
      <>
        {noLocation ? (
          <p role="alert" className="alert">
            Sin acceso a tu ubicación. Elige el sendero.
          </p>
        ) : (
          <p className="muted" aria-live="polite" data-testid="photo-position">
            {where}
          </p>
        )}
        <h2 className="h-display">Elige el sendero</h2>
        {trails.length === 0 ? (
          <p className="muted">No hay senderos publicados.</p>
        ) : (
          <ul className="trail-pick">
            {trails.map((t) => (
              <li key={t.slug}>
                <Link href={`/vistas/nueva?ruta=${encodeURIComponent(t.slug)}`}>{t.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <form onSubmit={submit} className="form">
      {trail && <p className="eyebrow">{trail.name}</p>}
      <PhotoMap line={trail?.path ?? null} geo={geo} pin={pin} onPin={setPin} />
      {noLocation && (
        <p role="alert" className="alert">
          Sin acceso a tu ubicación. Toca el mapa donde tomaste la foto.
        </p>
      )}
      <label className="dropzone">
        Foto
        <input name="photo" type="file" required accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose} />
      </label>
      {preview && <img src={preview.url} width={preview.width} height={preview.height} alt="Vista previa" className="photo-preview" />}
      <p className="muted" aria-live="polite" data-testid="photo-position">
        {pin ? 'Punto marcado en el mapa' : noLocation ? '' : located ? where : 'Toca el mapa donde tomaste la foto.'}
      </p>
      <button type="submit" disabled={busy} className="cta">
        {busy ? 'Subiendo…' : 'Publicar vista'}
      </button>
      {failure && (
        <p role="alert" className="alert">
          {photoErrorMessage(failure)}
        </p>
      )}
    </form>
  );
}
