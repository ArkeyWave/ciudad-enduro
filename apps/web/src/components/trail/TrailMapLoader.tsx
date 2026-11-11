'use client';

import dynamic from 'next/dynamic';
import { MAP_HEIGHT } from './map-size';

// Leaflet needs `window`, and Next.js refuses `ssr: false` in a Server Component, so this client
// wrapper loads the map in the browser only.
export const TrailMapLoader = dynamic(() => import('./TrailMap'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="map-box skeleton" style={{ height: MAP_HEIGHT }} />,
});
