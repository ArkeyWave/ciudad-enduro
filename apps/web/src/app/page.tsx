import { Suspense } from 'react';
import { EmptyTrails } from '../components/explore/EmptyTrails';
import { ExploreHead, trailCount } from '../components/explore/ExploreHead';
import { TrailCard, TrailListSkeleton } from '../components/trail/TrailCard';
import { listTrails } from '../lib/api';

// Render on every request: the list changes at any time, and the build must not call the API.
export const dynamic = 'force-dynamic';

async function TrailList() {
  const trails = await listTrails();
  if (trails.length === 0) return <EmptyTrails />;
  return (
    <>
      <p className="muted">{trailCount(trails.length)}</p>
      <ul className="list">
        {trails.map((trail) => (
          <li key={trail.id}>
            <TrailCard trail={trail} />
          </li>
        ))}
      </ul>
    </>
  );
}

// The Suspense lives here, not in app/loading.tsx: a route-level loading file would also stream the
// pages that must answer a real 404 (UX standard R5).
export default function HomePage() {
  return (
    <main className="page">
      <ExploreHead view="list" />
      <Suspense fallback={<TrailListSkeleton />}>
        <TrailList />
      </Suspense>
    </main>
  );
}
