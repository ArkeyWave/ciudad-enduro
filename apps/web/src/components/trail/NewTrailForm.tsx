'use client';

import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { trailErrorMessage, uploadTrail, type TrailFailure } from '../../lib/trails-client';
import { input, LIME, primaryButton } from '../sign-in/styles';
import { column, TrailFields } from './TrailFields';

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
    <form onSubmit={submit} style={column}>
      <label style={column}>
        Archivo GPX
        <input name="gpx" type="file" required accept=".gpx,application/gpx+xml" style={input} />
      </label>
      <TrailFields />
      <button type="submit" disabled={busy} style={primaryButton}>
        {busy ? 'Subiendo…' : 'Subir ruta'}
      </button>
      {failure && (
        <p role="alert" style={{ margin: 0 }}>
          {trailErrorMessage(failure)}{' '}
        </p>
      )}
    </form>
  );
}
