'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { photoErrorMessage, positionFields, uploadPhoto, type PhotoFailure } from '../../lib/photos-client';
import { canMark, type Fix } from '../../lib/tracer';

/**
 * "Vista" (plan §9 V2, V5): the camera input, a preview, the live GPS fix and "Publicar vista". The
 * phone position goes with the photo only when it passes the tracer gate; otherwise the API reads
 * the photo's EXIF GPS. After the upload the rider lands on the trail, where the photo shows
 * "En revisión".
 */
export function NewPhotoForm() {
  const router = useRouter();
  const [fix, setFix] = useState<Fix | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [noLocation, setNoLocation] = useState(false);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PhotoFailure | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) return setNoLocation(true);
    const watch = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setNow(Date.now());
        setNoLocation(false);
        setFix({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp });
      },
      (error) => {
        setFix(null);
        if (error.code === error.PERMISSION_DENIED) setNoLocation(true);
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
    // The clock of the age gate: a fix older than 10 s stops counting.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    setFailure(null);
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    // The preview keeps the photo's own ratio; a file the browser cannot show has no preview.
    const image = new Image();
    image.onload = () => setPreview({ url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setPreview(null);
    };
    image.src = url;
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const position = positionFields(fix, Date.now());
    if (position) {
      form.append('lat', position.lat);
      form.append('lng', position.lng);
    }
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
  const located = canMark(fix, now);
  return (
    <form onSubmit={submit} className="form">
      <label className="dropzone">
        Foto
        <input name="photo" type="file" required accept="image/jpeg,image/png,image/webp" capture="environment" onChange={choose} />
      </label>
      {preview && <img src={preview.url} width={preview.width} height={preview.height} alt="Vista previa" className="photo-preview" />}
      <p className="muted" aria-live="polite" data-testid="photo-position">
        {noLocation
          ? 'Sin acceso a tu ubicación. Usaremos la ubicación de la foto.'
          : located
            ? `Ubicación lista (±${accuracy} m)`
            : accuracy !== null
              ? `Ubicación imprecisa (±${accuracy} m)`
              : 'Buscando tu ubicación…'}
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
