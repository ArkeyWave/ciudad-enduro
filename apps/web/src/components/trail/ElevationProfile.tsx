import type { TrailDetail } from 'api-client';
import { formatDistance, formatM, profilePolyline } from '../../lib/profile';

const WIDTH = 600;
const HEIGHT = 120;

type Props = Pick<TrailDetail, 'distanceM' | 'elevationGainM' | 'elevationLossM' | 'elevationMinM' | 'elevationMaxM'> & {
  profile: number[][];
};

/** The profile as an inline SVG; the numbers below it are the text version for screen readers. */
export function ElevationProfile({ profile, distanceM, elevationGainM, elevationLossM, elevationMinM, elevationMaxM }: Props) {
  const facts: [string, string | null][] = [
    ['Distancia', distanceM === null ? null : formatDistance(distanceM)],
    ['Desnivel positivo', elevationGainM === null ? null : formatM(elevationGainM)],
    ['Desnivel negativo', elevationLossM === null ? null : formatM(elevationLossM)],
    ['Altura mínima', elevationMinM === null ? null : formatM(elevationMinM)],
    ['Altura máxima', elevationMaxM === null ? null : formatM(elevationMaxM)],
  ];
  return (
    <section aria-labelledby="perfil" className="card card-pad profile-card">
      <h2 id="perfil" className="eyebrow">
        Perfil de elevación
      </h2>
      <svg
        data-testid="elevation-profile"
        aria-hidden="true"
        className="profile-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
      >
        <polyline points={profilePolyline(profile, WIDTH, HEIGHT)} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <dl className="facts">
        {facts.map(([label, value]) =>
          value === null ? null : (
            <div key={label} className="fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
