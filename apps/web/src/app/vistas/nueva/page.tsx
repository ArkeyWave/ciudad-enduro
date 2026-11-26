import { notFound } from 'next/navigation';
import { NewPhotoForm } from '../../../components/photo/NewPhotoForm';
import { getTrail, listTrails } from '../../../lib/api';
import { currentUser } from '../../../lib/session';

// Signed-in users only (plan §9 V5), like /rutas/nueva. Anonymous visitors get the 404 page.
// `?ruta=<slug>` names the trail (plan §10 L3-7, A9): only a published trail with a line, else no map.
export default async function NewPhotoPage({ searchParams }: { searchParams: Promise<{ ruta?: string | string[] }> }) {
  if (!(await currentUser())) notFound();
  const { ruta } = await searchParams;
  // Any `ruta` names a trail; only one non-empty slug can be available (a repeated one is an array).
  const asked = ruta !== undefined;
  const slug = typeof ruta === 'string' && ruta !== '' ? ruta : null;
  // No cookie: the anonymous view has published trails only.
  const trail = slug === null ? null : await getTrail(slug, '');
  const named = trail?.status === 'published' && trail.path && trail.path.length >= 2 ? { slug: trail.slug, name: trail.name, path: trail.path } : null;
  // Without a named trail, the rider picks one when the phone has no good fix (A10).
  // Only a trail with a line can take a vista.
  const trails = asked ? [] : (await listTrails()).filter((t) => t.hasPath).map(({ slug, name }) => ({ slug, name }));
  return (
    <main className="page narrow">
      <div className="head">
        <h1 className="h-display">Nueva vista</h1>
      </div>
      {asked && !named ? (
        <p role="alert" className="alert">
          Este sendero no está disponible.
        </p>
      ) : (
        <NewPhotoForm
          key={slug ?? ''}
          trail={named}
          trails={trails}
        />
      )}
    </main>
  );
}
