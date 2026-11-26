import { describe, expectTypeOf, test } from 'vitest';
import { createApiClient, type Coordinates, type District, type TrailDetail, type TrailPhoto, type TrailSummary } from '../src/index.js';

// Type-level contract checks. `pnpm typecheck` and `pnpm test` (vitest --typecheck) both
// run them through tsc; a broken assertion is a compile error, not a skipped test.
const client = createApiClient('http://localhost');

describe('trails contract', () => {
  test('GET /api/trails returns TrailSummary[]', async () => {
    const { data } = await client.GET('/api/trails');
    expectTypeOf(data).toEqualTypeOf<TrailSummary[] | undefined>();
  });

  test('the list filters by ubigeo, a plain string; the city filter is gone', async () => {
    await client.GET('/api/trails', { params: { query: { ubigeo: '021801' } } });
    // @ts-expect-error city is no longer a filter
    await client.GET('/api/trails', { params: { query: { city: 'Chimbote' } } });
  });

  test('a trail names its district', () => {
    expectTypeOf<TrailSummary['district']>().toEqualTypeOf<District>();
    expectTypeOf<District>().toEqualTypeOf<{ ubigeo: string; name: string; province: string; department: string }>();
  });

  test('a trail end point may be null', () => {
    expectTypeOf<TrailDetail['end']>().toEqualTypeOf<Coordinates | null>();
  });
});

describe('photos contract', () => {
  test('a trail detail lists its photos', () => {
    expectTypeOf<TrailDetail['photos']>().toEqualTypeOf<TrailPhoto[]>();
  });

  test('a photo heading and time may be null', () => {
    expectTypeOf<TrailPhoto['heading']>().toEqualTypeOf<number | null>();
    expectTypeOf<TrailPhoto['takenAt']>().toEqualTypeOf<string | null>();
  });
});
