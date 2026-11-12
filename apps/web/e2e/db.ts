import pg from 'pg';

/** ciudad_enduro_test_<TEST_DB_SUFFIX>, the database e2e/prepare-db.ts recreates. */
export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/ciudad_enduro');
  url.pathname = `/ciudad_enduro_test_${process.env.TEST_DB_SUFFIX ?? 'main'}`;
  return url.href;
}

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** Hides every published trail; returns their ids for `publishAgain`. */
export const hidePublished = async () =>
  (await query<{ id: string }>(`UPDATE trails SET status = 'hidden' WHERE status = 'published' RETURNING id`)).map((row) => row.id);

export const publishAgain = (ids: string[]) => query(`UPDATE trails SET status = 'published' WHERE id = ANY($1::uuid[])`, [ids]);

/** A published trail with a line (`[lng, lat]` pairs), for the photo spec; its photos go with it. */
export const seedLineTrail = (slug: string, name: string, line: [number, number][]) =>
  query(
    `INSERT INTO trails (slug, name, city, department, difficulty, type, status, start_point, path, distance_m)
     VALUES ($1, $2, 'Chimbote', 'Ancash', 'facil', 'urbano', 'published',
             ST_SetSRID(ST_MakePoint($3, $4), 4326), ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), 1100)`,
    [slug, name, line[0]![0], line[0]![1], JSON.stringify({ type: 'LineString', coordinates: line })],
  );

/** Deletes a trail; its photos go with it (ON DELETE CASCADE). */
export const deleteTrail = (slug: string) => query('DELETE FROM trails WHERE slug = $1', [slug]);

/** No API changes a role: an admin of its own for a spec, inserted before its sign-in. */
export const insertAdmin = (email: string) =>
  query(`INSERT INTO "user" (id, name, email, email_verified, role) VALUES ($1, 'Admin', $2, true, 'admin')`, [`admin-${email}`, email]);
