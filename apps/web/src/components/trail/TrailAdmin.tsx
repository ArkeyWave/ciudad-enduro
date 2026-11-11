'use client';

import type { TrailDetail } from 'api-client';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { trailErrorMessage, updateTrail, type TrailUpdate } from '../../lib/trails-client';
import { primaryButton, secondaryButton } from '../sign-in/styles';
import { column, TrailFields } from './TrailFields';

/** Admin only: publish or hide the trail, and edit its metadata. No optimistic UI. */
export function TrailAdmin({ trail }: { trail: TrailDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(body: TrailUpdate) {
    setBusy(true);
    setMessage(null);
    const result = await updateTrail(trail.slug, body);
    setBusy(false);
    if (!result.ok) return setMessage(trailErrorMessage(result));
    router.refresh();
  }

  const published = trail.status === 'published';

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    void save({
      name: field('name'),
      city: field('city') as TrailUpdate['city'],
      difficulty: field('difficulty') as TrailUpdate['difficulty'],
      type: field('type') as TrailUpdate['type'],
      description: field('description'),
    });
  };

  return (
    <section aria-labelledby="admin" style={{ ...column, borderTop: '1px solid #2A2A2A', marginTop: 24, paddingTop: 16 }}>
      <h2 id="admin" style={{ fontSize: 20, margin: 0 }}>
        Administrar
      </h2>
      <button
        type="button"
        disabled={busy}
        onClick={() => void save({ status: published ? 'hidden' : 'published' })}
        style={published ? secondaryButton : primaryButton}
      >
        {published ? 'Ocultar' : 'Publicar'}
      </button>
      <form onSubmit={submit} style={column}>
        <TrailFields values={trail} />
        <button type="submit" disabled={busy} style={secondaryButton}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
      {message && (
        <p role="alert" style={{ margin: 0 }}>
          {message}
        </p>
      )}
    </section>
  );
}
