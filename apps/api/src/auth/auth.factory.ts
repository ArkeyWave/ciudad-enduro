import { betterAuth } from 'better-auth';
import { buildAuthOptions, type AuthDeps } from './auth.options.js';

export function createAuth(deps: AuthDeps) {
  return betterAuth(buildAuthOptions(deps));
}

export type Auth = ReturnType<typeof createAuth>;
