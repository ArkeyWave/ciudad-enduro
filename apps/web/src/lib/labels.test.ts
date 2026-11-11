import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Difficulty, TrailDetail, TrailType } from 'api-client';
import { CITIES, difficultyLabel, reviewLabel, statusLabel, trailTypeLabel } from './labels';

// The slugs come from the API contract, so a new enum value without a label fails here.
const contract = JSON.parse(
  readFileSync(new URL('../../../../packages/api-client/openapi.json', import.meta.url), 'utf8'),
) as { components: { schemas: Record<string, { enum: string[] }> } };
const slugs = (schema: string) => contract.components.schemas[schema]?.enum ?? [];

describe('labels', () => {
  it('has a contract to read', () => {
    expect(slugs('Difficulty')).toHaveLength(3);
    expect(slugs('TrailType')).toHaveLength(3);
  });

  it.each(slugs('Difficulty'))('difficulty %s has a label', (slug) => {
    expect(difficultyLabel(slug as Difficulty)).toMatch(/\S/);
  });

  it.each(slugs('TrailType'))('trail type %s has a label', (slug) => {
    expect(trailTypeLabel(slug as TrailType)).toMatch(/\S/);
  });

  it.each(slugs('TrailStatus'))('trail status %s has a label', (slug) => {
    expect(statusLabel(slug as TrailDetail['status'])).toMatch(/\S/);
  });

  // The upload and edit forms offer exactly the cities the API accepts.
  it('offers the cities of the contract', () => {
    expect([...CITIES]).toEqual(slugs('City'));
  });

  it('shows Spanish labels', () => {
    expect(difficultyLabel('dificil')).toBe('Difícil');
    expect(trailTypeLabel('cross_country')).toBe('Cross-country');
  });

  it.each(['extremo', 'toString'])('throws on the unknown slug %s', (slug) => {
    expect(() => difficultyLabel(slug as Difficulty)).toThrow(/Unknown difficulty/);
    expect(() => trailTypeLabel(slug as TrailType)).toThrow(/Unknown trail type/);
  });
});

describe('reviewLabel', () => {
  it('names a pending and a refused trail', () => {
    expect(reviewLabel('draft')).toBe('En revisión');
    expect(reviewLabel('hidden')).toBe('No aprobada');
  });
  it('gives a published trail no chip', () => {
    expect(reviewLabel('published')).toBeNull();
  });
});
