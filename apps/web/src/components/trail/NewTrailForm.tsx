'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { gpxStart, suggestionPoint } from '../../lib/districts';
import { useGeolocation } from '../../lib/geolocation';
import type { Point } from '../../lib/tracer';
import { uploadTrail, type TrailFailure } from '../../lib/trails-client';
import { TrailFailureAlert } from './TrailFailureAlert';
import { TrailFields } from './TrailFields';

export function NewTrailForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TrailFailure | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const geo = useGeolocation();
  const { startIfGranted } = geo;

  // The district suggestion may use the device only when the permission is already granted: this
  // page shows no prompt (plan §10.1 A7).
  useEffect(startIfGranted, [startIfGranted]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    setStart(null);
    void file?.text().then((text) => setStart(gpxStart(text)));
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setFailure(null);
    void uploadTrail(form).then((result) => {
      if (result.ok) return router.push(`/rutas/${result.trail.slug}`);
      setBusy(false);
      setFailure(result);
    });
  };

  return (
    <form onSubmit={submit} className="form">
      <label className="dropzone">
        Archivo GPX
        <input name="gpx" type="file" required accept=".gpx,application/gpx+xml" onChange={chooseFile} />
      </label>
      <TrailFields suggestion={suggestionPoint(start, geo.fix)} />
      <button type="submit" disabled={busy} className="cta">
        {busy ? 'Subiendo…' : 'Subir ruta'}
      </button>
      {failure && <TrailFailureAlert failure={failure} />}
    </form>
  );
}
