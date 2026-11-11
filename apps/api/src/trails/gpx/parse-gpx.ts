import { BadRequestException } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { LngLat } from '../../db/types/geo.js';

export type GpxErrorCode = 'GPX_INVALID' | 'GPX_EMPTY' | 'GPX_TOO_LARGE' | 'GPX_MULTI_SEGMENT' | 'GPX_OUT_OF_AREA';

/** A 400 with a constant code. It never carries a snippet of the uploaded file. */
export class GpxError extends BadRequestException {
  constructor(readonly code: GpxErrorCode) {
    super({ statusCode: 400, code, message: code });
  }
}

export type Track = {
  /** The decoded document, stored as the trail source. */
  text: string;
  points: LngLat[];
  /** One value per point, or null when any point has no usable elevation. */
  elevations: number[] | null;
};

export const MAX_POINTS = 100_000;
// The trails_*_in_peru check constraints (drizzle/0001_trail_constraints.sql).
const PERU = { minLng: -81.4, maxLng: -68.6, minLat: -18.4, maxLat: 0 };
const ELE_MIN = -500;
const ELE_MAX = 7000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  processEntities: false,
  isArray: (name) => name === 'trk' || name === 'trkseg' || name === 'trkpt',
});

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The children of an isArray tag; a bare `<trk/>` parses to '' and has none. */
const nodes = (value: unknown): Node[] => (Array.isArray(value) ? value.filter(isNode) : []);

function coordinate(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '') throw new GpxError('GPX_INVALID');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new GpxError('GPX_INVALID');
  return n;
}

/** Parses one continuous ride: exactly one track with exactly one non-empty segment. */
export function parseGpx(bytes: Uint8Array): Track {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new GpxError('GPX_INVALID');
  }
  // processEntities: false stops replacement, but the parser still reads a DOCTYPE.
  if (/<!DOCTYPE/i.test(text)) throw new GpxError('GPX_INVALID');
  if (XMLValidator.validate(text) !== true) throw new GpxError('GPX_INVALID');

  const doc: unknown = parser.parse(text);
  if (!isNode(doc) || !('gpx' in doc)) throw new GpxError('GPX_INVALID');
  const tracks = isNode(doc.gpx) ? nodes(doc.gpx.trk) : [];
  if (tracks.length > 1) throw new GpxError('GPX_MULTI_SEGMENT');
  const segments = nodes(tracks[0]?.trkseg).filter((segment) => nodes(segment.trkpt).length > 0);
  if (segments.length > 1) throw new GpxError('GPX_MULTI_SEGMENT');

  const trkpts = nodes(segments[0]?.trkpt);
  if (trkpts.length < 2) throw new GpxError('GPX_EMPTY');
  if (trkpts.length > MAX_POINTS) throw new GpxError('GPX_TOO_LARGE');

  const points: LngLat[] = [];
  const elevations: number[] = [];
  for (const trkpt of trkpts) {
    const lat = coordinate(trkpt.lat);
    const lng = coordinate(trkpt.lon);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new GpxError('GPX_INVALID');
    if (lng < PERU.minLng || lng > PERU.maxLng || lat < PERU.minLat || lat > PERU.maxLat) throw new GpxError('GPX_OUT_OF_AREA');
    points.push({ lat, lng });
    // An empty <ele/> parses to '' and does not count as 0.
    const { ele } = trkpt;
    if (typeof ele === 'number' && Number.isFinite(ele) && ele >= ELE_MIN && ele <= ELE_MAX) elevations.push(ele);
  }
  return { text, points, elevations: elevations.length === points.length ? elevations : null };
}
