import { notFound } from 'next/navigation';
import { NewTrailForm } from '../../../components/trail/NewTrailForm';
import { TracerLoader } from '../../../components/trail/TracerLoader';
import { currentUser } from '../../../lib/session';

// Signed-in users only (plan §6 R-D7). Anonymous visitors get the 404 page.
// Two modes as links (plan §8 G2): Marcar (default) and Importar GPX (`?modo=gpx`).
export default async function NewTrailPage({ searchParams }: { searchParams: Promise<{ modo?: string | string[] }> }) {
  if (!(await currentUser())) notFound();
  const gpx = (await searchParams).modo === 'gpx';
  return (
    <main className="page narrow">
      <div className="head">
        <h1 className="h-display">{gpx ? 'Importar GPX' : 'Marcar ruta'}</h1>
      </div>
      <nav aria-label="Modo" className="toggle tabs">
        <a href="/rutas/nueva" aria-current={gpx ? undefined : 'page'}>
          Marcar
        </a>
        <a href="/rutas/nueva?modo=gpx" aria-current={gpx ? 'page' : undefined}>
          Importar GPX
        </a>
      </nav>
      {gpx ? <NewTrailForm /> : <TracerLoader />}
    </main>
  );
}
