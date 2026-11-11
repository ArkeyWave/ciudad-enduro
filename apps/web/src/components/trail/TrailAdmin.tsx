'use client';

import type { TrailDetail } from 'api-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { trailErrorMessage, updateTrail, type TrailUpdate } from '../../lib/trails-client';
import { TrailFields } from './TrailFields';

type Action = 'publish' | 'hide' | 'edit';

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

  // A draft can be published or refused (hidden); a published trail hidden; a hidden one published.
  const canPublish = trail.status !== 'published';
  const canHide = trail.status !== 'hidden';

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
    <section aria-labelledby="admin" className="admin">
      <h2 id="admin" className="eyebrow">
        Administrar
      </h2>
      {canPublish && (
        <button type="button" disabled={busy} onClick={() => void save('publish', { status: 'published' })} className="cta">
          {pending('publish') ? 'Publicando…' : 'Publicar'}
        </button>
      )}
      {canHide && (
        <button type="button" disabled={busy} onClick={() => void save('hide', { status: 'hidden' })} className="cta ghost">
          {pending('hide') ? 'Ocultando…' : 'Ocultar'}
        </button>
      )}
      <form onSubmit={submit} className="form">
        <TrailFields values={trail} />
        <button type="submit" disabled={busy} className="cta ghost">
          {pending('edit') ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
      {message && (
        <p role="alert" className="alert">
          {message}
        </p>
      )}
    </section>
  );
}
