// Recreates and seeds the e2e database. Playwright runs it in the API webServer command,
// because webServer starts before globalSetup. Run with Node's native type stripping.
import pg from 'pg';
import { prepareTestDatabase } from '../../api/test/global-setup.ts';
import { ADMIN_EMAIL, DRAFT, PROFILED, PUBLISHED } from './fixtures.ts';

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
  // The profiled trail: numbers for the card and the detail stats, a start of its own.
  await client.query(
    `UPDATE trails SET city = 'Trujillo', department = 'La Libertad', difficulty = 'dificil', type = 'cross_country',
            distance_m = $2, elevation_gain_m = $3, elevation_loss_m = $4, elevation_profile = $5,
            start_point = ST_SetSRID(ST_MakePoint($6, $7), 4326)
      WHERE slug = $1`,
    [
      (PUBLISHED[1] as (typeof PUBLISHED)[number]).slug,
      PROFILED.distanceM,
      PROFILED.gainM,
      PROFILED.lossM,
      JSON.stringify(PROFILED.profile),
      PROFILED.start.lng,
      PROFILED.start.lat,
    ],
  );
  // No API changes a role, so the admin is inserted; it signs in through the real code flow.
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, role) VALUES ('e2e-admin', 'Admin E2E', $1, true, 'admin')`,
    [ADMIN_EMAIL],
  );
} finally {
  await client.end();
}
