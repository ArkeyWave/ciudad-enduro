import { describe, expect, it } from 'vitest';
import { hasRole } from '../src/auth/roles.js';

// The same rule as the adapter's @Roles (matchesRequiredRole): a comma list or an array of roles.
describe('hasRole', () => {
  it('accepts admin alone, in a comma list with spaces, and in an array', () => {
    expect(hasRole('admin', ['admin'])).toBe(true);
    expect(hasRole('rider, admin', ['admin'])).toBe(true);
    expect(hasRole(['rider', 'admin'], ['admin'])).toBe(true);
  });

  it('refuses another role, a longer name, an empty or a missing role', () => {
    expect(hasRole('rider', ['admin'])).toBe(false);
    expect(hasRole('administrator', ['admin'])).toBe(false);
    expect(hasRole('', ['admin'])).toBe(false);
    expect(hasRole(undefined, ['admin'])).toBe(false);
    expect(hasRole(42, ['admin'])).toBe(false);
  });
});
