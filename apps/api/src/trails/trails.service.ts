import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider.js';
import { trails, trailSources, type City, type Department } from '../db/schema/index.js';
import type { CoordinatesDto, TrailDetailDto, TrailSummaryDto } from './dto/trail.dto.js';
import type { CreateTrailDto, UpdateTrailDto } from './dto/write-trail.dto.js';
import { trackMetrics } from './gpx/metrics.js';
import { parseGpx } from './gpx/parse-gpx.js';

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

// About 2 m: the display path drops redundant points; the stored path keeps full resolution.
const DISPLAY_TOLERANCE_DEG = sql.raw('0.00002');

const detailColumns = {
  ...summaryColumns,
  status: trails.status,
  description: trails.description,
  elevationGainM: trails.elevationGainM,
  elevationLossM: trails.elevationLossM,
  elevationProfile: trails.elevationProfile,
  endX: sql<number | null>`ST_X(${trails.endPoint})`,
  endY: sql<number | null>`ST_Y(${trails.endPoint})`,
  path: sql<{ coordinates: [number, number][] } | null>`ST_AsGeoJSON(ST_SimplifyPreserveTopology(${trails.path}, ${DISPLAY_TOLERANCE_DEG}))::json`,
};

type SummaryRow = Omit<TrailSummaryDto, 'start'> & { startX: number; startY: number };

const point = (x: number, y: number): CoordinatesDto => ({ lat: y, lng: x });

function toSummary({ startX, startY, ...row }: SummaryRow): TrailSummaryDto {
  return { ...row, start: point(startX, startY) };
}

const DEPARTMENT_OF: Record<City, Department> = { Chimbote: 'Ancash', 'Nuevo Chimbote': 'Ancash', Trujillo: 'La Libertad' };
/** The one place a department comes from (create and update). */
export const departmentOf = (city: City): Department => DEPARTMENT_OF[city];

const SLUG_MAX = 56; // room for a -N suffix
const SLUG_TRIES = 5;
// Web routes that a trail slug must not shadow.
const RESERVED_SLUGS = new Set(['nueva']);

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

const coded = (code: string, extra: Record<string, unknown> = {}) => ({ code, message: code, ...extra });

type PgCause = { code?: string; constraint?: string };
const pgCause = (error: unknown): PgCause | undefined => (error as { cause?: PgCause } | undefined)?.cause;

@Injectable()
export class TrailsService {
  private readonly logger = new Logger(TrailsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async listPublished(city?: City): Promise<TrailSummaryDto[]> {
    const rows = await this.db
      .select(summaryColumns)
      .from(trails)
      .where(and(eq(trails.status, 'published'), city ? eq(trails.city, city) : undefined))
      .orderBy(desc(trails.createdAt));
    return rows.map(toSummary);
  }

  /** A published trail, or any trail when `includeUnpublished` (admins). */
  async findBySlug(slug: string, includeUnpublished: boolean): Promise<TrailDetailDto | undefined> {
    const [row] = await this.db
      .select(detailColumns)
      .from(trails)
      .where(and(eq(trails.slug, slug), includeUnpublished ? undefined : eq(trails.status, 'published')));
    if (!row) return undefined;
    const { endX, endY, path, status, description, elevationGainM, elevationLossM, elevationProfile, ...summary } = row;
    // The profile keeps the global extrema (metrics.ts), so min/max come from it.
    const eles = elevationProfile?.map(([, ele]) => ele);
    return {
      ...toSummary(summary),
      status,
      description,
      end: endX === null || endY === null ? null : point(endX, endY),
      path: path?.coordinates ?? null,
      elevationGainM,
      elevationLossM,
      elevationMinM: eles ? Math.min(...eles) : null,
      elevationMaxM: eles ? Math.max(...eles) : null,
      elevationProfile,
    };
  }

  /** Stores a draft from a GPX upload. The source is private and never logged (plan D5, M4). */
  async createFromGpx(input: CreateTrailDto, authorId: string, bytes: Uint8Array): Promise<TrailDetailDto> {
    const track = parseGpx(bytes);
    const metrics = trackMetrics(track.points, track.elevations);
    const base = slugify(input.name);
    if (!base) throw new BadRequestException(coded('SLUG_EMPTY'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const candidates = Array.from({ length: SLUG_TRIES + 1 }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`))
      .filter((slug) => !RESERVED_SLUGS.has(slug))
      .slice(0, SLUG_TRIES);

    // Outside the transaction: a unique violation aborts it, so each try runs in a new one.
    for (const slug of candidates) {
      try {
        await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(trails)
            .values({
              slug,
              name: input.name,
              description: input.description ?? '',
              city: input.city,
              department: departmentOf(input.city),
              difficulty: input.difficulty,
              type: input.type,
              startPoint: track.points[0]!,
              endPoint: track.points.at(-1)!,
              path: track.points.map(({ lng, lat }) => [lng, lat]),
              authorId,
              ...metrics,
            })
            .returning({ id: trails.id });
          await tx.insert(trailSources).values({ trailId: row!.id, gpx: track.text, sha256 });
        });
      } catch (error) {
        const cause = pgCause(error);
        if (cause?.code === '23505' && cause.constraint === 'trails_slug_unique') continue;
        if (cause?.code === '23505' && cause.constraint === 'trail_sources_sha256_unique') {
          throw new ConflictException(coded('GPX_DUPLICATE', { slug: await this.slugOfSource(sha256) }));
        }
        // drizzle's error message carries the query parameters, i.e. the whole GPX: log codes only.
        this.logger.error(JSON.stringify({ event: 'trail_create_failed', code: cause?.code, constraint: cause?.constraint }));
        throw new InternalServerErrorException();
      }
      return (await this.findBySlug(slug, true))!;
    }
    throw new ConflictException(coded('SLUG_TAKEN'));
  }

  /** Changes the metadata; the slug never changes. Undefined when no trail has the slug. */
  async update(slug: string, input: UpdateTrailDto): Promise<TrailDetailDto | undefined> {
    if (Object.values(input).every((value) => value === undefined)) throw new BadRequestException('Nothing to update');
    const rows = await this.db
      .update(trails)
      .set({ ...input, ...(input.city ? { department: departmentOf(input.city) } : {}), updatedAt: new Date() })
      .where(eq(trails.slug, slug))
      .returning({ slug: trails.slug });
    return rows.length ? this.findBySlug(slug, true) : undefined;
  }

  private async slugOfSource(sha256: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ slug: trails.slug })
      .from(trailSources)
      .innerJoin(trails, eq(trails.id, trailSources.trailId))
      .where(eq(trailSources.sha256, sha256));
    return row?.slug;
  }
}
