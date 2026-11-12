'use client';

import dynamic from 'next/dynamic';

// Leaflet, geolocation and sessionStorage exist in the browser only.
export const TracerLoader = dynamic(() => import('./Tracer'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="map-box skeleton tracer-map" />,
});
