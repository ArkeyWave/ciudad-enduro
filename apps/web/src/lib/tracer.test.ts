import { describe, expect, it } from 'vitest';
import { canMark, MAX_ACCURACY_M, MAX_FIX_AGE_MS, pathLengthM, readPoints, toGpx } from './tracer';

const A = { lat: -9.0745, lng: -78.5936 };
const B = { lat: -9.0755, lng: -78.5926 };

describe('toGpx', () => {
  it('writes one GPX 1.1 track with lat and lon in that order, no <ele> and no name', () => {
    const gpx = toGpx([A, B]);
    expect(gpx).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" /);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.match(/<trkpt lat="([^"]+)" lon="([^"]+)"\/>/g)).toEqual([
      '<trkpt lat="-9.074500" lon="-78.593600"/>',
      '<trkpt lat="-9.075500" lon="-78.592600"/>',
    ]);
    expect(gpx.match(/<trk>/g)).toHaveLength(1);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    expect(gpx).not.toContain('<ele>');
    expect(gpx).not.toContain('<name>');
  });

  it('refuses fewer than 2 points', () => {
    expect(() => toGpx([A])).toThrow();
    expect(() => toGpx([])).toThrow();
  });
});

describe('canMark (the accuracy and age gate)', () => {
  const NOW = 1_800_000_000_000;
  const fix = (accuracy: number, ageMs = 0) => ({ ...A, accuracy, at: NOW - ageMs });

  it('allows a fresh fix of 30 m or better, up to 10 s old', () => {
    expect(MAX_ACCURACY_M).toBe(30);
    expect(MAX_FIX_AGE_MS).toBe(10_000);
    expect(canMark(fix(5), NOW)).toBe(true);
    expect(canMark(fix(30), NOW)).toBe(true);
    expect(canMark(fix(8, 10_000), NOW)).toBe(true);
  });

  it('refuses no fix, a fix worse than 30 m, a fix without a number, or a fix 11 s old', () => {
    expect(canMark(null, NOW)).toBe(false);
    expect(canMark(fix(30.5), NOW)).toBe(false);
    expect(canMark(fix(Number.NaN), NOW)).toBe(false);
    expect(canMark(fix(8, 11_000), NOW)).toBe(false);
  });
});

describe('pathLengthM', () => {
  it('sums the legs', () => {
    expect(pathLengthM([A])).toBe(0);
    expect(pathLengthM([A, B, A])).toBeCloseTo(2 * pathLengthM([A, B]), 6);
    expect(Math.round(pathLengthM([A, B]))).toBe(156);
  });
});

describe('readPoints', () => {
  it('keeps a stored list of points and drops anything else', () => {
    expect(readPoints(JSON.stringify([A, B]))).toEqual([A, B]);
    expect(readPoints(null)).toEqual([]);
    expect(readPoints('not json')).toEqual([]);
    expect(readPoints(JSON.stringify({ lat: 1 }))).toEqual([]);
    expect(readPoints(JSON.stringify([A, { lat: 'x', lng: 2 }]))).toEqual([]);
  });
});
