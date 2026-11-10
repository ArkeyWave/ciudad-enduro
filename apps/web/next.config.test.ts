import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from './next.config';

afterEach(() => vi.unstubAllEnvs());

async function rewrites(nodeEnv: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('API_INTERNAL_URL', 'http://localhost:3001');
  return nextConfig.rewrites?.();
}

describe('/api rewrite', () => {
  it('proxies /api to the API in development', async () => {
    expect(await rewrites('development')).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    ]);
  });

  it('does not exist in production, where Traefik routes /api', async () => {
    expect(await rewrites('production')).toEqual([]);
  });
});
