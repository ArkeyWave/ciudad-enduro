import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trails } from '../src/db/schema/index.js';
import type { LngLat } from '../src/db/types/geo.js';
import { openTestClient } from './test-db.js';

let client: pg.Client;
let db: NodePgDatabase;

beforeAll(async () => {
  client = await openTestClient();
  db = drizzle(client);
});
afterAll(() => client.end());
beforeEach(() => client.query('TRUNCATE trails'));

const chimbote: LngLat = { lng: -78.52, lat: -9.09 };
let n = 0;

function insert(startPoint: LngLat, endPoint: LngLat | null = null) {
  n += 1;
  return db.insert(trails).values({
    slug: `t-${n}`,
    name: `Trail ${n}`,
    city: 'Chimbote',
    department: 'Ancash',
    difficulty: 'facil',
    type: 'urbano',
    startPoint,
    endPoint,
  });
}

/** The name of the constraint a failed insert violated (drizzle wraps the pg error). */
async function violatedConstraint(query: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await query.then(
    () => undefined,
    (e: unknown) => e,
  );
  return (error as { cause?: { constraint?: string } } | undefined)?.cause?.constraint;
}

describe('geo columns', () => {
  it('declare SRID 4326 in the column typmod', async () => {
    const { rows } = await client.query<{ start: number; end: number; path: number }>(
      `select Find_SRID('public','trails','start_point') as start,
              Find_SRID('public','trails','end_point') as end,
              Find_SRID('public','trails','path') as path`,
    );
    expect(rows[0]).toEqual({ start: 4326, end: 4326, path: 4326 });
  });

  it('write points and lines with SRID 4326', async () => {
    await db.insert(trails).values({
      slug: 'srid',
      name: 'SRID',
      city: 'Chimbote',
      department: 'Ancash',
      difficulty: 'facil',
      type: 'urbano',
      startPoint: chimbote,
      path: [
        [-78.52, -9.09],
        [-78.51, -9.08],
      ],
    });
    const { rows } = await client.query<{ srid: number; x: number; path_srid: number }>(
      'select ST_SRID(start_point) as srid, ST_X(start_point) as x, ST_SRID(path) as path_srid from trails',
    );
    expect(rows[0]).toEqual({ srid: 4326, x: -78.52, path_srid: 4326 });
  });

  it('reject a point with another SRID', async () => {
    await expect(
      client.query(
        `insert into trails (slug, name, city, department, difficulty, type, start_point)
         values ('srid3857', 'SRID 3857', 'Chimbote', 'Ancash', 'facil', 'urbano', ST_SetSRID(ST_MakePoint(-78.5, -9.1), 3857))`,
      ),
    ).rejects.toThrow(/does not match column SRID/);
  });

  it('store a point written with SRID 0 (unknown) as SRID 4326', async () => {
    await client.query(
      `insert into trails (slug, name, city, department, difficulty, type, start_point)
       values ('srid0', 'SRID 0', 'Chimbote', 'Ancash', 'facil', 'urbano', ST_SetSRID(ST_MakePoint(-78.5, -9.1), 0))`,
    );
    const { rows } = await client.query<{ srid: number }>('select ST_SRID(start_point) as srid from trails');
    expect(rows[0]?.srid).toBe(4326);
  });
});

describe('Peru bounding-box constraints', () => {
  it('accept a valid Peru start point with no end point', async () => {
    await expect(insert(chimbote)).resolves.toBeDefined();
  });

  it('accept a valid end point', async () => {
    await expect(insert(chimbote, { lng: -79.03, lat: -8.11 })).resolves.toBeDefined();
  });

  it('reject a start point with swapped axes', async () => {
    expect(await violatedConstraint(insert({ lng: chimbote.lat, lat: chimbote.lng }))).toBe('trails_start_in_peru');
  });

  it('reject an end point outside Peru', async () => {
    expect(await violatedConstraint(insert(chimbote, { lng: -58.38, lat: -34.6 }))).toBe('trails_end_in_peru');
  });
});
