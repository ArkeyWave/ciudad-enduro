// OTP codes the e2e API (apps/api/test/support/e2e-main.ts) appends to E2E_CODES_FILE, one JSON
// line `{"to","otp"}` per mail. Read from disk: the codes never travel over HTTP.
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CODES_FILE = join(tmpdir(), `ciudad-enduro-e2e-codes-${process.env.TEST_DB_SUFFIX ?? 'main'}.jsonl`);

/** Every code mailed to `email`, oldest first. */
export function codesFor(email: string): string[] {
  if (!existsSync(CODES_FILE)) return [];
  return readFileSync(CODES_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; otp?: string })
    .filter((mail) => mail.to === email && mail.otp !== undefined)
    .map((mail) => mail.otp as string);
}
