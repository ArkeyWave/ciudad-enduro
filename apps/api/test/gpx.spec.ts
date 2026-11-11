import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { elevationChange, elevationProfile, haversineM, trackMetrics } from '../src/trails/gpx/metrics.js';
import { parseGpx, type GpxErrorCode } from '../src/trails/gpx/parse-gpx.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const bytes = (text: string) => new TextEncoder().encode(text);

/** A GPX document with one track and one segment of the given `<trkpt>` lines. */
function gpx(trkpts: string[], head = '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">'): Uint8Array {
  return bytes(`<?xml version="1.0"?>${head}<trk><trkseg>${trkpts.join('')}</trkseg></trk></gpx>`);
}
const pt = (lat: number, lon: number, ele?: string) => `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;

function codeOf(run: () => unknown): GpxErrorCode | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: GpxErrorCode }).code;
  }
  return undefined;
}

describe('parseGpx', () => {
  it('reads a file with a single trk and a single trkseg', () => {
    const track = parseGpx(fixture('one-segment.gpx'));
    expect(track.points).toHaveLength(6);
    expect(track.points[0]).toEqual({ lat: -9.09, lng: -78.52 });
    expect(track.points[5]).toEqual({ lat: -9.095, lng: -78.52 });
    expect(track.elevations).toEqual([100, 104, 108, 112, 106, 100]);
  });

  it('reads a file whose elements carry a namespace prefix', () => {
    const doc = `<?xml version="1.0"?><g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg>
      <g:trkpt lat="-9.09" lon="-78.52"><g:ele>10</g:ele></g:trkpt><g:trkpt lat="-9.1" lon="-78.52"><g:ele>20</g:ele></g:trkpt>
      </g:trkseg></g:trk></g:gpx>`;
    expect(parseGpx(bytes(doc))).toMatchObject({ points: [{ lat: -9.09 }, { lat: -9.1 }], elevations: [10, 20] });
  });

  it('refuses a point without a lat or a lon attribute, and accepts both present', () => {
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), '<trkpt lon="-78.52"></trkpt>'])))).toBe('GPX_INVALID');
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), '<trkpt lat="-9.1"></trkpt>'])))).toBe('GPX_INVALID');
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), '<trkpt lat="" lon="-78.52"></trkpt>'])))).toBe('GPX_INVALID');
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), pt(-9.1, -78.52)])))).toBeUndefined();
  });

  it('refuses malformed (truncated) XML', () => {
    const text = new TextDecoder().decode(fixture('one-segment.gpx'));
    expect(codeOf(() => parseGpx(bytes(text.slice(0, text.length - 20))))).toBe('GPX_INVALID');
  });

  it('refuses a DOCTYPE', () => {
    const doc = gpx([pt(-9.09, -78.52), pt(-9.1, -78.52)], '<!DOCTYPE gpx [<!ENTITY x "y">]><gpx>');
    expect(codeOf(() => parseGpx(doc))).toBe('GPX_INVALID');
    const lower = gpx([pt(-9.09, -78.52), pt(-9.1, -78.52)], '<!doctype gpx><gpx>');
    expect(codeOf(() => parseGpx(lower))).toBe('GPX_INVALID');
  });

  it('refuses bytes that are not UTF-8', () => {
    const good = gpx([pt(-9.09, -78.52), pt(-9.1, -78.52)]);
    const bad = new Uint8Array([...good.slice(0, 30), 0xff, 0xfe, ...good.slice(30)]);
    expect(codeOf(() => parseGpx(bad))).toBe('GPX_INVALID');
  });

  it('refuses a root that is not gpx', () => {
    expect(codeOf(() => parseGpx(bytes('<kml><trk><trkseg>' + pt(-9.09, -78.52) + pt(-9.1, -78.52) + '</trkseg></trk></kml>')))).toBe(
      'GPX_INVALID',
    );
  });

  it('refuses two segments or two tracks, and ignores an empty segment', () => {
    expect(codeOf(() => parseGpx(fixture('two-segments.gpx')))).toBe('GPX_MULTI_SEGMENT');
    const twoTracks = `<gpx><trk><trkseg>${pt(-9.09, -78.52)}${pt(-9.1, -78.52)}</trkseg></trk><trk><trkseg>${pt(-9.09, -78.52)}${pt(-9.1, -78.52)}</trkseg></trk></gpx>`;
    expect(codeOf(() => parseGpx(bytes(twoTracks)))).toBe('GPX_MULTI_SEGMENT');
    const withEmpty = `<gpx><trk><trkseg>${pt(-9.09, -78.52)}${pt(-9.1, -78.52)}</trkseg><trkseg></trkseg></trk></gpx>`;
    expect(parseGpx(bytes(withEmpty)).points).toHaveLength(2);
  });

  it('counts an empty second <trk/> as a second track', () => {
    const doc = `<gpx><trk><trkseg>${pt(-9.09, -78.52)}${pt(-9.1, -78.52)}</trkseg></trk><trk/></gpx>`;
    expect(codeOf(() => parseGpx(bytes(doc)))).toBe('GPX_MULTI_SEGMENT');
  });

  it('refuses a <trkpt/> without attributes between two valid points', () => {
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), '<trkpt/>', pt(-9.1, -78.52)])))).toBe('GPX_INVALID');
  });

  it('maps a parser exception to GPX_INVALID: 101 nested elements, a name constructor', () => {
    const two = `<trkseg>${pt(-9.09, -78.52)}${pt(-9.1, -78.52)}</trkseg>`;
    const nested = `<gpx><trk>${two}<extensions>${'<e>'.repeat(101)}${'</e>'.repeat(101)}</extensions></trk></gpx>`;
    const error = (() => {
      try {
        parseGpx(bytes(nested));
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toMatchObject({ code: 'GPX_INVALID' });
    expect(error?.cause).toBeUndefined();
    expect(codeOf(() => parseGpx(bytes(`<gpx><trk>${two}<constructor>1</constructor></trk></gpx>`)))).toBe('GPX_INVALID');
    expect(codeOf(() => parseGpx(bytes(`<gpx constructor="1"><trk>${two}</trk></gpx>`)))).toBe('GPX_INVALID');
  });

  it('refuses 1 point and accepts 2', () => {
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52)])))).toBe('GPX_EMPTY');
    expect(codeOf(() => parseGpx(bytes('<gpx></gpx>')))).toBe('GPX_EMPTY');
    expect(parseGpx(gpx([pt(-9.09, -78.52), pt(-9.1, -78.52)])).points).toHaveLength(2);
  });

  it('refuses 100 001 points and accepts 100 000', () => {
    const points = Array.from({ length: 100_000 }, (_, i) => pt(-9 - i * 1e-6, -78.52));
    expect(parseGpx(gpx(points)).points).toHaveLength(100_000);
    expect(codeOf(() => parseGpx(gpx([...points, pt(-9.2, -78.52)])))).toBe('GPX_TOO_LARGE');
  });

  // S2: padding and fake <trkpt> tokens outside gpx/trk/trkseg cost nothing but scan time.
  const padding = `<extensions>${'<e/>'.repeat(250_000)}</extensions>`;
  const two = (head: string) => gpx([pt(-9.09, -78.52, '10'), `<trkpt lat="-9.1" lon="-78.52"><ele>20</ele>${padding}</trkpt>`], head);

  it('parses a file with fake <trkpt> tokens in a comment and 250 000 empty elements to its 2 points', () => {
    const head = `<gpx><!-- ${'<trkpt/>'.repeat(10_800)} -->`;
    expect(parseGpx(two(head))).toMatchObject({ points: [{ lat: -9.09 }, { lat: -9.1 }], elevations: [10, 20] });
  });

  it('parses a file with fake <trkpt> tokens in <metadata> and 250 000 empty elements to its 2 points', () => {
    const head = `<gpx><metadata>${'<trkpt/>'.repeat(10_800)}</metadata>`;
    expect(parseGpx(two(head)).points).toHaveLength(2);
  });

  it('parses 2.4 million empty elements (9.6 MB) inside a 48 MB heap: no object per element', () => {
    const script = fileURLToPath(new URL('./support/parse-padded.ts', import.meta.url));
    const run = spawnSync(process.execPath, ['--max-old-space-size=48', '--import', '@swc-node/register/esm-register', script, '2400000'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect({ status: run.status, out: run.stdout.trim() }).toEqual({ status: 0, out: '2' });
  }, 70_000);

  it('accepts the largest real shape: 100 000 Garmin points with 8 elements each', () => {
    const garmin = (i: number) =>
      `<trkpt lat="${-9 - i * 1e-6}" lon="-78.52"><ele>10</ele><time>2026-01-01T00:00:00Z</time><extensions><t:TrackPointExtension><t:hr>140</t:hr><t:cad>80</t:cad><t:atemp>20</t:atemp></t:TrackPointExtension></extensions></trkpt>`;
    expect(parseGpx(gpx(Array.from({ length: 100_000 }, (_, i) => garmin(i)))).points).toHaveLength(100_000);
  }, 30_000);

  it('refuses a point outside the Peru box, and accepts the box edge', () => {
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), pt(-34.6, -58.38)])))).toBe('GPX_OUT_OF_AREA');
    expect(codeOf(() => parseGpx(gpx([pt(-9.09, -78.52), pt(-9.09, -68.5)])))).toBe('GPX_OUT_OF_AREA');
    expect(parseGpx(gpx([pt(-9.09, -78.52), pt(-18.4, -68.6)])).points).toHaveLength(2);
  });

  it('returns no elevations when one point has no ele, an empty ele or an ele out of range', () => {
    expect(parseGpx(fixture('no-ele.gpx')).elevations).toBeNull();
    expect(parseGpx(gpx([pt(-9.09, -78.52, '100'), pt(-9.1, -78.52)])).elevations).toBeNull();
    expect(parseGpx(gpx([pt(-9.09, -78.52, '100'), '<trkpt lat="-9.1" lon="-78.52"><ele/></trkpt>'])).elevations).toBeNull();
    expect(parseGpx(gpx([pt(-9.09, -78.52, '100'), pt(-9.1, -78.52, '7001')])).elevations).toBeNull();
    expect(parseGpx(gpx([pt(-9.09, -78.52, '-500'), pt(-9.1, -78.52, '7000')])).elevations).toEqual([-500, 7000]);
  });
});

describe('metrics', () => {
  it('measures a known two-point distance (1° of latitude)', () => {
    expect(haversineM({ lat: -9, lng: -78 }, { lat: -8, lng: -78 })).toBeCloseTo(111_195.08, 1);
  });

  // Plan M11: extrema hysteresis, T = 5. Every counted leg is at least T.
  it.each([
    [[100, 104, 108, 112], 12, 0],
    [[100, 104, 108, 112, 106, 100], 12, 12],
    [[100, 103, 100, 103, 100], 0, 0],
    [[100, 110, 100], 10, 10],
    [[100, 110, 100, 110], 20, 10],
    [[100, 105], 5, 0],
    [[100, 104], 0, 0],
    [[100, 102, 90], 0, 10],
    [[100, 96, 92, 88, 94, 100], 12, 12],
    // Not in M11: a dip below T inside a climb is not a reversal (kills "confirm on any reversal step").
    [[100, 110, 108, 120], 20, 0],
  ])('elevation %j → gain %i, loss %i', (eles, gainM, lossM) => {
    expect(elevationChange(eles)).toEqual({ gainM, lossM });
  });

  it('keeps at most 300 profile points, with the first, the last, the min and the max', () => {
    const cum = Array.from({ length: 10_000 }, (_, i) => i * 3);
    const eles = cum.map((_, i) => 200 + 50 * Math.sin(i / 300));
    eles[1234] = 10;
    eles[5678] = 900;
    const profile = elevationProfile(cum, eles);
    expect(profile.length).toBeLessThanOrEqual(300);
    expect(profile.length).toBeGreaterThan(290);
    expect(profile).toContainEqual([0, 200]);
    expect(profile).toContainEqual([cum[9999], Math.round(eles[9999]! * 10) / 10]);
    expect(profile).toContainEqual([1234 * 3, 10]);
    expect(profile).toContainEqual([5678 * 3, 900]);
    const xs = profile.map(([x]) => x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('gives a flat profile and zero change for a flat track', () => {
    const metrics = trackMetrics(
      [
        { lat: -9.09, lng: -78.52 },
        { lat: -9.1, lng: -78.52 },
        { lat: -9.11, lng: -78.52 },
      ],
      [100, 100, 100],
    );
    expect(metrics).toMatchObject({ elevationGainM: 0, elevationLossM: 0 });
    expect(metrics.elevationProfile?.every(([, y]) => y === 100)).toBe(true);
  });

  it('measures the fixture: one source for the distance and the profile x axis', () => {
    const { points, elevations } = parseGpx(fixture('one-segment.gpx'));
    const metrics = trackMetrics(points, elevations);
    // 5 steps of 0.001° of latitude: 5 × 111.195 m.
    expect(metrics.distanceM).toBe(556);
    expect(metrics.elevationGainM).toBe(12);
    expect(metrics.elevationLossM).toBe(12);
    expect(metrics.elevationProfile?.at(-1)).toEqual([556, 100]);
  });

  it('gives null elevation outputs without elevations', () => {
    const { points, elevations } = parseGpx(fixture('no-ele.gpx'));
    expect(trackMetrics(points, elevations)).toMatchObject({ elevationGainM: null, elevationLossM: null, elevationProfile: null });
  });

  it('refuses a track of zero total distance', () => {
    const same = { lat: -9.09, lng: -78.52 };
    expect(codeOf(() => trackMetrics([same, same], null))).toBe('GPX_EMPTY');
  });
});
