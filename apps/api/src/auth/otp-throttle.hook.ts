import { APIError, createAuthMiddleware, formCsrfMiddleware } from 'better-auth/api';
import { z } from 'zod';
import type { OtpMailer } from './mailer.js';
import type { OtpThrottle } from './otp-throttle.js';

export const SEND_OTP_PATH = '/email-otp/send-verification-otp';

// The send endpoint's own body rules (better-auth email-otp routes): lower-cased, not trimmed.
const sendBody = z.object({
  email: z.string(),
  type: z.enum(['email-verification', 'sign-in', 'forget-password', 'change-email']),
});

/**
 * `hooks.before` for the whole auth router:
 * - `/sign-in/social` refuses an `idToken` body (Phase 0 supports only the redirect flow).
 * - the OTP send path runs the CSRF check, then the cooldown and cap, then grants a send permit.
 */
export function authBeforeHook(throttle: OtpThrottle, mailer: OtpMailer) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/sign-in/social') {
      if (isRecord(ctx.body) && ctx.body.idToken !== undefined) throw new APIError('BAD_REQUEST', { message: 'Bad request' });
      return;
    }
    if (ctx.path !== SEND_OTP_PATH) return;

    // The endpoint checks the origin only after this hook; without this call a cross-origin
    // request would use the victim's cooldown slot and then get its 403.
    await formCsrfMiddleware(ctx);

    const parsed = sendBody.safeParse(ctx.body);
    if (!parsed.success) return; // the endpoint answers its own 400
    const email = parsed.data.email.toLowerCase();
    if (!z.email().safeParse(email).success) return;

    if (parsed.data.type !== 'sign-in') return ctx.json({ success: true });
    if ((await throttle.tryAcquire(email)) !== 'allowed') return ctx.json({ success: true });
    if (ctx.request) mailer.grantPermit(ctx.request, email);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
