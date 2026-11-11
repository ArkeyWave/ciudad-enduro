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

/** prepare-db.ts gives PUBLISHED[1] these numbers; PUBLISHED[0] has none. */
export const PROFILED = {
  distanceM: 4200,
  gainM: 380,
  lossM: 410,
  start: { lat: -8.11, lng: -79.03 },
  profile: [
    [0, 120],
    [1000, 260],
    [2100, 410],
    [3200, 300],
    [4200, 90],
  ],
};

/** prepare-db.ts inserts this user with role admin; the trails spec signs in as it. */
export const ADMIN_EMAIL = 'admin-e2e@example.com';

export const DRAFT: SeedTrail = { slug: 'e2e-borrador', name: 'Sendero Borrador', status: 'draft' };
