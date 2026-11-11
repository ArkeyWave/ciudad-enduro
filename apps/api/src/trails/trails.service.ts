import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider.js';
import { trails, trailSources, user, type City, type Department, type TrailStatus } from '../db/schema/index.js';
import type { CoordinatesDto, MyTrailDto, QueueTrailDto, TrailDetailDto, TrailSummaryDto } from './dto/trail.dto.js';
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
  elevationGainM: trails.elevationGainM,
  elevationLossM: trails.elevationLossM,
  elevationProfile: trails.elevationProfile,
  startX: sql<number>`ST_X(${trails.startPoint})`,
  startY: sql<number>`ST_Y(${trails.startPoint})`,
};

// About 2 m: the display path drops redundant points; the stored path keeps full resolution.
const DISPLAY_TOLERANCE_DEG = sql.raw('0.00002');

const detailColumns = {
  ...summaryColumns,
  status: trails.status,
  description: trails.description,
  endX: sql<number | null>`ST_X(${trails.endPoint})`,
  endY: sql<number | null>`ST_Y(${trails.endPoint})`,
  path: sql<{ coordinates: [number, number][] } | null>`ST_AsGeoJSON(ST_SimplifyPreserveTopology(${trails.path}, ${DISPLAY_TOLERANCE_DEG}))::json`,
};

type SummaryRow = Omit<TrailSummaryDto, 'start'> & { startX: number; startY: number };

const point = (x: number, y: number): CoordinatesDto => ({ lat: y, lng: x });

function toSummary<R extends SummaryRow>({ startX, startY, ...row }: R): Omit<R, 'startX' | 'startY'> & { start: CoordinatesDto } {
  return { ...row, start: point(startX, startY) };
}

/** Drafts a non-admin may have waiting for review (plan R-D2). */
export const PENDING_LIMIT = 3;

/** Who reads a trail: an admin sees every trail; a signed-in user also sees their own unpublished ones. */
export type Viewer = { id: string | null; admin: boolean };
const ADMIN: Viewer = { id: null, admin: true };

/** First key of the two-key advisory lock on trail uploads: its own key space (otp-throttle uses one key). */
const UPLOAD_LOCK = sql.raw('7301');

const canSee = (viewer: Viewer, trail: { status: TrailStatus; authorId: string | null }) =>
  viewer.admin || trail.status === 'published' || (viewer.id !== null && trail.authorId === viewer.id);

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

  /** The user's own trails, every status, newest first (plan R-D4). */
  async listByAuthor(authorId: string): Promise<MyTrailDto[]> {
    const rows = await this.db
      .select({ ...summaryColumns, status: trails.status })
      .from(trails)
      .where(eq(trails.authorId, authorId))
      .orderBy(desc(trails.createdAt));
    return rows.map(toSummary);
  }

  /** The moderation queue: the trails with one status, oldest first (plan R-D5). */
  async listQueue(status: TrailStatus): Promise<QueueTrailDto[]> {
    const rows = await this.db
      .select({ ...summaryColumns, status: trails.status, authorEmail: user.email })
      .from(trails)
      .leftJoin(user, eq(user.id, trails.authorId))
      .where(eq(trails.status, status))
      .orderBy(asc(trails.createdAt));
    return rows.map(toSummary);
  }

  /** A published trail; any trail for an admin; an unpublished trail also for its author (plan R-D3). */
  async findBySlug(slug: string, viewer: Viewer): Promise<TrailDetailDto | undefined> {
    const visible = viewer.admin
      ? undefined
      : or(eq(trails.status, 'published'), viewer.id === null ? undefined : eq(trails.authorId, viewer.id));
    const [row] = await this.db
      .select(detailColumns)
      .from(trails)
      .where(and(eq(trails.slug, slug), visible));
    if (!row) return undefined;
    const { endX, endY, path, ...summary } = row;
    // The profile keeps the global extrema (metrics.ts), so min/max come from it.
    const eles = summary.elevationProfile?.map(([, ele]) => ele);
    return {
      ...toSummary(summary),
      end: endX === null || endY === null ? null : point(endX, endY),
      path: path?.coordinates ?? null,
      elevationMinM: eles ? Math.min(...eles) : null,
      elevationMaxM: eles ? Math.max(...eles) : null,
    };
  }

  /**
   * Stores a draft from a GPX upload. The source is private and never logged (plan D5, M4).
   * A non-admin may have at most PENDING_LIMIT drafts (plan R-D2).
   */
  async createFromGpx(input: CreateTrailDto, uploader: { id: string; admin: boolean }, bytes: Uint8Array): Promise<TrailDetailDto> {
    const authorId = uploader.id;
    // A shortcut before the parse; the locked count in the transaction decides.
    if (!uploader.admin) await this.refuseTooManyPending(this.db, authorId);
    const track = parseGpx(bytes);
    const metrics = trackMetrics(track.points, track.elevations);
    const base = slugify(input.name);
    if (!base) throw new BadRequestException(coded('SLUG_EMPTY'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.refuseKnownSource(sha256, uploader);
    const candidates = Array.from({ length: SLUG_TRIES + 1 }, (_, i) => (i === 0 ? base : `${base}-${i + 1}`))
      .filter((slug) => !RESERVED_SLUGS.has(slug))
      .slice(0, SLUG_TRIES);

    // Outside the transaction: a unique violation aborts it, so each try runs in a new one.
    for (const slug of candidates) {
      try {
        await this.db.transaction(async (tx) => {
          if (!uploader.admin) {
            // One upload per author at a time, so two uploads cannot both pass the count.
            await tx.execute(sql`select pg_advisory_xact_lock(${UPLOAD_LOCK}, hashtext(${authorId}))`);
            await this.refuseTooManyPending(tx, authorId);
          }
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
        if (error instanceof HttpException) throw error;
        const cause = pgCause(error);
        if (cause?.code === '23505' && cause.constraint === 'trails_slug_unique') continue;
        if (cause?.code === '23505' && cause.constraint === 'trail_sources_sha256_unique') {
          // A race: the same file was stored after the lookup above.
          await this.refuseKnownSource(sha256, uploader);
          throw new ConflictException(coded('GPX_DUPLICATE'));
        }
        // drizzle's error message carries the query parameters, i.e. the whole GPX: log codes only.
        this.logger.error(JSON.stringify({ event: 'trail_create_failed', code: cause?.code, constraint: cause?.constraint }));
        throw new InternalServerErrorException();
      }
      return (await this.findBySlug(slug, ADMIN))!;
    }
    // The same file may have been stored during the tries: report it, not the slugs.
    await this.refuseKnownSource(sha256, uploader);
    throw new ConflictException(coded('SLUG_TAKEN'));
  }

  private async refuseTooManyPending(db: Pick<Database, 'select'>, authorId: string): Promise<void> {
    const [pending] = await db
      .select({ n: count() })
      .from(trails)
      .where(and(eq(trails.authorId, authorId), eq(trails.status, 'draft')));
    if (pending!.n >= PENDING_LIMIT) throw new HttpException(coded('TOO_MANY_PENDING'), HttpStatus.TOO_MANY_REQUESTS);
  }

  /** 409 for a known file; the slug only when the uploader may see that trail (no draft slug leaks). */
  private async refuseKnownSource(sha256: string, uploader: Viewer): Promise<void> {
    const [trail] = await this.db
      .select({ slug: trails.slug, status: trails.status, authorId: trails.authorId })
      .from(trailSources)
      .innerJoin(trails, eq(trails.id, trailSources.trailId))
      .where(eq(trailSources.sha256, sha256));
    if (trail) throw new ConflictException(coded('GPX_DUPLICATE', canSee(uploader, trail) ? { slug: trail.slug } : {}));
  }

  /** Changes the metadata; the slug never changes. Undefined when no trail has the slug. */
  async update(slug: string, input: UpdateTrailDto): Promise<TrailDetailDto | undefined> {
    if (Object.values(input).every((value) => value === undefined)) throw new BadRequestException('Nothing to update');
    const rows = await this.db
      .update(trails)
      .set({ ...input, ...(input.city ? { department: departmentOf(input.city) } : {}), updatedAt: new Date() })
      .where(eq(trails.slug, slug))
      .returning({ slug: trails.slug });
    return rows.length ? this.findBySlug(slug, ADMIN) : undefined;
  }
}
