import { cache } from 'react';
import { createApiClient, type components, type TrailDetail, type TrailSummary } from 'api-client';

/** A server-side API call that takes longer fails, so a hung API shows the error page. */
export const API_TIMEOUT_MS = 5000;

export type Me = components['schemas']['MeDto'];

function apiClient() {
  const baseUrl = process.env.API_INTERNAL_URL;
  if (!baseUrl) throw new Error('API_INTERNAL_URL is required');
  return createApiClient(baseUrl);
}

/** Published trails, newest first. Sends no city filter. */
export async function listTrails(): Promise<TrailSummary[]> {
  const { data, response } = await apiClient().GET('/api/trails', { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!data) throw new Error(`GET /api/trails failed with ${response.status}`);
  return data;
}

/**
 * The signed-in user for the given Cookie header, or null. Any failure counts as signed out: the
 * header is on every page and must not take a page down with it. Cached per request: the header and
 * the page share one call.
 */
export const getMe = cache(async (cookie: string): Promise<Me | null> => {
  if (!cookie) return null;
  try {
    const { data, response } = await apiClient().GET('/api/me', {
      headers: { cookie },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!data && response.status !== 401) console.warn(JSON.stringify({ event: 'api_me_failed', status: response.status }));
    return data ?? null;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    console.warn(JSON.stringify({ event: 'api_me_failed', name }));
    return null;
  }
});

/**
 * One trail, or null when the API answers 404. The incoming Cookie header is forwarded, so an admin
 * also gets drafts and hidden trails. Any other failure throws (the error page, not a 404).
 */
export async function getTrail(slug: string, cookie: string): Promise<TrailDetail | null> {
  const { data, response } = await apiClient().GET('/api/trails/{slug}', {
    params: { path: { slug } },
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (data) return data;
  if (response.status === 404) return null;
  throw new Error(`GET /api/trails/:slug failed with ${response.status}`);
}
