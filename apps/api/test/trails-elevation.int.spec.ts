import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { format } from 'node:util';
import type { LoggerService } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { haversineM } from '../src/trails/gpx/metrics.js';
import { UploadAttempts } from '../src/trails/upload-throttle.js';
import { openTestClient } from './test-db.js';
import { createAuthTestApp, signInWithOtp, truncateAuth, uniqueIp, WEB_ORIGIN, type AuthTestApp } from './support/test-app.js';

// Plan §8 G5: a GPX without usable elevations gets them from the elevation API (a local stub here,
// never Open-Meteo), on a line densified to ≤ 10 m; any failure stores the trail without them.

type Mode = 'ok' | 'error' | 'short' | 'hang';
const stub = { mode: 'ok' as Mode, calls: [] as { lat: number[]; lng: number[] }[] };
let server: Server;

/** The stub's ground: 100 m at -8.11, rising 1 m per 0.0001° south. */
const groundAt = (lat: number) => Math.round((100 + (-8.11 - lat) * 10_000) * 10) / 10;

const lines: string[] = [];
const push = (...args: unknown[]) => void lines.push(format(...args));
const captureLogger: LoggerService = { log: push, error: push, warn: push, debug: push, verbose: push, fatal: push };

let t: AuthTestApp;
let client: pg.Client;
let admin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const query = new URL(req.url ?? '/', 'http://stub').searchParams;
    const lat = (query.get('latitude') ?? '').split(',').map(Number);
    const lng = (query.get('longitude') ?? '').split(',').map(Number);
    stub.calls.push({ lat, lng });
    if (stub.mode === 'hang') return;
    if (stub.mode === 'error') return void res.writeHead(500).end('{}');
    const elevation = lat.map(groundAt);
    if (stub.mode === 'short') elevation.pop();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ elevation }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ELEVATION_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/elevation`;
  t = await createAuthTestApp({ logger: captureLogger });
  client = await openTestClient();
  await truncateAuth(client);
  admin = await signInWithOtp(t, 'admin-ele@x.pe');
  await client.query(`update "user" set role = 'admin' where email = 'admin-ele@x.pe'`);
});
afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await client.end();
  await t.app.close();
});
beforeEach(async () => {
  await client.query('TRUNCATE trails, trail_sources');
  t.app.get(UploadAttempts).clear();
  stub.mode = 'ok';
  stub.calls = [];
  lines.length = 0;
});

const START = { lat: -8.11, lng: -79.03 };
const END = { lat: -8.128, lng: -79.03 }; // about 2 km south: 180 m higher on the stub's ground
/** Two points 2 km apart with no <ele>, as the web tracer writes them. */
const NO_ELE = new TextEncoder().encode(
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>` +
    `<trkpt lat="${START.lat}" lon="${START.lng}"/><trkpt lat="${END.lat}" lon="${END.lng}"/></trkseg></trk></gpx>`,
);
const WITH_ELE = new TextEncoder().encode(readFileSync(new URL('./fixtures/one-segment.gpx', import.meta.url), 'utf8'));

type Trail = {
  slug: string;
  distanceM: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  elevationMinM: number | null;
  elevationMaxM: number | null;
  elevationProfile: [number, number][] | null;
};

async function upload(file: Uint8Array<ArrayBuffer>): Promise<Trail> {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'Ruta trazada', city: 'Trujillo', difficulty: 'facil', type: 'descenso' })) {
    form.append(key, value);
  }
  form.append('gpx', new Blob([file]), 'ruta.gpx');
  const res = await fetch(`${t.url}/api/trails`, {
    method: 'POST',
    headers: { cookie: admin, origin: WEB_ORIGIN, 'cf-connecting-ip': uniqueIp() },
    body: form,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Trail;
}

describe('elevation fill (plan §8 G5)', () => {
  it('fills a GPX without elevations from the API on a line densified to ≤ 10 m, ≤ 100 points per call', async () => {
    const trail = await upload(NO_ELE);
    expect(trail.elevationGainM).toBe(180);
    expect(trail.elevationLossM).toBe(0);
    expect(trail.elevationMinM).toBe(100);
    expect(trail.elevationMaxM).toBe(280);
    expect(trail.elevationProfile!.length).toBeGreaterThan(2);
    expect(trail.elevationProfile!.at(-1)![0]).toBe(trail.distanceM);

    const lat = stub.calls.flatMap((call) => call.lat);
    const lng = stub.calls.flatMap((call) => call.lng);
    expect(stub.calls.length).toBeGreaterThan(1);
    for (const call of stub.calls) expect(call.lat.length).toBeLessThanOrEqual(100);
    expect(lat).toHaveLength(lng.length);
    expect(lat[0]).toBe(START.lat);
    expect(lat.at(-1)).toBe(END.lat);
    const gaps = lat.slice(1).map((value, i) => haversineM({ lat: lat[i]!, lng: lng[i]! }, { lat: value, lng: lng[i + 1]! }));
    // 10 m plus the rounding of the sent coordinates to 6 decimals (0.11 m each).
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10.25);
  });

  it('does not call the API when the GPX has its own elevations', async () => {
    const trail = await upload(WITH_ELE);
    expect(stub.calls).toHaveLength(0);
    expect(trail.elevationGainM).toBe(12);
  });

  it.each<Mode>(['error', 'short', 'hang'])('stores the trail without elevations when the API fails (%s)', async (mode) => {
    stub.mode = mode;
    const trail = await upload(NO_ELE);
    expect(stub.calls.length).toBeGreaterThan(0);
    expect(trail).toMatchObject({ elevationGainM: null, elevationLossM: null, elevationProfile: null, elevationMinM: null });
    expect(trail.distanceM).toBeGreaterThan(1900);
    const reason = { error: 'http_500', short: 'bad_answer', hang: 'TimeoutError' }[mode as 'error' | 'short' | 'hang'];
    const failed = lines.filter((line) => line.includes('elevation_fill_failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain(JSON.stringify({ event: 'elevation_fill_failed', reason }));
    expect(lines.join(' ')).not.toContain(process.env.ELEVATION_API_URL!);
  }, 15_000);
});
