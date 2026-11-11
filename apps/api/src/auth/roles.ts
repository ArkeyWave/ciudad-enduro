/**
 * The role rule of the adapter's @Roles guard (`matchesRequiredRole`, @thallesp/nestjs-better-auth
 * 2.8.0 dist/index.mjs): a role is an array or a comma list. Code that checks a role itself uses
 * this, so a route and the guard never disagree.
 */
export function hasRole(role: unknown, required: readonly string[]): boolean {
  const roles = Array.isArray(role) ? role : typeof role === 'string' ? role.split(',').map((r) => r.trim()) : [];
  return roles.some((r) => typeof r === 'string' && required.includes(r));
}
