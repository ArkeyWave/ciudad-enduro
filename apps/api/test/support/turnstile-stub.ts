import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Stands in for Cloudflare's siteverify endpoint (better-auth posts JSON {secret, response,
// remoteip}). A token `stub~<action>~<hostname>~<nonce>` passes once and reports that action and
// hostname, as Cloudflare reports the widget's; any other token, or one seen before, fails
// (Cloudflare answers a reused token with `timeout-or-duplicate`).

export type SiteverifyCall = { secret?: string; response?: string; remoteip?: string };

export type TurnstileStub = {
  url: string;
  calls: SiteverifyCall[];
  /** Requests are accepted and never answered (a provider that hangs). */
  hang: boolean;
  close: () => Promise<void>;
};

/** A token the stub accepts once. Defaults match a send from the test web origin. */
export function turnstileToken({ action = 'send_code', hostname = 'localhost' } = {}): string {
  return `stub~${action}~${hostname}~${randomUUID()}`;
}

export function verdict(token: string | undefined, seen: Set<string>) {
  const parts = token?.split('~') ?? [];
  if (!token || parts.length !== 4 || parts[0] !== 'stub') return { success: false, 'error-codes': ['invalid-input-response'] };
  if (seen.has(token)) return { success: false, 'error-codes': ['timeout-or-duplicate'] };
  seen.add(token);
  return { success: true, action: parts[1], hostname: parts[2], 'error-codes': [] };
}

export async function startTurnstileStub(): Promise<TurnstileStub> {
  const seen = new Set<string>();
  const stub: TurnstileStub = { url: '', calls: [], hang: false, close: () => Promise.resolve() };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      const call = JSON.parse(body || '{}') as SiteverifyCall;
      stub.calls.push(call);
      if (stub.hang) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(verdict(call.response, seen)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/siteverify`;
  stub.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return stub;
}
