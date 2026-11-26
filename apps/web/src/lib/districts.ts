// The district field of the trail forms (plan §10 L3-3, §10.1 A7) and the Explorar head line (A6).
import type { District } from 'api-client';
import type { Point } from './tracer';

export const districtLabel = (d: Pick<District, 'name' | 'province' | 'department'>) => `${d.name}, ${d.province}, ${d.department}`;

/** The value of the field; `locked` once it is saved or the rider chose or typed: no suggestion replaces it. */
export type Choice = { value: District | null; locked: boolean };

export const initialChoice = (saved?: District): Choice => ({ value: saved ?? null, locked: saved !== undefined });
export const suggest = (choice: Choice, district: District | undefined): Choice =>
  choice.locked || !district ? choice : { value: district, locked: false };
export const choose = (_: Choice, district: District): Choice => ({ value: district, locked: true });
export const edit = (choice: Choice): Choice => ({ ...choice, locked: true });

/** Where the suggestion comes from: the trail start first, else the device fix. */
export const suggestionPoint = (start: Point | null, fix: Point | null): Point | null => start ?? fix;

const MAX_NAMES = 3;

/** The distinct district names of the trails, in list order: at most three, then "y N más". */
export function districtLine(trails: { district: Pick<District, 'name'> }[]): string {
  const names = [...new Set(trails.map((t) => t.district.name))];
  const shown = names.slice(0, MAX_NAMES).join(' · ');
  return names.length > MAX_NAMES ? `${shown} y ${names.length - MAX_NAMES} más` : shown;
}

const attr = (tag: string, name: string) => {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1]?.trim();
  return value ? Number(value) : NaN;
};

/**
 * The first track point of a GPX text, for the suggestion only (the API parses the file itself).
 * shortcut: a regex, not an XML parser; a namespaced `<gpx:trkpt>` gives no suggestion.
 */
export function gpxStart(text: string): Point | null {
  const tag = /<trkpt\b[^>]*>/.exec(text)?.[0];
  if (!tag) return null;
  const lat = attr(tag, 'lat');
  const lng = attr(tag, 'lon');
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
