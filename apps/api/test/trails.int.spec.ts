import type { INestApplication } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trails } from '../src/db/schema/index.js';
import { createTestApp, openTestClient } from './test-db.js';

let app: INestApplication;
let client: pg.Client;
let db: NodePgDatabase;
let baseUrl: string;

beforeAll(async () => {
  app = await createTestApp();
  baseUrl = await app.getUrl();
  client = await openTestClient();
  db = drizzle(client);
});
afterAll(async () => {
  await client.end();
  await app.close();
});

const base = { department: 'Ancash', difficulty: 'intermedio', type: 'descenso', description: 'Roca suelta' } as const;

beforeEach(async () => {
  await client.query('TRUNCATE trails, trail_sources');
  await db.insert(trails).values([
    {
      ...base,
      slug: 'cerro-chimbote',
      name: 'Cerro Chimbote',
      city: 'Chimbote',
      status: 'published',
      startPoint: { lng: -78.52, lat: -9.09 },
      endPoint: { lng: -78.51, lat: -9.08 },
      path: [
        [-78.52, -9.09],
        [-78.51, -9.08],
      ],
      distanceM: 1200,
      elevationGainM: 80,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      ...base,
      slug: 'campana-trujillo',
      name: 'Campana Trujillo',
      city: 'Trujillo',
      status: 'published',
      startPoint: { lng: -79.03, lat: -8.11 },
      createdAt: new Date('2026-02-01T00:00:00Z'),
    },
    {
      ...base,
      slug: 'borrador',
      name: 'Borrador',
      city: 'Chimbote',
      status: 'draft',
      startPoint: { lng: -78.53, lat: -9.1 },
    },
  ]);
});

const get = (path: string) => fetch(`${baseUrl}/api${path}`);

describe('GET /api/trails', () => {
  it('lists published trails only, newest first', async () => {
    const res = await get('/trails');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string }[];
    expect(body.map((t) => t.slug)).toEqual(['campana-trujillo', 'cerro-chimbote']);
  });

  it('maps the start point to { lat, lng }', async () => {
    const body = (await (await get('/trails?city=Chimbote')).json()) as unknown[];
    expect(body).toEqual([
      {
        id: expect.any(String) as string,
        slug: 'cerro-chimbote',
        name: 'Cerro Chimbote',
        city: 'Chimbote',
        difficulty: 'intermedio',
        type: 'descenso',
        start: { lat: -9.09, lng: -78.52 },
        distanceM: 1200,
      },
    ]);
  });

  it('rejects an unknown city with 400', async () => {
    expect((await get('/trails?city=Lima')).status).toBe(400);
  });

  it('rejects an unknown query parameter with 400 and accepts the known one', async () => {
    expect((await get('/trails?city=Chimbote&foo=1')).status).toBe(400);
    expect((await get('/trails?city=Chimbote')).status).toBe(200);
  });
});

describe('GET /api/trails/:slug', () => {
  it('returns the detail of a published trail', async () => {
    const res = await get('/trails/cerro-chimbote');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      slug: 'cerro-chimbote',
      description: 'Roca suelta',
      start: { lat: -9.09, lng: -78.52 },
      end: { lat: -9.08, lng: -78.51 },
      path: [
        [-78.52, -9.09],
        [-78.51, -9.08],
      ],
      elevationGainM: 80,
    });
  });

  it('returns null end and path when they are absent', async () => {
    expect(await (await get('/trails/campana-trujillo')).json()).toMatchObject({ end: null, path: null });
  });

  it('answers a draft slug exactly like an unknown slug', async () => {
    const draft = await get('/trails/borrador');
    const unknown = await get('/trails/no-existe');
    expect(draft.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await draft.text()).toBe(await unknown.text());
  });

  // Postgres refuses U+0000 in a text parameter (22021): without the guard this was a 500.
  it('answers a slug with U+0000 like an unknown slug', async () => {
    const nul = await get('/trails/borr%00ador');
    const unknown = await get('/trails/no-existe');
    expect(nul.status).toBe(404);
    expect(await nul.text()).toBe(await unknown.text());
  });
});
