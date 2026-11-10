import { createHmac } from 'node:crypto';

/** Keyed hash for OTP codes and e-mail addresses at rest. Hex output. */
export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}
