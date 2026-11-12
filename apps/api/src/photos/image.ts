import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import exifr from 'exifr';
import sharp from 'sharp';
import type { LngLat } from '../db/types/geo.js';

// The photo pipeline of plan §9 V1 and V1b: type by magic bytes, the few EXIF fields the product
// uses, then a re-encode that keeps no metadata.

export type PhotoType = 'jpeg' | 'png' | 'webp';

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) => signature.every((byte, i) => bytes[at + i] === byte);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The type from the first bytes, never from the file name or the Content-Type. */
export function photoType(bytes: Uint8Array): PhotoType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  return null;
}

/** The EXIF fields kept in trail_photos (V1b); every other field is never read. */
export type PhotoExif = { takenAt: Date | null; position: LngLat | null; altitudeM: number | null; heading: number | null };

const NO_EXIF: PhotoExif = { takenAt: null, position: null, altitudeM: null, heading: null };
const PICK = [
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'GPSLatitude',
  'GPSLatitudeRef',
  'GPSLongitude',
  'GPSLongitudeRef',
  'GPSAltitude',
  'GPSAltitudeRef',
  'GPSImgDirection',
];
// ponytail: an EXIF time without OffsetTimeOriginal is read as Peru time (UTC−5, no DST): every
// trail is in Peru. A per-trail zone when the app leaves Peru.
const PERU_OFFSET = '-05:00';

type RawExif = {
  DateTimeOriginal?: unknown;
  OffsetTimeOriginal?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  GPSAltitude?: unknown;
  GPSAltitudeRef?: unknown;
  GPSImgDirection?: unknown;
};

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function takenAt(raw: unknown, offset: unknown): Date | null {
  const match = typeof raw === 'string' ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
  if (!match) return null;
  const zone = typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : PERU_OFFSET;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The kept EXIF fields of the original bytes; a missing or broken EXIF block is no data. */
export async function readExif(bytes: Uint8Array): Promise<PhotoExif> {
  let raw: RawExif | undefined;
  try {
    raw = (await exifr.parse(Buffer.from(bytes), { pick: PICK, reviveValues: false })) as RawExif | undefined;
  } catch {
    return NO_EXIF;
  }
  if (!raw) return NO_EXIF;
  const lat = finite(raw.latitude);
  const lng = finite(raw.longitude);
  const position = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const altitude = finite(raw.GPSAltitude);
  // GPSAltitudeRef 1 = below sea level.
  const below = raw.GPSAltitudeRef instanceof Uint8Array ? raw.GPSAltitudeRef[0] === 1 : raw.GPSAltitudeRef === 1;
  const heading = finite(raw.GPSImgDirection);
  return {
    takenAt: takenAt(raw.DateTimeOriginal, raw.OffsetTimeOriginal),
    position,
    altitudeM: altitude === null ? null : below ? -altitude : altitude,
    heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
  };
}

export const MAX_SIDE_PX = 1600;
export const THUMB_PX = 160;
/** Decompression-bomb guard: a 48 MP phone photo passes, a larger canvas is refused before decoding. */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Encodes at a time in this process: each may hold a decoded 50 MP image (~200 MB). */
export const MAX_ENCODES = 2;

let encoding = 0;
export const encodesRunning = () => encoding;

export type Encoded = { image: Buffer; thumb: Buffer; width: number; height: number };

const coded = (code: string, status: HttpStatus) => new HttpException({ code, message: code }, status);

/**
 * A WebP of at most MAX_SIDE_PX and a THUMB_PX square thumbnail. `.rotate()` applies the EXIF
 * orientation first; sharp writes no metadata unless `withMetadata`/`keepMetadata` is called, and
 * neither is (V1, V1b). More than MAX_ENCODES at a time → 503 ENCODE_BUSY; an image above
 * MAX_INPUT_PIXELS → 413 PHOTO_TOO_LARGE; bytes sharp cannot decode → 400 PHOTO_INVALID.
 */
export async function encodePhoto(bytes: Uint8Array): Promise<Encoded> {
  if (encoding >= MAX_ENCODES) throw new ServiceUnavailableException({ code: 'ENCODE_BUSY', message: 'ENCODE_BUSY' });
  encoding++;
  try {
    const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const full = await source
      .clone()
      .resize({ width: MAX_SIDE_PX, height: MAX_SIDE_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await source.clone().resize(THUMB_PX, THUMB_PX, { fit: 'cover' }).webp({ quality: 70 }).toBuffer();
    return { image: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw coded('PHOTO_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
    throw coded('PHOTO_INVALID', HttpStatus.BAD_REQUEST);
  } finally {
    encoding--;
  }
}
