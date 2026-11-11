import type { IncomingMessage } from 'node:http';
import { HttpException, HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Auth } from '../auth/auth.factory.js';
import { hasRole } from '../auth/roles.js';

export const UPLOAD_ATTEMPTS = 10;
export const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

/**
 * Upload attempts per user in a sliding window. Every attempt counts, also a refused one.
 * ponytail: per-process memory; with more than one API instance each has its own count (move it to
 * Postgres when the API scales out). A restart clears it.
 */
@Injectable()
export class UploadAttempts {
  private readonly attempts = new Map<string, number[]>();

  /** Records an attempt; false when the user already has UPLOAD_ATTEMPTS in the window. */
  take(userId: string, now = Date.now()): boolean {
    const recent = (this.attempts.get(userId) ?? []).filter((at) => now - at < UPLOAD_WINDOW_MS);
    const allowed = recent.length < UPLOAD_ATTEMPTS;
    if (allowed) recent.push(now);
    this.attempts.set(userId, recent);
    return allowed;
  }

  clear(): void {
    this.attempts.clear();
  }
}

/** A route guard: it runs before the FileInterceptor, so a throttled upload is never parsed. Admins pass. */
@Injectable()
export class UploadThrottleGuard implements CanActivate {
  constructor(private readonly uploads: UploadAttempts) {}

  canActivate(context: ExecutionContext): boolean {
    const { session } = context.switchToHttp().getRequest<IncomingMessage & { session?: UserSession<Auth> }>();
    if (!session || hasRole(session.user.role, ['admin'])) return true;
    if (this.uploads.take(session.user.id)) return true;
    throw new HttpException({ code: 'TOO_MANY_UPLOADS', message: 'TOO_MANY_UPLOADS' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
