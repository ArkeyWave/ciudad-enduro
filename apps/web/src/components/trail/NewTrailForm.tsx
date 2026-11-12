'use client';

import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { uploadTrail, type TrailFailure } from '../../lib/trails-client';
import { TrailFailureAlert } from './TrailFailureAlert';
import { TrailFields } from './TrailFields';

export function NewTrailForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TrailFailure | null>(null);

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
        <input name="gpx" type="file" required accept=".gpx,application/gpx+xml" />
      </label>
      <TrailFields />
      <button type="submit" disabled={busy} className="cta">
        {busy ? 'Subiendo…' : 'Subir ruta'}
      </button>
      {failure && <TrailFailureAlert failure={failure} />}
    </form>
  );
}
