import { describe, expectTypeOf, test } from 'vitest';
import { createApiClient, type Coordinates, type TrailDetail, type TrailSummary } from '../src/index.js';

// Type-level contract checks. `pnpm typecheck` and `pnpm test` (vitest --typecheck) both
// run them through tsc; a broken assertion is a compile error, not a skipped test.
const client = createApiClient('http://localhost');

describe('trails contract', () => {
  test('GET /api/trails returns TrailSummary[]', async () => {
    const { data } = await client.GET('/api/trails');
    expectTypeOf(data).toEqualTypeOf<TrailSummary[] | undefined>();
  });

  test('city accepts only the three cities', async () => {
    await client.GET('/api/trails', { params: { query: { city: 'Chimbote' } } });
    // @ts-expect-error Lima is not a supported city
    await client.GET('/api/trails', { params: { query: { city: 'Lima' } } });
  });

  test('a trail end point may be null', () => {
    expectTypeOf<TrailDetail['end']>().toEqualTypeOf<Coordinates | null>();
  });
});
