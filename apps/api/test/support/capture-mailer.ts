import type { MailMessage, MailTransport } from '../../src/auth/mailer.js';

export type CapturedMail = MailMessage & { otp: string };

/** Test-only mail transport: records every message and its 6-digit code. */
export function captureTransport(): { mails: CapturedMail[]; transport: MailTransport } {
  const mails: CapturedMail[] = [];
  // Records synchronously, before any await, so a backgrounded send is visible at once.
  const transport: MailTransport = (message) => {
    mails.push({ ...message, otp: /\b\d{6}\b/.exec(message.text)?.[0] ?? '' });
    return Promise.resolve();
  };
  return { mails, transport };
}
