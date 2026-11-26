import { Suspense } from 'react';
import { listTrails } from '../../lib/api';
import { districtLine } from '../../lib/districts';
import { Icon } from '../Icon';

/** The districts of the published trails (plan §10.1 A6); shares the page's cached list call. None without trails. */
async function DistrictLine() {
  const line = districtLine(await listTrails());
  if (!line) return null;
  return (
    <p className="eyebrow">
      <span className="loc-dot">
        <Icon name="gps" size={12} />
      </span>
      <span data-testid="explore-districts">{line}</span>
    </p>
  );
}

/** The Explorar head shared by the list (/) and the map (/mapa): two links, so back and deep links work. */
export function ExploreHead({ view }: { view: 'list' | 'map' }) {
  return (
    <div className="head">
      <Suspense
        fallback={
          <p aria-hidden="true" className="eyebrow">
            <span className="skeleton-line eyebrow-skeleton" />
          </p>
        }
      >
        <DistrictLine />
      </Suspense>
      <div className="row-between">
        <h1 className="h-display">
          ¿Qué desafíos quieres <b>superar hoy?</b>
        </h1>
        <nav aria-label="Vista" className="toggle">
          <a href="/" aria-label="Lista" aria-current={view === 'list' ? 'page' : undefined}>
            <Icon name="list" size={20} />
          </a>
          <a href="/mapa" aria-label="Mapa" aria-current={view === 'map' ? 'page' : undefined}>
            <Icon name="map" size={20} />
          </a>
        </nav>
      </div>
    </div>
  );
}

export const trailCount = (count: number) => (count === 1 ? '1 sendero' : `${count} senderos`);
