import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };

type Schemas = components['schemas'];
export type City = Schemas['City'];
export type Difficulty = Schemas['Difficulty'];
export type TrailType = Schemas['TrailType'];
export type Coordinates = Schemas['CoordinatesDto'];
export type TrailSummary = Schemas['TrailSummaryDto'];
export type TrailDetail = Schemas['TrailDetailDto'];
export type TrailPhoto = Schemas['TrailPhotoDto'];

/** Typed client for the Ciudad Enduro API. `baseUrl` is the origin; paths start with /api. */
export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

