import { doublePrecision, index, integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pointGeog } from '../types/geo.js';
import { user } from './auth.js';
import { trails, trailStatusEnum } from './trails.js';

// A "vista" (plan §9 V1–V4): a photo on a trail. Status has the trail meanings (draft = "En
// revisión"). Of the upload's EXIF only taken_at, exif_position, altitude_m and heading are kept
// (V1b); the stored WebP files carry no metadata and the original is never stored.
export const trailPhotos = pgTable(
  'trail_photos',
  {
    id: uuid('id').primaryKey(),
    trailId: uuid('trail_id')
      .notNull()
      .references(() => trails.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    status: trailStatusEnum('status').notNull().default('draft'),
    /** The position used for the trail link: the phone's, else the EXIF one (V2). */
    position: pointGeog('position').notNull(),
    /** 0 at the trail start, 1 at its end: the timeline order (V3). */
    lineFraction: doublePrecision('line_fraction').notNull(),
    exifPosition: pointGeog('exif_position'),
    altitudeM: real('altitude_m'),
    /** GPSImgDirection, degrees from north. */
    heading: real('heading'),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    imageKey: text('image_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('trail_photos_trail_id_idx').on(table.trailId), index('trail_photos_author_status_idx').on(table.authorId, table.status)],
);
