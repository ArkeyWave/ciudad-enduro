'use client';

import type { TrailPhoto } from 'api-client';
import { useRef, useState } from 'react';
import { reviewLabel } from '../../lib/labels';
import { formatDistance } from '../../lib/profile';
import { Icon } from '../Icon';

/** The place of a photo on the trail, for its label: "a 450 m" or the photo number. */
const where = (photo: TrailPhoto, index: number, distanceM: number | null) =>
  distanceM ? `Vista a ${formatDistance(photo.lineFraction * distanceM)}` : `Vista ${index + 1}`;

/**
 * The photos of a trail in line order (plan §9 V5): start and end dots, one 56 px round thumbnail
 * per photo; a tap opens the photo full-screen in a modal `<dialog>` (Escape and "Cerrar" close it).
 * Focus goes back to the thumbnail that opened it. A photo the viewer sees before it is published (their own, or any for an admin) has a chip.
 */
export function PhotoTimeline({ photos, distanceM }: { photos: TrailPhoto[]; distanceM: number | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const shown = open === null ? null : photos[open];

  const show = (index: number, button: HTMLButtonElement) => {
    opener.current = button;
    setOpen(index);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  return (
    <section aria-labelledby="vistas-title" className="card card-pad">
      <h2 id="vistas-title" className="eyebrow">
        Vistas
      </h2>
      <ol className="timeline" data-testid="photo-timeline">
        <li className="tl-end" aria-hidden="true" />
        {photos.map((photo, index) => (
          <li key={photo.id} className="tl-item">
            <button type="button" className="tl-photo" aria-label={where(photo, index, distanceM)} onClick={(event) => show(index, event.currentTarget)}>
              <img src={photo.thumbUrl} width={56} height={56} alt="" loading="lazy" />
            </button>
            {photo.status !== 'published' && (
              <span className="status-chip" data-testid="photo-status">
                {reviewLabel(photo.status)}
              </span>
            )}
          </li>
        ))}
        <li className="tl-end" aria-hidden="true" />
      </ol>
      {/* A click on the backdrop lands on the dialog itself and closes it; Escape closes it natively. */}
      <dialog
        ref={dialog}
        className="photo-viewer"
        aria-label={shown ? where(shown, open!, distanceM) : 'Vista'}
        onClose={() => {
          setOpen(null);
          opener.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <button type="button" className="back" aria-label="Cerrar" onClick={close}>
          <Icon name="close" size={20} />
        </button>
        {shown && <img src={shown.url} width={shown.width} height={shown.height} alt={where(shown, open!, distanceM)} />}
      </dialog>
    </section>
  );
}
