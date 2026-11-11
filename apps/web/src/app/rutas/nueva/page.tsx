import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NewTrailForm } from '../../../components/trail/NewTrailForm';
import { getMe } from '../../../lib/api';

// Admin only. Everyone else gets the 404 page: the route does not exist for them.
export default async function NewTrailPage() {
  const me = await getMe((await headers()).get('cookie') ?? '');
  if (!me) notFound();
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: 16 }}>
      <h1 style={{ color: '#CCFF00' }}>Nueva ruta</h1>
      <NewTrailForm />
    </main>
  );
}
