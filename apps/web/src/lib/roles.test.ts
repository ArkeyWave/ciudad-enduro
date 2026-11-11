import { describe, expect, it } from 'vitest';
import { isAdmin } from './roles';

describe('isAdmin', () => {
  it.each(['admin', 'rider,admin', 'rider, admin'])('is true for the role %j', (role) => {
    expect(isAdmin({ role })).toBe(true);
  });

  it.each(['rider', 'administrator', 'rider,superadmin', ''])('is false for the role %j', (role) => {
    expect(isAdmin({ role })).toBe(false);
  });

  it('is false when nobody is signed in', () => {
    expect(isAdmin(null)).toBe(false);
  });
});
