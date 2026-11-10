import { Logger } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OtpMailer } from '../../src/auth/mailer.js';
import { openTestClient } from '../test-db.js';
import { createAuthTestApp, emailHash, sendOtp, truncateAuth, WEB_ORIGIN, type AuthTestApp } from '../support/test-app.js';

let t: AuthTestApp;
let client: pg.Client;

beforeAll(async () => {
  t = await createAuthTestApp();
  client = await openTestClient();
});
afterAll(async () => {
  await client.end();
  await t.app.close();
});
beforeEach(async () => {
  await truncateAuth(client);
  t.mails.length = 0;
  vi.restoreAllMocks();
});

const mailsTo = (email: string) => t.mails.filter((m) => m.to === email).length;
const logRows = async () => (await client.query<{ n: number }>('select count(*)::int as n from otp_send_log')).rows[0]?.n;
const insertSent = (email: string, age: string) =>
  client.query('insert into otp_send_log (email_hash, created_at) values ($1, now() - $2::interval)', [emailHash(email), age]);
const insertOthers = (count: number, age: string) =>
  client.query(
    'insert into otp_send_log (email_hash, created_at) select md5(i::text), now() - $2::interval from generate_series(1, $1::int) i',
    [count, age],
  );

// Status, every header except `date`, and the body: a throttled reply must be indistinguishable.
async function snapshot(res: Response) {
  const headers = [...res.headers.entries()].filter(([name]) => name !== 'date');
  return { status: res.status, headers, body: await res.text() };
}

describe('CSRF runs before the throttle', () => {
  it('refuses a hostile Origin without a cookie and uses no slot', async () => {
    const res = await sendOtp(t, 'csrf@x.pe', 'sign-in', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await logRows()).toBe(0);
    expect(mailsTo('csrf@x.pe')).toBe(0);
  });

  it('accepts the web origin', async () => {
    const res = await sendOtp(t, 'csrf@x.pe', 'sign-in', { origin: WEB_ORIGIN });
    expect(res.status).toBe(200);
    expect(await logRows()).toBe(1);
    expect(mailsTo('csrf@x.pe')).toBe(1);
  });
});

describe('the mailer is the enforcement point', () => {
  it('refuses to send without a permit and logs otp_send_without_permit', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const mailer = t.app.get(OtpMailer);
    await mailer.sendOtp('nopermit@x.pe', '123456', { request: new Request('http://localhost/x') });
    await mailer.sendOtp('nopermit@x.pe', '123456');
    expect(mailsTo('nopermit@x.pe')).toBe(0);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'otp_send_without_permit' }));
  });

  it('sends nothing when the permit is for another address', async () => {
    const mailer = t.app.get(OtpMailer);
    const request = new Request('http://localhost/x');
    mailer.grantPermit(request, 'a@x.pe');
    await mailer.sendOtp('b@x.pe', '123456', { request });
    expect(t.mails).toHaveLength(0);
  });

  it('uses a permit once', async () => {
    const mailer = t.app.get(OtpMailer);
    const request = new Request('http://localhost/x');
    mailer.grantPermit(request, 'a@x.pe');
    await mailer.sendOtp('a@x.pe', '123456', { request });
    await mailer.sendOtp('a@x.pe', '654321', { request });
    expect(t.mails).toHaveLength(1);
  });
});

describe('per-address cooldown (60 s, database clock)', () => {
  it('mails the first request, blocks at -59 s with a success-identical answer, mails again at -61 s', async () => {
    const real = await snapshot(await sendOtp(t, 'a@x.pe'));
    expect(real.status).toBe(200);
    expect(mailsTo('a@x.pe')).toBe(1);

    await client.query('truncate otp_send_log');
    await insertSent('a@x.pe', '59 seconds');
    const blocked = await snapshot(await sendOtp(t, 'a@x.pe'));
    expect(mailsTo('a@x.pe')).toBe(1);
    expect(blocked).toEqual(real);

    await client.query('truncate otp_send_log');
    await insertSent('a@x.pe', '61 seconds');
    expect((await sendOtp(t, 'a@x.pe')).status).toBe(200);
    expect(mailsTo('a@x.pe')).toBe(2);
  });

  it('is per address', async () => {
    await sendOtp(t, 'a@x.pe');
    await sendOtp(t, 'b@x.pe');
    expect(mailsTo('a@x.pe')).toBe(1);
    expect(mailsTo('b@x.pe')).toBe(1);
  });

  it('treats a different case as the same address', async () => {
    await sendOtp(t, 'a@x.pe');
    expect((await sendOtp(t, 'A@X.pe')).status).toBe(200);
    expect(t.mails).toHaveLength(1);
  });

  it('lets the endpoint reject an untrimmed address without using a slot', async () => {
    expect((await sendOtp(t, 'a@x.pe ')).status).toBe(400);
    expect(await logRows()).toBe(0);
    expect(t.mails).toHaveLength(0);
  });
});

describe('global cap (50 per 24 h)', () => {
  it('stops mailing a new address at 50 rows, answers success-shaped and logs the event', async () => {
    const real = await snapshot(await sendOtp(t, 'first@x.pe'));
    await client.query('truncate otp_send_log');
    await insertOthers(50, '1 hour');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const capped = await snapshot(await sendOtp(t, 'new@x.pe'));
    expect(mailsTo('new@x.pe')).toBe(0);
    expect(capped).toEqual(real);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'otp_global_cap_reached' }));
  });

  it('does not count a row older than 24 h', async () => {
    await insertOthers(49, '1 hour');
    await insertOthers(1, '24 hours 1 second');
    await sendOtp(t, 'new@x.pe');
    expect(mailsTo('new@x.pe')).toBe(1);
  });
});

describe('non sign-in types', () => {
  it.each(['forget-password', 'email-verification'])('%s: success shape, no mail, no row', async (type) => {
    const real = await snapshot(await sendOtp(t, 'first@x.pe'));
    await client.query('truncate otp_send_log');
    const res = await snapshot(await sendOtp(t, 'other@x.pe', type));
    expect(res).toEqual(real);
    expect(mailsTo('other@x.pe')).toBe(0);
    expect(await logRows()).toBe(0);
  });
});

describe('concurrency', () => {
  it('sends exactly one mail when two requests for one address race', async () => {
    // The holder takes the throttle's advisory lock and blocks inserts into otp_send_log. With the
    // lock, the requests run one after the other. Without it, both read zero rows, wait at the
    // insert, and both send.
    const holder = await openTestClient();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtext('otp_send'))`);
    await holder.query('lock table otp_send_log in exclusive mode');
    const both = Promise.all([sendOtp(t, 'race@x.pe'), sendOtp(t, 'race@x.pe')]);
    try {
      await waitForLockWaiters(2);
    } finally {
      await holder.query('commit');
      await holder.end();
    }
    const [r1, r2] = await both;
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await r1.text()).toBe(await r2.text());
    expect(mailsTo('race@x.pe')).toBe(1);
  });
});

it('stores no e-mail address in otp_send_log', async () => {
  await sendOtp(t, 'a@x.pe');
  const { rows } = await client.query<Record<string, unknown>>('select * from otp_send_log');
  expect(rows).toHaveLength(1);
  for (const value of Object.values(rows[0] ?? {})) expect(String(value)).not.toContain('@');
});

async function waitForLockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const { rows } = await client.query<{ n: number }>('select count(*)::int as n from pg_locks where not granted');
    if ((rows[0]?.n ?? 0) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`expected ${n} waiting locks`);
}
