import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { TrailCard } from '../../../components/trail/TrailCard';
import { listQueue } from '../../../lib/api';
import { isAdmin } from '../../../lib/roles';
import { currentUser } from '../../../lib/session';

// Admin only: everyone else gets the 404 page. Publicar / Ocultar act on the detail page.
export default async function ReviewQueuePage() {
  if (!isAdmin(await currentUser())) notFound();
  const trails = await listQueue((await headers()).get('cookie') ?? '');
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
    </main>
  );
}
