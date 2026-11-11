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
