import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { prepareTestDatabase } from './global-setup.js';

const realConnect = (url: string) => new pg.Client({ connectionString: url });

describe('prepareTestDatabase guards', () => {
  it('refuses a remote host before opening any connection', async () => {
    const connect = vi.fn(realConnect);
    await expect(
      prepareTestDatabase('postgres://u:p@db.example.com:5432/ciudad_enduro', 'guard', connect),
    ).rejects.toThrow(/db\.example\.com/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses a ?host= override before opening any connection', async () => {
    const connect = vi.fn(realConnect);
    await expect(
      prepareTestDatabase('postgres://u:p@localhost:5432/x?host=db.example.com', 'guard', connect),
    ).rejects.toThrow(/query parameters/);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses an unsafe suffix before opening any connection', async () => {
    const connect = vi.fn(realConnect);
    await expect(prepareTestDatabase(process.env.DATABASE_URL, 'x; drop', connect)).rejects.toThrow(
      /TEST_DB_SUFFIX/,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('creates and migrates the database on localhost', async () => {
    const connect = vi.fn(realConnect);
    const url = await prepareTestDatabase(process.env.DATABASE_URL, 'guard_check', connect);
    expect(new URL(url).pathname).toBe('/ciudad_enduro_test_guard_check');

    const client = realConnect(url);
    await client.connect();
    try {
      const { rows } = await client.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
      expect(rows[0]?.n).toBeGreaterThan(0);
    } finally {
      await client.end();
    }

    const admin = realConnect(Object.assign(new URL(url), { pathname: '/postgres' }).href);
    await admin.connect();
    await admin.query('DROP DATABASE ciudad_enduro_test_guard_check WITH (FORCE)');
    await admin.end();
  });
});
