import createClient from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };

type Schemas = components['schemas'];
export type District = Schemas['DistrictDto'];
export type Difficulty = Schemas['Difficulty'];
export type TrailType = Schemas['TrailType'];
export type Coordinates = Schemas['CoordinatesDto'];
export type TrailListItem = Schemas['TrailListItemDto'];
/** The fields every trail list shares (the document flattens the DTO inheritance). */
export type TrailSummary = Omit<TrailListItem, 'previewPhotos'>;
export type PreviewPhoto = Schemas['PreviewPhotoDto'];
export type TrailDetail = Schemas['TrailDetailDto'];
export type TrailPhoto = Schemas['TrailPhotoDto'];

/** Typed client for the Ciudad Enduro API. `baseUrl` is the origin; paths start with /api. */
export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

