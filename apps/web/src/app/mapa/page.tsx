import { Suspense } from 'react';
import { EmptyTrails } from '../../components/explore/EmptyTrails';
import { ExploreHead, trailCount } from '../../components/explore/ExploreHead';
import type { CardTrail } from '../../components/trail/TrailCard';
import { ExploreMapLoader } from '../../components/trail/ExploreMapLoader';
import { EXPLORE_MAP_HEIGHT } from '../../components/trail/map-size';
import { listTrails } from '../../lib/api';

export const dynamic = 'force-dynamic';

async function TrailMapSection() {
  const trails: CardTrail[] = await listTrails();
  if (trails.length === 0) return <EmptyTrails />;
  // Only what the map shows reaches the browser: no profile.
  const pins = trails.map(({ slug, name, difficulty, start, distanceM, elevationGainM }) => ({
    slug,
    name,
    difficulty,
    start,
    distanceM,
    elevationGainM: elevationGainM ?? null,
  }));
  return (
    <>
      <p className="row-between muted">
        {trailCount(trails.length)}
        <a href="/">Ver como lista</a>
      </p>
      <ExploreMapLoader trails={pins} />
    </>
  );
}

export default function MapPage() {
  return (
    <main className="page">
      <ExploreHead view="map" />
      <Suspense
        fallback={<div data-testid="trail-map-skeleton" aria-hidden="true" className="skeleton" style={{ height: EXPLORE_MAP_HEIGHT }} />}
      >
        <TrailMapSection />
      </Suspense>
    </main>
  );
}
