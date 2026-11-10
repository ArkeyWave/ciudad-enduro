import type { Difficulty, TrailType } from 'api-client';

const DIFFICULTY_LABELS = {
  facil: 'Fácil',
  intermedio: 'Intermedio',
  dificil: 'Difícil',
} satisfies Record<Difficulty, string>;

const TRAIL_TYPE_LABELS = {
  descenso: 'Descenso',
  cross_country: 'Cross-country',
  urbano: 'Urbano',
} satisfies Record<TrailType, string>;

function lookup(labels: Record<string, string>, kind: string, slug: string): string {
  // Own keys only: a prototype key such as "toString" is not a label.
  if (!Object.hasOwn(labels, slug)) throw new Error(`Unknown ${kind}: ${slug}`);
  return labels[slug] as string;
}

export const difficultyLabel = (slug: Difficulty): string => lookup(DIFFICULTY_LABELS, 'difficulty', slug);
export const trailTypeLabel = (slug: TrailType): string => lookup(TRAIL_TYPE_LABELS, 'trail type', slug);
