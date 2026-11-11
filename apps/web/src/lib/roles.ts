import type { Me } from './api';

/**
 * The API's role rule (apps/api/src/auth/roles.ts, the adapter's @Roles guard): a role is a comma
 * list. The web shows the admin pages and controls only where the API also allows the admin calls.
 */
export const isAdmin = (me: Pick<Me, 'role'> | null): boolean =>
  me !== null && me.role.split(',').some((role) => role.trim() === 'admin');
