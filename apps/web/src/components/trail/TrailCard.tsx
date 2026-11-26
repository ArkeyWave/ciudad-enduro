import type { PreviewPhoto, TrailSummary } from 'api-client';
import { trailTypeLabel } from '../../lib/labels';
import { profilePolyline, sampleProfile } from '../../lib/profile';
import { CardSlider } from './CardSlider';
import { DifficultyPill, TrailStats } from './TrailStats';

const W = 300;
const H = 34;

/**
 * One trail as the prototype's card, laid out in a list. The title is the link, stretched over the
 * card; with `slides` (Explorar) the card slider sits on top of it (plan §10.1 A13). A trail without
 * elevation numbers hides those stats and the mini profile.
 */
export function TrailCard({
  trail,
  slides,
  chip,
  note,
}: {
  trail: TrailSummary;
  slides?: PreviewPhoto[];
  chip?: string | null;
  note?: string;
}) {
  const profile = trail.elevationProfile;
  return (
    <article className={slides ? 'card trail-card with-slides' : 'card trail-card'} data-testid="trail-card">
      {slides && <CardSlider name={trail.name} start={trail.start} photos={slides} />}
      <div className="trail-card-body">
        <span className="row-between">
          <span className="meta-row">
            <DifficultyPill difficulty={trail.difficulty} />
            {chip && (
              <span className="status-chip" data-testid="trail-status">
                {chip}
              </span>
            )}
          </span>
          <span className="type-label">
            {trail.district.name} · {trailTypeLabel(trail.type)}
          </span>
        </span>
        <h2 className="swipe-title">
          <a href={`/rutas/${trail.slug}`} className="card-link">
            {trail.name}
          </a>
        </h2>
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
        <TrailStats
          type={trail.type}
          distanceM={trail.distanceM}
          gainM={trail.elevationGainM}
          lossM={trail.elevationLossM}
        />
        {note && <span className="muted">{note}</span>}
      </div>
    </article>
  );
}

export function TrailListSkeleton() {
  return (
    <div data-testid="trail-list-skeleton" aria-hidden="true">
      <p className="muted skeleton-line" />
      <div className="list">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton card-skeleton" />
        ))}
      </div>
    </div>
  );
}
