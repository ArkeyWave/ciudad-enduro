import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dev only: in production Traefik routes /api to the API container on the same domain.
  rewrites() {
    if (process.env.NODE_ENV !== 'development') return Promise.resolve([]);
    const api = process.env.API_INTERNAL_URL;
    if (!api) throw new Error('API_INTERNAL_URL is required');
    return Promise.resolve([{ source: '/api/:path*', destination: `${api}/api/:path*` }]);
  },
};

export default nextConfig;
