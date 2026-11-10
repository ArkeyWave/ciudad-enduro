import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import type { Env } from '../config/env.js';

export type MailMessage = { to: string; subject: string; text: string };
export type MailTransport = (message: MailMessage) => Promise<void>;

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export function resendTransport(env: Env): MailTransport {
  const resend = new Resend(env.RESEND_API_KEY);
  return async (message) => {
    const { error } = await resend.emails.send({ from: env.EMAIL_FROM, ...message });
    // The error name only: the message could echo the recipient.
    if (error) throw new Error(`resend send failed: ${error.name}`);
  };
}

/**
 * Sends OTP mails, and only with a send permit. The throttle hook grants a one-use permit per
 * request after the cooldown and cap checks pass; this class, not the hook, is the enforcement
 * point, so a body the hook and the endpoint read differently can never send unthrottled mail.
 */
@Injectable()
export class OtpMailer {
  private readonly logger = new Logger('OtpMailer');
  private readonly permits = new WeakMap<Request, string>();

  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  grantPermit(request: Request, email: string): void {
    this.permits.set(request, email);
  }

  async sendOtp(email: string, otp: string, ctx?: { request?: Request | undefined }): Promise<void> {
    const request = ctx?.request;
    const permitted = request !== undefined && this.permits.get(request) === email;
    if (request) this.permits.delete(request);
    if (!permitted) {
      this.logger.warn(JSON.stringify({ event: 'otp_send_without_permit' }));
      return;
    }
    try {
      await this.transport({
        to: email,
        subject: 'Tu código para ingresar a Ciudad Enduro',
        text: `Tu código es ${otp}. Vence en 10 minutos. Si no lo pediste, ignora este correo.`,
      });
    } catch (error) {
      // Logged here, not in advanced.backgroundTasks.handler: Better Auth catches the send promise
      // before the handler sees it (create-context.mjs:217-218). Name only: the message could
      // carry the recipient.
      const name = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(JSON.stringify({ event: 'auth_background_task_failed', name }));
      throw error;
    }
  }
}
