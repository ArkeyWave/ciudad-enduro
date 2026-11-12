import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PhotoReview } from '../../../components/photo/PhotoReview';
import { TrailCard } from '../../../components/trail/TrailCard';
import { listPhotoQueue, listQueue } from '../../../lib/api';
import { isAdmin } from '../../../lib/roles';
import { currentUser } from '../../../lib/session';

// Admin only: everyone else gets the 404 page. Trails: Publicar / Ocultar act on the detail page.
// Photos (plan §9 V5): Publicar / Ocultar act here.
export default async function ReviewQueuePage() {
  if (!isAdmin(await currentUser())) notFound();
  const cookie = (await headers()).get('cookie') ?? '';
  const [trails, photos] = await Promise.all([listQueue(cookie), listPhotoQueue(cookie)]);
  return (
    <main className="page">
      <div className="head">
        <h1 className="h-display">Rutas en revisión</h1>
      </div>
      {trails.length === 0 ? (
        <div className="card card-pad empty">
          <p>No hay rutas en revisión.</p>
        </div>
      ) : (
        <ul className="list">
          {trails.map((trail) => (
            <li key={trail.id}>
              <TrailCard trail={trail} note={`Registrada por ${trail.authorEmail ?? 'una cuenta eliminada'}`} />
            </li>
          ))}
        </ul>
      )}
      <div className="head">
        <h2 className="h-display">Vistas en revisión</h2>
      </div>
      {photos.length === 0 ? (
        <div className="card card-pad empty">
          <p>No hay vistas en revisión.</p>
        </div>
      ) : (
        <ul className="list">
          {photos.map((photo) => (
            <li key={photo.id}>
              <PhotoReview photo={photo} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
