import { describe, expect, it } from 'vitest';
import { canMark, MAX_ACCURACY_M, pathLengthM, readPoints, toGpx } from './tracer';

const A = { lat: -9.0745, lng: -78.5936 };
const B = { lat: -9.0755, lng: -78.5926 };

describe('toGpx', () => {
  it('writes one GPX 1.1 track with lat and lon in that order and no <ele>', () => {
    const gpx = toGpx([A, B], 'Bajada');
    expect(gpx).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" /);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.match(/<trkpt lat="([^"]+)" lon="([^"]+)"\/>/g)).toEqual([
      '<trkpt lat="-9.074500" lon="-78.593600"/>',
      '<trkpt lat="-9.075500" lon="-78.592600"/>',
    ]);
    expect(gpx.match(/<trk>/g)).toHaveLength(1);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    expect(gpx).not.toContain('<ele>');
  });

  it('escapes the name', () => {
    const gpx = toGpx([A, B], `<Cerro> & "El" 'Alto'`);
    expect(gpx).toContain('<name>&lt;Cerro&gt; &amp; &quot;El&quot; &apos;Alto&apos;</name>');
    expect(gpx).not.toContain('<Cerro>');
  });

  it('refuses fewer than 2 points', () => {
    expect(() => toGpx([A], 'x')).toThrow();
    expect(() => toGpx([], 'x')).toThrow();
  });
});

describe('canMark (the accuracy gate)', () => {
  it('allows a fix of 30 m or better', () => {
    expect(MAX_ACCURACY_M).toBe(30);
    expect(canMark({ ...A, accuracy: 5 })).toBe(true);
    expect(canMark({ ...A, accuracy: 30 })).toBe(true);
  });

  it('refuses no fix, a fix worse than 30 m or a fix without a number', () => {
    expect(canMark(null)).toBe(false);
    expect(canMark({ ...A, accuracy: 30.5 })).toBe(false);
    expect(canMark({ ...A, accuracy: Number.NaN })).toBe(false);
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
