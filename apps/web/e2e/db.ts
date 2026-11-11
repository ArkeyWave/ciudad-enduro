import pg from 'pg';

/** ciudad_enduro_test_<TEST_DB_SUFFIX>, the database e2e/prepare-db.ts recreates. */
export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5434/ciudad_enduro');
  url.pathname = `/ciudad_enduro_test_${process.env.TEST_DB_SUFFIX ?? 'main'}`;
  return url.href;
}

/** Runs `body` with every published trail hidden, then publishes them again. */
export async function withNoPublishedTrails(body: () => Promise<void>) {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  const { rows } = await client.query<{ id: string }>(`UPDATE trails SET status = 'hidden' WHERE status = 'published' RETURNING id`);
  try {
    await body();
  } finally {
    await client.query(`UPDATE trails SET status = 'published' WHERE id = ANY($1::uuid[])`, [rows.map((row) => row.id)]);
    await client.end();
  }
}
