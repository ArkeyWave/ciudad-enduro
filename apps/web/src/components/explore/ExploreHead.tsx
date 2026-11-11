import { Icon } from '../Icon';

/** The Explorar head shared by the list (/) and the map (/mapa): two links, so back and deep links work. */
export function ExploreHead({ view }: { view: 'list' | 'map' }) {
  return (
    <div className="head">
      <p className="eyebrow">
        <span className="loc-dot">
          <Icon name="gps" size={12} />
        </span>
        Chimbote · Trujillo
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
