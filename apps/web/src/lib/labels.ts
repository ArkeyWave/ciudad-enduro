import type { City, Difficulty, TrailDetail, TrailType } from 'api-client';

type TrailStatus = TrailDetail['status'];

export const CITIES = ['Chimbote', 'Nuevo Chimbote', 'Trujillo'] as const satisfies readonly City[];

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

const STATUS_LABELS = {
  draft: 'Borrador',
  published: 'Publicada',
  hidden: 'Oculta',
} satisfies Record<TrailStatus, string>;

export const DIFFICULTIES = Object.keys(DIFFICULTY_LABELS) as Difficulty[];
export const TRAIL_TYPES = Object.keys(TRAIL_TYPE_LABELS) as TrailType[];

function lookup(labels: Record<string, string>, kind: string, slug: string): string {
  // Own keys only: a prototype key such as "toString" is not a label.
  if (!Object.hasOwn(labels, slug)) throw new Error(`Unknown ${kind}: ${slug}`);
  return labels[slug] as string;
}

export const difficultyLabel = (slug: Difficulty): string => lookup(DIFFICULTY_LABELS, 'difficulty', slug);
export const trailTypeLabel = (slug: TrailType): string => lookup(TRAIL_TYPE_LABELS, 'trail type', slug);
export const statusLabel = (slug: TrailStatus): string => lookup(STATUS_LABELS, 'trail status', slug);
