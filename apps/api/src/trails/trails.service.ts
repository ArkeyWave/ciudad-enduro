import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider.js';
import { trails, type City } from '../db/schema/index.js';
import type { CoordinatesDto, TrailDetailDto, TrailSummaryDto } from './dto/trail.dto.js';

// Geo columns are read through PostGIS functions, never as raw driver values.
const summaryColumns = {
  id: trails.id,
  slug: trails.slug,
  name: trails.name,
  city: trails.city,
  difficulty: trails.difficulty,
  type: trails.type,
  distanceM: trails.distanceM,
  startX: sql<number>`ST_X(${trails.startPoint})`,
  startY: sql<number>`ST_Y(${trails.startPoint})`,
};

type SummaryRow = Omit<TrailSummaryDto, 'start'> & { startX: number; startY: number };

const point = (x: number, y: number): CoordinatesDto => ({ lat: y, lng: x });

function toSummary({ startX, startY, ...row }: SummaryRow): TrailSummaryDto {
  return { ...row, start: point(startX, startY) };
}

@Injectable()
export class TrailsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listPublished(city?: City): Promise<TrailSummaryDto[]> {
    const rows = await this.db
      .select(summaryColumns)
      .from(trails)
      .where(and(eq(trails.status, 'published'), city ? eq(trails.city, city) : undefined))
      .orderBy(desc(trails.createdAt));
    return rows.map(toSummary);
  }

  async findPublished(slug: string): Promise<TrailDetailDto | undefined> {
    const [row] = await this.db
      .select({
        ...summaryColumns,
        description: trails.description,
        elevationGainM: trails.elevationGainM,
        endX: sql<number | null>`ST_X(${trails.endPoint})`,
        endY: sql<number | null>`ST_Y(${trails.endPoint})`,
        path: sql<{ coordinates: [number, number][] } | null>`ST_AsGeoJSON(${trails.path})::json`,
      })
      .from(trails)
      .where(and(eq(trails.slug, slug), eq(trails.status, 'published')));
    if (!row) return undefined;
    const { endX, endY, path, description, elevationGainM, ...summary } = row;
    return {
      ...toSummary(summary),
      description,
      elevationGainM,
      end: endX === null || endY === null ? null : point(endX, endY),
      path: path?.coordinates ?? null,
    };
  }
}
