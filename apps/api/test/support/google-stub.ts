import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from 'undici';

// Stubs Google's token endpoint. The redirect flow only decodes the ID token it receives there
// (google.mjs:118-126), so an unsigned JWT is enough.

// `email_verified` is optional so a test can send a token without the claim.
export type GoogleClaims = { sub: string; email: string; email_verified?: boolean; name?: string };

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function idToken(claims: GoogleClaims): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    iat: now,
    exp: now + 3600,
    name: 'Rider',
    ...claims,
  };
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;
}

export class GoogleStub {
  private readonly agent = new MockAgent();
  private previous: Dispatcher | undefined;

  install(): void {
    this.previous = getGlobalDispatcher();
    this.agent.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
    setGlobalDispatcher(this.agent);
  }

  async uninstall(): Promise<void> {
    if (this.previous) setGlobalDispatcher(this.previous);
    await this.agent.close();
  }

  /** Google's token endpoint answers the next code exchange with these claims. */
  token(claims: GoogleClaims): void {
    this.agent
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, {
        access_token: 'ya29.google-access-token',
        refresh_token: '1//google-refresh-token',
        id_token: idToken(claims),
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid email profile',
      });
  }

  /** Resend's API answers every send with a 500. */
  resendFails(): void {
    this.agent
      .get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(500, { name: 'internal_server_error', message: 'stubbed failure', statusCode: 500 })
      .persist();
  }

  assertNoPending(): void {
    this.agent.assertNoPendingInterceptors();
  }
}
