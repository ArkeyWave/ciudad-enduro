'use client';

import dynamic from 'next/dynamic';
import { EXPLORE_MAP_HEIGHT } from './map-size';

// Leaflet needs `window`, and `ssr: false` is allowed in a Client Component only.
export const ExploreMapLoader = dynamic(() => import('./ExploreMap'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="map-box rounded skeleton" style={{ height: EXPLORE_MAP_HEIGHT }} />,
});
