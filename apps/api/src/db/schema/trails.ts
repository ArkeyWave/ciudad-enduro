import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { lineStringGeom, pointGeom } from '../types/geo.js';
import { user } from './auth.js';

export const CITIES = ['Chimbote', 'Nuevo Chimbote', 'Trujillo'] as const;
export const DEPARTMENTS = ['Ancash', 'La Libertad'] as const;
export const DIFFICULTIES = ['facil', 'intermedio', 'dificil'] as const;
export const TRAIL_TYPES = ['descenso', 'cross_country', 'urbano'] as const;
export const TRAIL_STATUSES = ['draft', 'published', 'hidden'] as const;

export type City = (typeof CITIES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type TrailType = (typeof TRAIL_TYPES)[number];

export const cityEnum = pgEnum('city', CITIES);
export const departmentEnum = pgEnum('department', DEPARTMENTS);
export const difficultyEnum = pgEnum('difficulty', DIFFICULTIES);
export const trailTypeEnum = pgEnum('trail_type', TRAIL_TYPES);
export const trailStatusEnum = pgEnum('trail_status', TRAIL_STATUSES);

export const trails = pgTable('trails', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  city: cityEnum('city').notNull(),
  department: departmentEnum('department').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
  type: trailTypeEnum('type').notNull(),
  status: trailStatusEnum('status').notNull().default('draft'),
  startPoint: pointGeom('start_point').notNull(),
  endPoint: pointGeom('end_point'),
  path: lineStringGeom('path'),
  distanceM: integer('distance_m'),
  elevationGainM: integer('elevation_gain_m'),
  // A trail outlives its author's account.
  authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
