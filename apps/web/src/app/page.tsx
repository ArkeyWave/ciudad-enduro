import { listTrails } from '../lib/api';
import { difficultyLabel, trailTypeLabel } from '../lib/labels';

// Render on every request: the list changes at any time, and the build must not call the API.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const trails = await listTrails();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ color: '#CCFF00' }}>Senderos</h1>
      {trails.length === 0 ? (
        <p>Aún no hay senderos publicados.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {trails.map((trail) => (
            <li key={trail.id} style={{ borderBottom: '1px solid #2A2A2A', padding: '12px 0' }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>
                <a href={`/rutas/${trail.slug}`} style={{ color: 'inherit' }}>
                  {trail.name}
                </a>
              </h2>
              <p style={{ margin: '4px 0 0' }}>
                {trail.city} · {difficultyLabel(trail.difficulty)} · {trailTypeLabel(trail.type)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
