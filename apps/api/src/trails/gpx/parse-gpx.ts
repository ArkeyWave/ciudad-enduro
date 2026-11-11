import { BadRequestException } from '@nestjs/common';
import { SaxesParser } from 'saxes';
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
const MAX_DEPTH = 100;
// The trails_*_in_peru check constraints (drizzle/0001_trail_constraints.sql).
const PERU = { minLng: -81.4, maxLng: -68.6, minLat: -18.4, maxLat: 0 };
const ELE_MIN = -500;
const ELE_MAX = 7000;
// Names an object-building parser would treat as prototype keys; refused, as before the stream.
const RESERVED = new Set(['constructor', '__proto__', 'prototype']);

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

function coordinate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') throw new GpxError('GPX_INVALID');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new GpxError('GPX_INVALID');
  return n;
}

/** A usable `<ele>`: one number in range; an empty or a repeated `<ele>` does not count. */
function elevation(texts: string[]): number | undefined {
  if (texts.length !== 1) return undefined;
  const text = texts[0]!.trim();
  const n = text === '' ? NaN : Number(text);
  return Number.isFinite(n) && n >= ELE_MIN && n <= ELE_MAX ? n : undefined;
}

/**
 * Parses one continuous ride: exactly one track with exactly one non-empty segment.
 * A SAX stream (S2): only the points of gpx/trk/trkseg/trkpt are kept, so memory grows with the
 * points, never with other elements; the point cap stops the stream early.
 */
export function parseGpx(bytes: Uint8Array): Track {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new GpxError('GPX_INVALID');
  }

  const stack: string[] = [];
  const points: LngLat[] = [];
  const elevations: (number | undefined)[] = [];
  let tracks = 0;
  let filledSegments = 0;
  let segmentHasPoints = false;
  let eles: string[] | null = null; // the <ele> texts of the open trkpt
  let eleText: string | null = null; // the text of the open <ele>

  const sax = new SaxesParser();
  sax.on('doctype', () => {
    throw new GpxError('GPX_INVALID');
  });
  sax.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (RESERVED.has(name) || Object.keys(tag.attributes).some((key) => RESERVED.has(localName(key)))) throw new GpxError('GPX_INVALID');
    if (stack.length === 0 && name !== 'gpx') throw new GpxError('GPX_INVALID');
    stack.push(name);
    const depth = stack.length; // gpx = 1, trk = 2, trkseg = 3, trkpt = 4, ele = 5
    if (depth > MAX_DEPTH) throw new GpxError('GPX_INVALID');
    if (depth === 2 && name === 'trk' && ++tracks > 1) throw new GpxError('GPX_MULTI_SEGMENT');
    if (depth === 3 && name === 'trkseg' && stack[1] === 'trk') segmentHasPoints = false;
    if (depth === 4 && name === 'trkpt' && stack[2] === 'trkseg' && stack[1] === 'trk') {
      if (!segmentHasPoints && ++filledSegments > 1) throw new GpxError('GPX_MULTI_SEGMENT');
      segmentHasPoints = true;
      if (points.length === MAX_POINTS) throw new GpxError('GPX_TOO_LARGE');
      const attributes = Object.fromEntries(Object.entries(tag.attributes).map(([k, v]) => [localName(k), v]));
      const lat = coordinate(attributes.lat);
      const lng = coordinate(attributes.lon);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new GpxError('GPX_INVALID');
      if (lng < PERU.minLng || lng > PERU.maxLng || lat < PERU.minLat || lat > PERU.maxLat) throw new GpxError('GPX_OUT_OF_AREA');
      points.push({ lat, lng });
      eles = [];
    }
    if (depth === 5 && name === 'ele' && eles) eleText = '';
  });
  sax.on('text', (chunk) => {
    if (eleText !== null) eleText += chunk;
  });
  sax.on('closetag', () => {
    const name = stack.pop();
    if (stack.length === 4 && name === 'ele' && eleText !== null) {
      eles?.push(eleText);
      eleText = null;
    }
    if (stack.length === 3 && name === 'trkpt' && eles) {
      elevations.push(elevation(eles));
      eles = null;
    }
  });

  try {
    sax.write(text).close();
  } catch (error) {
    // A malformed document, an undefined entity, a closed root followed by text: a 400 without a cause.
    if (error instanceof GpxError) throw error;
    throw new GpxError('GPX_INVALID');
  }
  if (points.length < 2) throw new GpxError('GPX_EMPTY');
  const usable = elevations.filter((ele): ele is number => ele !== undefined);
  return { text, points, elevations: usable.length === points.length ? usable : null };
}
