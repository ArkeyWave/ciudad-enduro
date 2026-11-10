import type { OpenAPIObject } from '@nestjs/swagger';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let document: OpenAPIObject;

beforeAll(async () => {
  // Emission must not read the env or touch the database, neither at import time nor in a
  // provider: with no valid env, loadEnv() throws, and the database is unreachable. The
  // module is imported only after the env is gone.
  vi.stubEnv('NODE_ENV', undefined);
  vi.stubEnv('BETTER_AUTH_SECRET', undefined);
  vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:1/none');
  try {
    const { createOpenApiDocument } = await import('../src/openapi.js');
    document = await createOpenApiDocument();
  } finally {
    vi.unstubAllEnvs();
  }
});

const okSchema = (path: string) =>
  document.paths[path]?.get?.responses['200'] as { content: Record<string, { schema: unknown }> } | undefined;

describe('OpenAPI document', () => {
  it('lists the trail routes under the /api prefix', () => {
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(['/api/trails', '/api/trails/{slug}']));
    expect(document.paths).not.toHaveProperty('/trails');
  });

  it('references the DTOs in the 200 responses', () => {
    expect(okSchema('/api/trails')?.content['application/json']?.schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/TrailSummaryDto' },
    });
    expect(okSchema('/api/trails/{slug}')?.content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/TrailDetailDto',
    });
  });

  it('declares city as an enum of the three cities', () => {
    const city = document.paths['/api/trails']?.get?.parameters?.find((p) => 'name' in p && p.name === 'city');
    expect(city).toMatchObject({ in: 'query', required: false, schema: { $ref: '#/components/schemas/City' } });
    expect(document.components?.schemas?.City).toEqual({
      type: 'string',
      enum: ['Chimbote', 'Nuevo Chimbote', 'Trujillo'],
    });
  });
});
