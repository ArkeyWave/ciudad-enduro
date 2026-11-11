import type { TrailSummary } from 'api-client';
import { trailTypeLabel } from '../../lib/labels';
import { profilePolyline, sampleProfile } from '../../lib/profile';
import { DifficultyPill, TrailStats } from './TrailStats';

const W = 300;
const H = 34;

/**
 * The elevation fields come with the summary once the API sends them (plan D8); until then, and for a
 * trail without them, the card hides those stats and the mini profile.
 */
export type CardTrail = TrailSummary & { elevationGainM?: number | null; elevationProfile?: number[][] | null };

/** One trail as the prototype's card, laid out in a list; the whole card is one link. */
export function TrailCard({ trail }: { trail: CardTrail }) {
  const profile = trail.elevationProfile;
  return (
    <a href={`/rutas/${trail.slug}`} className="card trail-card" data-testid="trail-card">
      <span className="row-between">
        <DifficultyPill difficulty={trail.difficulty} />
        <span className="type-label">
          {trail.city} · {trailTypeLabel(trail.type)}
        </span>
      </span>
      <h2 className="swipe-title">{trail.name}</h2>
      {profile && profile.length >= 2 && (
        <svg className="elev" aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <polyline
            points={profilePolyline(sampleProfile(profile, 40), W, H)}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <TrailStats distanceM={trail.distanceM} gainM={trail.elevationGainM} />
    </a>
  );
}

export function TrailListSkeleton() {
  return (
    <div data-testid="trail-list-skeleton" aria-hidden="true" className="list">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton" style={{ height: 180 }} />
      ))}
    </div>
  );
}
