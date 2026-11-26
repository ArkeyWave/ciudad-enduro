import { notFound } from 'next/navigation';
import { Icon } from '../../../components/Icon';
import { PhotoTimeline } from '../../../components/photo/PhotoTimeline';
import { ElevationProfile } from '../../../components/trail/ElevationProfile';
import { TrailAdmin } from '../../../components/trail/TrailAdmin';
import { TrailMapLoader } from '../../../components/trail/TrailMapLoader';
import { DifficultyPill, TrailStats } from '../../../components/trail/TrailStats';
import { getTrail } from '../../../lib/api';
import { reviewLabel, statusLabel, trailTypeLabel } from '../../../lib/labels';
import { isAdmin } from '../../../lib/roles';
import { currentUser } from '../../../lib/session';
import { headers } from 'next/headers';

// The trail loads before any Suspense boundary, so a missing trail answers HTTP 404. A loading.tsx
// here would stream the page and turn that 404 into a 200.
export default async function TrailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cookie = (await headers()).get('cookie') ?? '';
  // The cookie is forwarded: an admin also gets drafts and hidden trails.
  const [trail, me] = await Promise.all([getTrail(slug, cookie), currentUser()]);
  if (!trail) notFound();
  const admin = isAdmin(me);
  const { lat, lng } = trail.start;
  // The API shows a draft or hidden trail to an admin and to its author only, so a non-admin who
  // gets one is its author. A published trail has no chip for everyone else.
  const chip = admin ? statusLabel(trail.status) : trail.status === 'published' ? null : reviewLabel(trail.status);

  return (
    <main className="page">
      <div className="detail-hero">
        <TrailMapLoader
          slug={trail.slug}
          path={trail.path}
          start={trail.start}
          end={trail.end}
          profiled={trail.elevationProfile !== null}
          photos={trail.photos}
        />
        <a href="/" className="back" aria-label="Volver">
          <Icon name="chevL" size={20} />
        </a>
      </div>
      <div className="detail-body">
        <header data-testid="trail-meta">
          <div className="meta-row">
            <DifficultyPill difficulty={trail.difficulty} />
            <span className="type-label">{trailTypeLabel(trail.type)}</span>
            {chip && (
              <span className="status-chip" data-testid="trail-status">
                {chip}
              </span>
            )}
          </div>
          <h1 className="detail-title">{trail.name}</h1>
          <p className="eyebrow">
            <span className="loc-dot">
              <Icon name="gps" size={12} />
            </span>
            {trail.city}
          </p>
        </header>
        <TrailStats type={trail.type} distanceM={trail.distanceM} gainM={trail.elevationGainM} lossM={trail.elevationLossM} />
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
        <PhotoTimeline photos={trail.photos} distanceM={trail.distanceM} />
        {trail.description && (
          <p data-testid="trail-description" className="description">
            {trail.description}
          </p>
        )}
        <a
          className="cta ghost"
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`}
        >
          <Icon name="location" size={18} /> Cómo llegar al inicio
        </a>
        {admin && <TrailAdmin trail={trail} />}
      </div>
    </main>
  );
}
