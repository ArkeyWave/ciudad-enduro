import { notFound } from 'next/navigation';
import { NewTrailForm } from '../../../components/trail/NewTrailForm';
import { currentUser } from '../../../lib/session';

// Signed-in users only (plan §6 R-D7). Anonymous visitors get the 404 page.
export default async function NewTrailPage() {
  if (!(await currentUser())) notFound();
  return (
    <main className="page narrow">
      <div className="head">
        <h1 className="h-display">Importar GPX</h1>
      </div>
      <NewTrailForm />
    </main>
  );
}
