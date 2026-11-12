import { trailErrorMessage, type TrailFailure } from '../../lib/trails-client';

/** The Spanish message of a failed upload; a 409 duplicate the uploader may see links that trail. */
export function TrailFailureAlert({ failure }: { failure: TrailFailure }) {
  return (
    <p role="alert" className="alert">
      {trailErrorMessage(failure)}{' '}
      {failure.slug && <a href={`/rutas/${encodeURIComponent(failure.slug)}`}>Ver la ruta</a>}
    </p>
  );
}
