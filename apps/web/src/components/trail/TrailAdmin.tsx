'use client';

import type { TrailDetail } from 'api-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { trailErrorMessage, updateTrail, type TrailUpdate } from '../../lib/trails-client';
import { primaryButton, secondaryButton } from '../sign-in/styles';
import { column, TrailFields } from './TrailFields';

type Action = 'status' | 'edit';

/** Admin only: publish or hide the trail, and edit its metadata. No optimistic UI. */
export function TrailAdmin({ trail }: { trail: TrailDetail }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [sending, setSending] = useState(false);
  // The controls stay disabled until the page shows the saved trail.
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const busy = sending || refreshing;
  const pending = (which: Action) => busy && action === which;

  async function save(which: Action, body: TrailUpdate) {
    setAction(which);
    setSending(true);
    setMessage(null);
    const result = await updateTrail(trail.slug, body);
    setSending(false);
    if (!result.ok) return setMessage(trailErrorMessage(result));
    startRefresh(() => router.refresh());
  }

  const published = trail.status === 'published';

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    void save('edit', {
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
        onClick={() => void save('status', { status: published ? 'hidden' : 'published' })}
        style={published ? secondaryButton : primaryButton}
      >
        {published ? (pending('status') ? 'Ocultando…' : 'Ocultar') : pending('status') ? 'Publicando…' : 'Publicar'}
      </button>
      <form onSubmit={submit} style={column}>
        <TrailFields values={trail} />
        <button type="submit" disabled={busy} style={secondaryButton}>
          {pending('edit') ? 'Guardando…' : 'Guardar'}
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
