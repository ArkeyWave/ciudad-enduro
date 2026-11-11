// Trails seeded for the e2e run: two published, one draft that must never appear.
export interface SeedTrail {
  slug: string;
  name: string;
  status: 'published' | 'draft';
}

export const PUBLISHED: SeedTrail[] = [
  { slug: 'e2e-cerro-chimbote', name: 'Cerro de la Juventud', status: 'published' },
  { slug: 'e2e-quebrada-trujillo', name: 'Quebrada del Cóndor', status: 'published' },
];

/** prepare-db.ts inserts this user with role admin; the trails spec signs in as it. */
export const ADMIN_EMAIL = 'admin-e2e@example.com';

export const DRAFT: SeedTrail = { slug: 'e2e-borrador', name: 'Sendero Borrador', status: 'draft' };
