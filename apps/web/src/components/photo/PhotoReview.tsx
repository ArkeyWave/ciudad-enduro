'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { QueuePhoto } from '../../lib/api';
import { photoErrorMessage, updatePhoto, type PhotoStatus } from '../../lib/photos-client';

/** One photo of the review queue (admin): the thumbnail, the trail, the author, Publicar / Ocultar. */
export function PhotoReview({ photo }: { photo: QueuePhoto }) {
  const router = useRouter();
  const [action, setAction] = useState<PhotoStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const busy = sending || refreshing;

  async function save(status: PhotoStatus) {
    setAction(status);
    setSending(true);
    setMessage(null);
    const result = await updatePhoto(photo.id, status);
    setSending(false);
    if (!result.ok) return setMessage(photoErrorMessage(result));
    startRefresh(() => router.refresh());
  }

  return (
    <div className="card card-pad photo-review" data-testid="photo-review">
      <a href={photo.url} className="photo-review-thumb">
        <img src={photo.thumbUrl} width={80} height={80} alt={`Vista en ${photo.trailName}`} loading="lazy" />
      </a>
      <div className="photo-review-body">
        <a href={`/rutas/${photo.trailSlug}`}>{photo.trailName}</a>
        <span className="muted">Enviada por {photo.authorEmail ?? 'una cuenta eliminada'}</span>
        <div className="photo-review-actions">
          <button type="button" className="chip" disabled={busy} onClick={() => void save('published')}>
            {busy && action === 'published' ? 'Publicando…' : 'Publicar'}
          </button>
          <button type="button" className="chip" disabled={busy} onClick={() => void save('hidden')}>
            {busy && action === 'hidden' ? 'Ocultando…' : 'Ocultar'}
          </button>
        </div>
        {message && (
          <p role="alert" className="alert">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
