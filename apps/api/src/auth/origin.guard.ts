import type { IncomingMessage } from 'node:http';
import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

/**
 * CSRF guard for the API's own mutations. SameSite=Lax still sends the session cookie on a
 * same-site POST from another *.vops.pe app, so the request must come from the web origin itself.
 * As a route guard it runs after the global auth guard and before any interceptor parses a body.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<IncomingMessage>().headers.origin === this.env.WEB_ORIGIN) return true;
    throw new ForbiddenException('Origin not allowed');
  }
}
