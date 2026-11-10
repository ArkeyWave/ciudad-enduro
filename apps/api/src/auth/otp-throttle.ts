import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../db/db.provider.js';
import { otpSendLog } from '../db/schema/otp-send-log.js';
import { hmacSha256 } from './otp-hash.js';

export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_GLOBAL_CAP_PER_DAY = 50;

export type AcquireResult = 'allowed' | 'cooldown' | 'global_cap';

/** Per-address cooldown and global daily cap for OTP mails. Every time comparison uses the database clock. */
@Injectable()
export class OtpThrottle {
  private readonly logger = new Logger('OtpThrottle');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async tryAcquire(email: string): Promise<AcquireResult> {
    const emailHash = hmacSha256(this.env.OTP_HMAC_SECRET, email.toLowerCase());
    const result = await this.db.transaction(async (tx) => {
      // Serializes concurrent sends, so two requests cannot both pass the checks below.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('otp_send'))`);
      const counts = await tx.execute<{ global: number; mine: number }>(sql`
        select count(*)::int as global,
               count(*) filter (where ${otpSendLog.emailHash} = ${emailHash}
                                  and ${otpSendLog.createdAt} > now() - make_interval(secs => ${OTP_COOLDOWN_SECONDS}))::int as mine
        from ${otpSendLog}
        where ${otpSendLog.createdAt} > now() - interval '24 hours'`);
      const row = counts.rows[0] ?? { global: 0, mine: 0 };
      if (row.global >= OTP_GLOBAL_CAP_PER_DAY) return 'global_cap';
      if (row.mine > 0) return 'cooldown';
      await tx.insert(otpSendLog).values({ emailHash });
      return 'allowed';
    });
    if (result === 'global_cap') this.logger.warn(JSON.stringify({ event: 'otp_global_cap_reached' }));
    return result;
  }
}
