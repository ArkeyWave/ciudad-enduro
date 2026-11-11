import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { format } from 'node:util';
import type { LoggerService } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trails } from '../src/db/schema/index.js';
import { openTestClient } from './test-db.js';
import { createAuthTestApp, signInWithOtp, truncateAuth, uniqueIp, WEB_ORIGIN, type AuthTestApp } from './support/test-app.js';

// Every line the app logs (M4: no GPX text may reach the logs).
const lines: string[] = [];
const captureLogger: LoggerService = {
  log: (...args: unknown[]) => void lines.push(format(...args)),
  error: (...args: unknown[]) => void lines.push(format(...args)),
  warn: (...args: unknown[]) => void lines.push(format(...args)),
  debug: (...args: unknown[]) => void lines.push(format(...args)),
  verbose: (...args: unknown[]) => void lines.push(format(...args)),
  fatal: (...args: unknown[]) => void lines.push(format(...args)),
};

let t: AuthTestApp;
let client: pg.Client;
let db: NodePgDatabase;
let admin: string;
let rider: string;

const FIXTURE = readFileSync(new URL('./fixtures/one-segment.gpx', import.meta.url), 'utf8');
/** The fixture with a different creator: other bytes, same ride. */
const variant = (n: number) => new TextEncoder().encode(FIXTURE.replace('Ciudad Enduro test', `Ciudad Enduro test ${n}`));
const fixtureBytes = new TextEncoder().encode(FIXTURE);

beforeAll(async () => {
  t = await createAuthTestApp({ logger: captureLogger });
  client = await openTestClient();
  db = drizzle(client);
  await truncateAuth(client);
  admin = await signInWithOtp(t, 'admin@x.pe');
  rider = await signInWithOtp(t, 'rider@x.pe');
  await client.query(`update "user" set role = 'admin' where email = 'admin@x.pe'`);
});
afterAll(async () => {
  await client.end();
  await t.app.close();
});
beforeEach(async () => {
  await client.query('TRUNCATE trails, trail_sources');
});

const fields = { name: 'Cerro de prueba', city: 'Chimbote', difficulty: 'intermedio', type: 'descenso' };

type Headers = Record<string, string>;
const as = (cookie: string | null, origin: string | null = WEB_ORIGIN): Headers => ({
  'cf-connecting-ip': uniqueIp(),
  ...(cookie ? { cookie } : {}),
  ...(origin ? { origin } : {}),
});

function upload(headers: Headers, values: Record<string, string> = fields, file: Uint8Array<ArrayBuffer> | null = fixtureBytes): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.append(key, value);
  if (file) form.append('gpx', new Blob([file]), 'ride.gpx');
  return fetch(`${t.url}/api/trails`, { method: 'POST', headers, body: form });
}

const patch = (slug: string, headers: Headers, body: unknown) =>
  fetch(`${t.url}/api/trails/${slug}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path: string, headers: Headers = as(null, null)) => fetch(`${t.url}/api${path}`, { headers });

async function seed(slug: string, status: 'draft' | 'published' | 'hidden' = 'draft') {
  await db.insert(trails).values({
    slug,
    name: slug,
    city: 'Chimbote',
    department: 'Ancash',
    difficulty: 'facil',
    type: 'urbano',
    status,
    startPoint: { lng: -78.52, lat: -9.09 },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
}

const count = async (table: string) => Number((await client.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe('POST /api/trails: who may upload', () => {
  it('answers 401 to an anonymous user', async () => {
    expect((await upload(as(null))).status).toBe(401);
  });

  it('answers 403 to a rider', async () => {
    expect((await upload(as(rider))).status).toBe(403);
  });

  it('answers 403 to an admin with a foreign or a missing Origin', async () => {
    expect((await upload(as(admin, 'https://other.vops.pe'))).status).toBe(403);
    expect((await upload(as(admin, null))).status).toBe(403);
    expect(await count('trails')).toBe(0);
  });

  it('checks the origin before it parses the multipart body', async () => {
    const seven = { ...fields, description: 'x', a: '1', b: '2' };
    expect((await upload(as(admin, 'https://other.vops.pe'), seven)).status).toBe(403);
  });
});

describe('POST /api/trails: import', () => {
  it('creates a draft with the metrics, the source and the author', async () => {
    const res = await upload(as(admin));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown> & { path: [number, number][]; elevationProfile: [number, number][] };
    expect(body).toMatchObject({
      slug: 'cerro-de-prueba',
      name: 'Cerro de prueba',
      status: 'draft',
      city: 'Chimbote',
      description: '',
      start: { lat: -9.09, lng: -78.52 },
      end: { lat: -9.095, lng: -78.52 },
      distanceM: 556,
      elevationGainM: 12,
      elevationLossM: 12,
      elevationMinM: 100,
      elevationMaxM: 112,
    });
    expect(body.elevationProfile).toEqual([
      [0, 100],
      [111, 104],
      [222, 108],
      [334, 112],
      [445, 106],
      [556, 100],
    ]);
    expect(body.path[0]).toEqual([-78.52, -9.09]);
    expect(body.path.at(-1)).toEqual([-78.52, -9.095]);

    const { rows } = await client.query<{ department: string; email: string; points: number; gpx: string; sha256: string }>(
      `select t.department, u.email, ST_NPoints(t.path) as points, s.gpx, s.sha256
         from trails t join "user" u on u.id = t.author_id join trail_sources s on s.trail_id = t.id`,
    );
    expect(rows).toEqual([
      { department: 'Ancash', email: 'admin@x.pe', points: 6, gpx: FIXTURE, sha256: createHash('sha256').update(fixtureBytes).digest('hex') },
    ]);
  });

  it('refuses an invalid GPX with its code', async () => {
    const res = await upload(as(admin), fields, new TextEncoder().encode('<gpx><trk>'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'GPX_INVALID' });
  });

  it('refuses a request without the file', async () => {
    expect((await upload(as(admin), fields, null)).status).toBe(400);
  });

  it('refuses 7 text fields in the multipart parser, and accepts 5', async () => {
    const res = await upload(as(admin), { ...fields, description: 'x', a: '1', b: '2' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/Too many (fields|parts)/);
    expect((await upload(as(admin), { ...fields, description: 'x' })).status).toBe(201);
  });

  it('answers 413 to a file above 10 MiB', async () => {
    const res = await upload(as(admin), fields, new Uint8Array(10 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(await count('trails')).toBe(0);
  });

  it('accepts a description of 2000 code points (8000 bytes) and refuses 2001', async () => {
    expect((await upload(as(admin), { ...fields, description: '🚵'.repeat(2001) }, variant(1))).status).toBe(400);
    expect((await upload(as(admin), { ...fields, description: '🚵'.repeat(2000) }, variant(2))).status).toBe(201);
  });

  it('answers 409 with the existing slug to the same file twice', async () => {
    expect((await upload(as(admin))).status).toBe(201);
    const res = await upload(as(admin), { ...fields, name: 'Otro nombre' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'GPX_DUPLICATE', slug: 'cerro-de-prueba' });
    expect(await count('trails')).toBe(1);
  });

  it('adds -2 on a slug collision', async () => {
    expect((await upload(as(admin))).status).toBe(201);
    const res = await upload(as(admin), fields, variant(1));
    expect(((await res.json()) as { slug: string }).slug).toBe('cerro-de-prueba-2');
  });

  it('never gives the reserved slug nueva', async () => {
    const res = await upload(as(admin), { ...fields, name: 'Nueva' });
    expect(((await res.json()) as { slug: string }).slug).toBe('nueva-2');
  });

  it('answers 409 SLUG_TAKEN after 5 tries', async () => {
    for (const slug of ['ruta', 'ruta-2', 'ruta-3', 'ruta-4', 'ruta-5']) await seed(slug);
    const res = await upload(as(admin), { ...fields, name: 'Ruta' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    expect(await count('trail_sources')).toBe(0);
  });

  it('refuses a name with no letter or digit (SLUG_EMPTY)', async () => {
    const res = await upload(as(admin), { ...fields, name: '🚵🚵' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'SLUG_EMPTY' });
  });

  it('logs a database error without the GPX text', async () => {
    await client.query(`create or replace function fail_source() returns trigger language plpgsql as $$ begin raise exception 'forced'; end $$`);
    await client.query('create trigger fail_source before insert on trail_sources for each row execute function fail_source()');
    try {
      lines.length = 0;
      const res = await upload(as(admin), fields, new TextEncoder().encode(FIXTURE.replace('<metadata>', '<metadata><desc>SOURCE-MARKER-7f3a</desc>')));
      expect(res.status).toBe(500);
      expect(lines.some((line) => line.includes('"event":"trail_create_failed"'))).toBe(true);
      expect(lines.filter((line) => line.includes('SOURCE-MARKER-7f3a') || line.includes('trkpt'))).toEqual([]);
    } finally {
      await client.query('drop trigger fail_source on trail_sources');
    }
  });
});

describe('GET /api/trails/:slug for an admin', () => {
  it('shows a draft to the admin and 404 to a rider and an anonymous user', async () => {
    await seed('borrador');
    const res = await get('/trails/borrador', as(admin, null));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'borrador', status: 'draft', elevationProfile: null, elevationLossM: null });
    expect((await get('/trails/borrador', as(rider, null))).status).toBe(404);
    expect((await get('/trails/borrador')).status).toBe(404);
  });

  it('shows a hidden trail to the admin and 404 to a rider', async () => {
    await seed('oculta', 'hidden');
    expect((await get('/trails/oculta', as(admin, null))).status).toBe(200);
    expect((await get('/trails/oculta', as(rider, null))).status).toBe(404);
  });
});

describe('PATCH /api/trails/:slug', () => {
  beforeEach(() => seed('borrador'));

  it('answers 401 to an anonymous user and 403 to a rider', async () => {
    expect((await patch('borrador', as(null), { status: 'published' })).status).toBe(401);
    expect((await patch('borrador', as(rider), { status: 'published' })).status).toBe(403);
  });

  it('answers 403 to an admin with a foreign or a missing Origin', async () => {
    expect((await patch('borrador', as(admin, 'https://other.vops.pe'), { status: 'published' })).status).toBe(403);
    expect((await patch('borrador', as(admin, null), { status: 'published' })).status).toBe(403);
    expect((await get('/trails/borrador')).status).toBe(404);
  });

  it('publishes a draft: it appears in the public list', async () => {
    const res = await patch('borrador', as(admin), { status: 'published' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'borrador', status: 'published' });
    const list = (await (await get('/trails')).json()) as { slug: string }[];
    expect(list.map((trail) => trail.slug)).toEqual(['borrador']);
  });

  it('changes the metadata and keeps the slug', async () => {
    const res = await patch('borrador', as(admin), { name: 'Nombre nuevo', description: 'Arena', difficulty: 'dificil', type: 'descenso' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'borrador', name: 'Nombre nuevo', description: 'Arena', difficulty: 'dificil', type: 'descenso' });
  });

  it('derives the department from the city', async () => {
    expect((await patch('borrador', as(admin), { city: 'Trujillo' })).status).toBe(200);
    const { rows } = await client.query<{ city: string; department: string; fresh: boolean }>(
      `select city, department, updated_at > '2026-01-02' as fresh from trails`,
    );
    expect(rows).toEqual([{ city: 'Trujillo', department: 'La Libertad', fresh: true }]);
  });

  it('refuses null, an empty body and an unknown field', async () => {
    expect((await patch('borrador', as(admin), { name: null })).status).toBe(400);
    expect((await patch('borrador', as(admin), {})).status).toBe(400);
    expect((await patch('borrador', as(admin), { slug: 'otro' })).status).toBe(400);
    expect((await patch('borrador', as(admin), { name: 'x'.repeat(81) })).status).toBe(400);
  });

  it('answers 404 to an unknown slug', async () => {
    expect((await patch('no-existe', as(admin), { status: 'published' })).status).toBe(404);
  });
});
