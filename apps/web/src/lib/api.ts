import { createApiClient, type components, type TrailSummary } from 'api-client';

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
 * header is on every page and must not take a page down with it.
 */
export async function getMe(cookie: string): Promise<Me | null> {
  if (!cookie) return null;
  try {
    const { data } = await apiClient().GET('/api/me', {
      headers: { cookie },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    return data ?? null;
  } catch {
    return null;
  }
}
