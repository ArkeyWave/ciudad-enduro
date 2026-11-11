import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { TrailCard } from '../../components/trail/TrailCard';
import { listMyTrails } from '../../lib/api';
import { reviewLabel } from '../../lib/labels';
import { currentUser } from '../../lib/session';

// Signed-in users only: everyone else gets the 404 page.
export default async function MyTrailsPage() {
  if (!(await currentUser())) notFound();
  const trails = await listMyTrails((await headers()).get('cookie') ?? '');
  return (
    <main className="page">
      <div className="head">
        <h1 className="h-display">Mis rutas</h1>
      </div>
      {trails.length === 0 ? (
        <div className="card card-pad empty">
          <p>Aún no registraste rutas.</p>
          <a href="/rutas/nueva" className="cta">
            Registrar ruta
          </a>
        </div>
      ) : (
        <ul className="list">
          {trails.map((trail) => (
            <li key={trail.id}>
              <TrailCard trail={trail} chip={reviewLabel(trail.status)} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
