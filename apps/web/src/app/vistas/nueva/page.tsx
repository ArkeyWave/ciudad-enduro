import { notFound } from 'next/navigation';
import { NewPhotoForm } from '../../../components/photo/NewPhotoForm';
import { currentUser } from '../../../lib/session';

// Signed-in users only (plan §9 V5), like /rutas/nueva. Anonymous visitors get the 404 page.
export default async function NewPhotoPage() {
  if (!(await currentUser())) notFound();
  return (
    <main className="page narrow">
      <div className="head">
        <h1 className="h-display">Nueva vista</h1>
      </div>
      <NewPhotoForm />
    </main>
  );
}
