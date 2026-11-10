import type { IncomingMessage, ServerResponse } from 'node:http';

export const AUTH_BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Size guard for /api/auth/*. The adapter skips its body parsers on the auth routes and Better
 * Auth reads the body with no limit, so this runs first (the adapter's `middleware` option).
 * - Content-Length above the limit → 413.
 * - Any Transfer-Encoding → 413: a chunked body has no length to check, and no auth client needs it.
 * - No Content-Length and no Transfer-Encoding → the request has no body (RFC 9112 §6.3); it passes.
 */
export function authBodyLimit(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const length = Number(req.headers['content-length'] ?? 0);
  if (req.headers['transfer-encoding'] === undefined && length <= AUTH_BODY_LIMIT_BYTES) {
    next();
    return;
  }
  // Discard the unread body without buffering it, so the client gets the 413 and not a reset.
  req.resume();
  res.writeHead(413, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message: 'Payload Too Large' }));
}
