import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ElevationProfile } from '../../../components/trail/ElevationProfile';
import { TrailAdmin } from '../../../components/trail/TrailAdmin';
import { TrailMapLoader } from '../../../components/trail/TrailMapLoader';
import { getMe, getTrail } from '../../../lib/api';
import { difficultyLabel, statusLabel, trailTypeLabel } from '../../../lib/labels';

// The trail loads before any Suspense boundary, so a missing trail answers HTTP 404. A loading.tsx
// here would stream the page and turn that 404 into a 200.
export default async function TrailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cookie = (await headers()).get('cookie') ?? '';
  // The cookie is forwarded: an admin also gets drafts and hidden trails.
  const [trail, me] = await Promise.all([getTrail(slug, cookie), getMe(cookie)]);
  if (!trail) notFound();
  const admin = me?.role === 'admin';

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ color: '#CCFF00', marginBottom: 4 }}>{trail.name}</h1>
      <p style={{ margin: '0 0 16px' }}>
        {trail.city} · {difficultyLabel(trail.difficulty)} · {trailTypeLabel(trail.type)}
        {admin && <> · {statusLabel(trail.status)}</>}
      </p>
      <TrailMapLoader path={trail.path} start={trail.start} end={trail.end} />
      {trail.description && (
        <p data-testid="trail-description" style={{ whiteSpace: 'pre-line' }}>
          {trail.description}
        </p>
      )}
      {trail.elevationProfile && (
        <ElevationProfile
          profile={trail.elevationProfile}
          distanceM={trail.distanceM}
          elevationGainM={trail.elevationGainM}
          elevationLossM={trail.elevationLossM}
          elevationMinM={trail.elevationMinM}
          elevationMaxM={trail.elevationMaxM}
        />
      )}
      {admin && <TrailAdmin trail={trail} />}
    </main>
  );
}
