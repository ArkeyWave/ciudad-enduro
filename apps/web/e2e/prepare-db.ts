// Recreates and seeds the e2e database. Playwright runs it in the API webServer command,
// because webServer starts before globalSetup. Run with Node's native type stripping.
import pg from 'pg';
import { prepareTestDatabase } from '../../api/test/global-setup.ts';
import { DRAFT, PUBLISHED } from './fixtures.ts';

// Same guards as the API tests: localhost only, validated TEST_DB_SUFFIX.
const url = await prepareTestDatabase(process.env.DATABASE_URL, process.env.TEST_DB_SUFFIX);
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const trail of [...PUBLISHED, DRAFT]) {
    await client.query(
      `INSERT INTO trails (slug, name, city, department, difficulty, type, status, start_point)
       VALUES ($1, $2, 'Chimbote', 'Ancash', 'intermedio', 'descenso', $3,
               ST_SetSRID(ST_MakePoint(-78.52, -9.09), 4326))`,
      [trail.slug, trail.name, trail.status],
    );
  }
} finally {
  await client.end();
}
