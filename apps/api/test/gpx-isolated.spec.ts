import { describe, expect, it, vi } from 'vitest';
import { parseGpxIsolated, parseWorkersRunning } from '../src/trails/gpx/parse-gpx-isolated.js';
import type { GpxErrorCode } from '../src/trails/gpx/parse-gpx.js';

const MB = 1024 * 1024;
const N = 9_600_000; // bytes of padding: the shapes the round-3 review measured
const bytes = (text: string) => new TextEncoder().encode(text);
const attributes = Array.from({ length: 1_200_000 }, (_, i) => ` a${i.toString(36)}=""`).join('');

// Each shape makes saxes buffer one huge string (some 32 B of heap per input byte).
const shapes: [string, () => string, GpxErrorCode][] = [
  ['a comment', () => `<gpx><!--${'-x'.repeat(N / 2)}--></gpx>`, 'GPX_TOO_COMPLEX'],
  ['a text node of CRs', () => `<gpx><desc>${'\r'.repeat(N)}</desc></gpx>`, 'GPX_TOO_COMPLEX'],
  ['a DOCTYPE', () => `<!DOCTYPE gpx ${'""'.repeat(N / 2)}><gpx/>`, 'GPX_INVALID'],
  ['a CDATA section', () => `<gpx><desc><![CDATA[${']x'.repeat(N / 2)}]]></desc></gpx>`, 'GPX_TOO_COMPLEX'],
  ['a processing instruction', () => `<gpx><?pi ${'?x'.repeat(N / 2)}?></gpx>`, 'GPX_TOO_COMPLEX'],
  ['an attribute of TABs', () => `<gpx a="${'\t'.repeat(N)}"/>`, 'GPX_TOO_COMPLEX'],
  // The decoded text (2.4 MB) fits the worker heap: the parse ends, without points.
  ['2.4 million &lt;', () => `<gpx><desc>${'&lt;'.repeat(N / 4)}</desc></gpx>`, 'GPX_EMPTY'],
  ['1.2 million attributes', () => `<gpx${attributes}/>`, 'GPX_TOO_COMPLEX'],
];

async function codeOf(file: Uint8Array): Promise<string | undefined> {
  return parseGpxIsolated(file).then(
    () => undefined,
    (error: { code?: string }) => error.code ?? 'NOT_A_GPX_ERROR',
  );
}

describe('parseGpxIsolated (B1)', () => {
  for (const [name, doc, code] of shapes) {
    it(`refuses ${name} with 400 ${code}, outside the API heap`, async () => {
      const file = bytes(doc());
      const before = process.memoryUsage().heapUsed;
      expect(await codeOf(file)).toBe(code);
      expect(process.memoryUsage().heapUsed - before).toBeLessThan(32 * MB);
    }, 30_000);
  }

  it('parses 2.4 million empty elements to the 2 points: no object per element', async () => {
    const padding = `<extensions>${'<e/>'.repeat(N / 4)}</extensions>`;
    const doc = `<gpx><trk><trkseg><trkpt lat="-9.09" lon="-78.52"/><trkpt lat="-9.1" lon="-78.52">${padding}</trkpt></trkseg></trk></gpx>`;
    expect((await parseGpxIsolated(bytes(doc))).points).toHaveLength(2);
  }, 30_000);

  it('accepts the largest real shape: 100 000 Garmin points with 8 elements each', async () => {
    const garmin = (i: number) =>
      `<trkpt lat="${-9 - i * 1e-6}" lon="-78.52"><ele>10</ele><time>2026-01-01T00:00:00Z</time><extensions><t:TrackPointExtension><t:hr>140</t:hr><t:cad>80</t:cad><t:atemp>20</t:atemp></t:TrackPointExtension></extensions></trkpt>`;
    const doc = `<gpx><trk><trkseg>${Array.from({ length: 100_000 }, (_, i) => garmin(i)).join('')}</trkseg></trk></gpx>`;
    const track = await parseGpxIsolated(bytes(doc));
    expect(track.points).toHaveLength(100_000);
    expect(track.elevations).toHaveLength(100_000);
  }, 30_000);

  it('answers GPX_TOO_COMPLEX when the parse runs over the time cap, and keeps the caller bytes', async () => {
    const file = bytes(`<gpx><trk><trkseg><trkpt lat="-9.09" lon="-78.52"/><trkpt lat="-9.1" lon="-78.52"/></trkseg></trk></gpx>`);
    await expect(parseGpxIsolated(file, 1)).rejects.toMatchObject({ code: 'GPX_TOO_COMPLEX' });
    expect(file.byteLength).toBeGreaterThan(0);
    expect((await parseGpxIsolated(file)).points).toHaveLength(2);
  });

  const small = bytes(`<gpx><trk><trkseg><trkpt lat="-9.09" lon="-78.52"/><trkpt lat="-9.1" lon="-78.52"/></trkseg></trk></gpx>`);
  const allExited = () => vi.waitFor(() => expect(parseWorkersRunning()).toBe(0), { timeout: 10_000, interval: 20 });

  it('answers 503 PARSE_BUSY to a third parse while two run, and parses again once they exit', async () => {
    await allExited();
    const first = parseGpxIsolated(small);
    const second = parseGpxIsolated(small);
    await expect(parseGpxIsolated(small)).rejects.toMatchObject({ status: 503, response: { code: 'PARSE_BUSY' } });
    await Promise.all([first, second]);
    await allExited();
    expect((await parseGpxIsolated(small)).points).toHaveLength(2);
  });

  it('keeps the slot of a timed-out worker until it exits', async () => {
    await allExited();
    await expect(parseGpxIsolated(small, 1)).rejects.toMatchObject({ code: 'GPX_TOO_COMPLEX' });
    // The rejection arrives as a microtask; the exit event of the terminated worker comes later.
    expect(parseWorkersRunning()).toBe(1);
    await allExited();
  });

  it('passes a parse error code through', async () => {
    expect(await codeOf(bytes('<kml/>'))).toBe('GPX_INVALID');
    expect(await codeOf(bytes('<gpx></gpx>'))).toBe('GPX_EMPTY');
  });
});
