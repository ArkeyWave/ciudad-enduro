import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Difficulty, TrailType } from 'api-client';
import { difficultyLabel, trailTypeLabel } from './labels';

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

  it('shows Spanish labels', () => {
    expect(difficultyLabel('dificil')).toBe('Difícil');
    expect(trailTypeLabel('cross_country')).toBe('Cross-country');
  });

  it.each(['extremo', 'toString'])('throws on the unknown slug %s', (slug) => {
    expect(() => difficultyLabel(slug as Difficulty)).toThrow(/Unknown difficulty/);
    expect(() => trailTypeLabel(slug as TrailType)).toThrow(/Unknown trail type/);
  });
});
