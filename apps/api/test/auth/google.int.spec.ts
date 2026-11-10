import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestClient } from '../test-db.js';
import { GoogleStub, type GoogleClaims } from '../support/google-stub.js';
import { cookieHeader, createAuthTestApp, signInWithOtp, truncateAuth, WEB_ORIGIN, type AuthTestApp } from '../support/test-app.js';

let t: AuthTestApp;
let client: pg.Client;
const google = new GoogleStub();

beforeAll(async () => {
  google.install();
  t = await createAuthTestApp();
  client = await openTestClient();
});
afterAll(async () => {
  await client.end();
  await t.app.close();
  await google.uninstall();
});
beforeEach(async () => {
  await truncateAuth(client);
});
afterEach(() => {
  google.assertNoPending();
});

const count = async (table: string) => (await client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n;
const ERROR_PAGE = `${WEB_ORIGIN}/ingresar`;

type Started = { state: string; cookies: string };

async function start(body: Record<string, unknown> = {}): Promise<Started> {
  const res = await t.post('/api/auth/sign-in/social', {
    provider: 'google',
    callbackURL: `${WEB_ORIGIN}/`,
    errorCallbackURL: ERROR_PAGE,
    ...body,
  });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  return { state: new URL(url).searchParams.get('state') ?? '', cookies: cookieHeader(res) };
}

async function callback(started: Started, claims?: GoogleClaims) {
  if (claims) google.token(claims);
  const res = await t.get(`/api/auth/callback/google?code=google-code&state=${encodeURIComponent(started.state)}`, {
    cookie: started.cookies,
  });
  expect(res.status).toBe(302);
  return { location: new URL(res.headers.get('location') ?? ''), cookies: res.headers.getSetCookie() };
}

const signInGoogle = async (claims: GoogleClaims) => callback(await start(), claims);
const verified = (sub: string, email: string): GoogleClaims => ({ sub, email, email_verified: true });
const hasSession = (cookies: string[]) => cookies.some((c) => c.startsWith('better-auth.session_token=') && !/Max-Age=0/i.test(c));

describe('Google redirect flow', () => {
  it('creates the user and the account on a verified first sign-in and redirects to the web', async () => {
    const { location, cookies } = await signInGoogle(verified('G1', 'g1@x.pe'));
    expect(location.href).toBe(`${WEB_ORIGIN}/`);
    expect(hasSession(cookies)).toBe(true);
    const { rows } = await client.query<{ account_id: string; email: string }>(
      'select a.account_id, u.email from account a join "user" u on u.id = a.user_id',
    );
    expect(rows).toEqual([{ account_id: 'G1', email: 'g1@x.pe' }]);
  });

  it('keeps the same user when Google reports a changed e-mail for the same sub', async () => {
    await signInGoogle(verified('G1', 'g1@x.pe'));
    const { location } = await signInGoogle(verified('G1', 'changed@x.pe'));
    expect(location.href).toBe(`${WEB_ORIGIN}/`);
    expect(await count('"user"')).toBe(1);
    expect(await count('account')).toBe(1);
  });

  it('does not link Google to an existing email-code user', async () => {
    await signInWithOtp(t, 'r2@x.pe');
    const { location } = await signInGoogle(verified('G2', 'r2@x.pe'));
    expect(location.origin + location.pathname).toBe(ERROR_PAGE);
    expect(location.searchParams.get('error')).toBe('account_not_linked');
    expect(await count('"user"')).toBe(1);
    expect(await count(`account where provider_id = 'google'`)).toBe(0);
  });

  it('rejects a state that does not match and writes nothing', async () => {
    const started = await start();
    const res = await t.get('/api/auth/callback/google?code=google-code&state=forged-state', { cookie: started.cookies });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBeTruthy();
    expect(hasSession(res.headers.getSetCookie())).toBe(false);
    expect(await count('"user"')).toBe(0);
  });

  it('rejects a reused state', async () => {
    const started = await start();
    await callback(started, verified('G1', 'g1@x.pe'));
    const sessionsBefore = await count('session');
    const replay = await callback(started);
    expect(replay.location.searchParams.get('error')).toBeTruthy();
    expect(hasSession(replay.cookies)).toBe(false);
    expect(await count('session')).toBe(sessionsBefore);
  });
});

describe('Google e-mail must be verified (user.validateUserInfo)', () => {
  it('(a) redirects an unverified first sign-in to the error page and writes no user or account', async () => {
    const { location, cookies } = await signInGoogle({ sub: 'G3', email: 'g3@x.pe', email_verified: false });
    expect(location.origin + location.pathname).toBe(ERROR_PAGE);
    expect(location.searchParams.get('error')).toBe('google_email_unverified');
    expect(hasSession(cookies)).toBe(false);
    expect(await count('"user"')).toBe(0);
    expect(await count('account')).toBe(0);
  });

  it('(b) creates the user when the e-mail is verified', async () => {
    await signInGoogle(verified('G4', 'g4@x.pe'));
    expect(await count('"user"')).toBe(1);
  });

  it('(c) does not block an email-code sign-up', async () => {
    await signInWithOtp(t, 'otp-user@x.pe');
    const { rows } = await client.query<{ email: string }>('select email from "user"');
    expect(rows).toEqual([{ email: 'otp-user@x.pe' }]);
  });

  it('(d) rejects the next sign-in of an existing Google user whose e-mail is no longer verified', async () => {
    await signInGoogle(verified('G5', 'g5@x.pe'));
    const sessionsBefore = await count('session');
    const { location, cookies } = await signInGoogle({ sub: 'G5', email: 'g5@x.pe', email_verified: false });
    expect(location.searchParams.get('error')).toBe('google_email_unverified');
    expect(hasSession(cookies)).toBe(false);
    expect(await count('session')).toBe(sessionsBefore);
  });
});

describe('ID-token sign-in is refused', () => {
  it('answers 400 to an idToken body and writes nothing', async () => {
    const res = await t.post('/api/auth/sign-in/social', { provider: 'google', idToken: { token: 'x.y.z' } });
    expect(res.status).toBe(400);
    expect(await count('"user"')).toBe(0);
  });

  it('answers the same request without idToken with the redirect URL', async () => {
    const res = await t.post('/api/auth/sign-in/social', { provider: 'google' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ redirect: true, url: expect.stringContaining('accounts.google.com') as string });
  });
});

describe('Google tokens are never stored', () => {
  const tokens = async () =>
    (await client.query('select access_token, refresh_token, id_token from account')).rows as Record<string, unknown>[];
  const NO_TOKENS = { access_token: null, refresh_token: null, id_token: null };

  it('leaves the token columns null after the first sign-in', async () => {
    await signInGoogle(verified('G6', 'g6@x.pe'));
    expect(await tokens()).toEqual([NO_TOKENS]);
  });

  it('leaves the token columns null after a second sign-in', async () => {
    await signInGoogle(verified('G6', 'g6@x.pe'));
    await signInGoogle(verified('G6', 'g6@x.pe'));
    expect(await tokens()).toEqual([NO_TOKENS]);
  });
});
