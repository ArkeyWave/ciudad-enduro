import { bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// One row per OTP mail sent. The address is stored only as an HMAC (see otp-throttle.ts).
export const otpSendLog = pgTable(
  'otp_send_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    emailHash: text('email_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('otp_send_log_email_hash_created_at_idx').on(t.emailHash, t.createdAt), index('otp_send_log_created_at_idx').on(t.createdAt)],
);
