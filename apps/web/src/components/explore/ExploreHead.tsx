import { Suspense } from 'react';
import { listTrails } from '../../lib/api';
import { districtLine } from '../../lib/districts';
import { Icon } from '../Icon';

/** The districts of the published trails (plan §10.1 A6); shares the page's cached list call. */
async function DistrictLine() {
  return <span data-testid="explore-districts">{districtLine(await listTrails())}</span>;
}

/** The Explorar head shared by the list (/) and the map (/mapa): two links, so back and deep links work. */
export function ExploreHead({ view }: { view: 'list' | 'map' }) {
  return (
    <div className="head">
      <p className="eyebrow">
        <span className="loc-dot">
          <Icon name="gps" size={12} />
        </span>
        <Suspense fallback={<span aria-hidden="true" className="skeleton-line eyebrow-skeleton" />}>
          <DistrictLine />
        </Suspense>
      </p>
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
