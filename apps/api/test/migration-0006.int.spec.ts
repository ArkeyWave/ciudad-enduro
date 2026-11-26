import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from './test-db.js';

// Plan §10.1 A4: 0006 must map the trails that exist before it. A database of its own is migrated to
// 0005 (a copy of the folder with a truncated journal), gets one trail per city, then gets 0006.
const drizzleFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const url = new URL(testDatabaseUrl());
const name = `${url.pathname.slice(1)}_m6`;
const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).href });
const client = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: `/${name}` }).href });
let before: string;

beforeAll(async () => {
  before = mkdtempSync(join(tmpdir(), 'ce-0005-'));
  cpSync(drizzleFolder, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === '0006_districts'));
  writeFileSync(journalPath, JSON.stringify(journal));

  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await client.connect();
  await client.query('CREATE EXTENSION postgis');
  await migrate(drizzle(client), { migrationsFolder: before });
  for (const [slug, city, department] of [
    ['chimbote', 'Chimbote', 'Ancash'],
    ['nuevo', 'Nuevo Chimbote', 'Ancash'],
    ['trujillo', 'Trujillo', 'La Libertad'],
  ]) {
    await client.query(
      `insert into trails (slug, name, city, department, difficulty, type, start_point)
       values ($1, $1, $2, $3, 'facil', 'urbano', ST_SetSRID(ST_MakePoint(-78.5, -9.1), 4326))`,
      [slug, city, department],
    );
  }
  await migrate(drizzle(client), { migrationsFolder: drizzleFolder });
});

afterAll(async () => {
  await client.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  rmSync(before, { recursive: true, force: true });
});

describe('migration 0006_districts', () => {
  it('maps the three cities of existing trails to their district codes', async () => {
    const { rows } = await client.query<{ slug: string; ubigeo: string }>('select slug, ubigeo from trails order by slug');
    expect(rows).toEqual([
      { slug: 'chimbote', ubigeo: '021801' },
      { slug: 'nuevo', ubigeo: '021809' },
      { slug: 'trujillo', ubigeo: '130101' },
    ]);
  });

  it('drops the city and department columns and their enums', async () => {
    const columns = await client.query("select column_name from information_schema.columns where table_name = 'trails' and column_name in ('city', 'department')");
    expect(columns.rows).toEqual([]);
    const types = await client.query("select typname from pg_type where typname in ('city', 'department')");
    expect(types.rows).toEqual([]);
  });

  it('refuses a code that is not six digits, and a missing one', async () => {
    await expect(client.query("update trails set ubigeo = '02180a' where slug = 'chimbote'")).rejects.toThrow(/trails_ubigeo_format/);
    await expect(client.query("update trails set ubigeo = null where slug = 'chimbote'")).rejects.toThrow(/not-null/);
  });
});
