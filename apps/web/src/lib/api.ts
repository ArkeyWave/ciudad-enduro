import { createApiClient, type TrailSummary } from 'api-client';

function apiClient() {
  const baseUrl = process.env.API_INTERNAL_URL;
  if (!baseUrl) throw new Error('API_INTERNAL_URL is required');
  return createApiClient(baseUrl);
}

/** Published trails, newest first. Sends no city filter. */
export async function listTrails(): Promise<TrailSummary[]> {
  const { data, response } = await apiClient().GET('/api/trails');
  if (!data) throw new Error(`GET /api/trails failed with ${response.status}`);
  return data;
}
