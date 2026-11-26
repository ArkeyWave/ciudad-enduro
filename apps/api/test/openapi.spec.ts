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

  it('documents /api/me with MeDto', () => {
    expect(okSchema('/api/me')?.content['application/json']?.schema).toEqual({ $ref: '#/components/schemas/MeDto' });
  });

  // Plan §10.1 A3: a code is a string with a pattern; a 1,892-member enum would reach the client types.
  const ubigeo = { type: 'string', pattern: '^[0-9]{6}$' };

  it('declares the ubigeo filter as a six-digit string, and no city filter', () => {
    const params = document.paths['/api/trails']?.get?.parameters ?? [];
    expect(params.find((p) => 'name' in p && p.name === 'ubigeo')).toMatchObject({ in: 'query', required: false, schema: ubigeo });
    expect(params.find((p) => 'name' in p && p.name === 'city')).toBeUndefined();
  });

  it('takes ubigeo on create and patch, and answers a district object', () => {
    const schemas = document.components?.schemas as Record<string, { properties: Record<string, unknown>; required?: string[] }>;
    expect(schemas.CreateTrailBody?.properties.ubigeo).toMatchObject(ubigeo);
    expect(schemas.CreateTrailBody?.required).toContain('ubigeo');
    expect(schemas.UpdateTrailDto?.properties.ubigeo).toMatchObject(ubigeo);
    expect(schemas.TrailSummaryDto?.properties.district).toEqual({ $ref: '#/components/schemas/DistrictDto' });
    expect(schemas.DistrictDto?.required).toEqual(['ubigeo', 'name', 'province', 'department']);
    expect(JSON.stringify(document)).not.toMatch(/"City"|"enum":\["0\d{5}"/);
  });

  it('takes an optional trail slug on the photo upload and documents 404 TRAIL_NOT_FOUND (plan §10.1 A8)', () => {
    const schemas = document.components?.schemas as Record<string, { properties: Record<string, unknown>; required?: string[] }>;
    expect(schemas.CreatePhotoBody?.properties.trail).toMatchObject({ type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' });
    expect(schemas.CreatePhotoBody?.required ?? []).not.toContain('trail');
    const notFound = document.paths['/api/photos']?.post?.responses['404'] as { description?: string } | undefined;
    expect(notFound?.description).toContain('TRAIL_NOT_FOUND');
  });
});
