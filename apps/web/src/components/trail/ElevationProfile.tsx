import type { TrailDetail } from 'api-client';
import { formatKm, formatM, profilePolyline } from '../../lib/profile';
import { LIME } from '../sign-in/styles';

const WIDTH = 600;
const HEIGHT = 160;

type Props = Pick<TrailDetail, 'distanceM' | 'elevationGainM' | 'elevationLossM' | 'elevationMinM' | 'elevationMaxM'> & {
  profile: number[][];
};

/** The profile as an inline SVG; the numbers below it are the text version for screen readers. */
export function ElevationProfile({ profile, distanceM, elevationGainM, elevationLossM, elevationMinM, elevationMaxM }: Props) {
  const facts: [string, string | null][] = [
    ['Distancia', distanceM === null ? null : formatKm(distanceM)],
    ['Desnivel positivo', elevationGainM === null ? null : formatM(elevationGainM)],
    ['Desnivel negativo', elevationLossM === null ? null : formatM(elevationLossM)],
    ['Altura mínima', elevationMinM === null ? null : formatM(elevationMinM)],
    ['Altura máxima', elevationMaxM === null ? null : formatM(elevationMaxM)],
  ];
  return (
    <section aria-labelledby="perfil">
      <h2 id="perfil" style={{ fontSize: 20 }}>
        Perfil de elevación
      </h2>
      <svg
        data-testid="elevation-profile"
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: HEIGHT, background: '#141414', borderRadius: 8 }}
      >
        <polyline
          points={profilePolyline(profile, WIDTH, HEIGHT)}
          fill="none"
          stroke={LIME}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
        {facts.map(([label, value]) =>
          value === null ? null : (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd style={{ margin: 0 }}>{value}</dd>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
