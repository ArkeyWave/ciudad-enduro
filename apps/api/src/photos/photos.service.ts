import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { and, asc, count, eq, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Database } from '../db/db.provider.js';
import { trailPhotos, trails, user, type TrailStatus } from '../db/schema/index.js';
import type { LngLat } from '../db/types/geo.js';
import type { Viewer } from '../trails/trails.service.js';
import type { PhotoDto, QueuePhotoDto, TrailPhotoDto } from './dto/photo.dto.js';
import { encodePhoto, photoType } from './image.js';
import { MediaStorage } from './media-storage.js';

/** Photos a non-admin may have waiting for review (plan §9 V4). */
export const PHOTO_PENDING_LIMIT = 20;
/** A photo attaches to the nearest published trail within this distance (plan §9 V3). */
export const NEARBY_M = 50;
/** First key of the two-key advisory lock on photo uploads (trails use 7301). */
const PHOTO_LOCK = sql.raw('7302');

const coded = (code: string) => ({ code, message: code });

const photoColumns = {
  id: trailPhotos.id,
  status: trailPhotos.status,
  lineFraction: trailPhotos.lineFraction,
  lat: sql<number>`ST_Y(${trailPhotos.position}::geometry)`,
  lng: sql<number>`ST_X(${trailPhotos.position}::geometry)`,
  heading: trailPhotos.heading,
  takenAt: trailPhotos.takenAt,
  imageKey: trailPhotos.imageKey,
  thumbKey: trailPhotos.thumbKey,
  width: trailPhotos.width,
  height: trailPhotos.height,
};
const withTrail = { ...photoColumns, trailSlug: trails.slug, trailName: trails.name };

type PhotoRow = Omit<TrailPhotoDto, 'position' | 'takenAt' | 'url' | 'thumbUrl'> & {
  lat: number;
  lng: number;
  takenAt: Date | null;
  imageKey: string;
  thumbKey: string;
};

/** Who sees a photo: the trail rule (plan §6 R-D3) — published, its author, or an admin. */
const visibleTo = (viewer: Viewer): SQL | undefined =>
  viewer.admin ? undefined : or(eq(trailPhotos.status, 'published'), viewer.id === null ? undefined : eq(trailPhotos.authorId, viewer.id));

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly media: MediaStorage,
  ) {}

  /** A published photo reads from the public domain; any other one through presigned URLs (V1c). */
  private async view<R extends PhotoRow>({ lat, lng, imageKey, thumbKey, takenAt, ...row }: R): Promise<Omit<R, keyof PhotoRow> & TrailPhotoDto> {
    const published = row.status === 'published';
    const [url, thumbUrl] = published
      ? [this.media.publicUrl(imageKey), this.media.publicUrl(thumbKey)]
      : await Promise.all([this.media.signedUrl(imageKey), this.media.signedUrl(thumbKey)]);
    return {
      ...row,
      position: { lat, lng },
      takenAt: takenAt?.toISOString() ?? null,
      url,
      thumbUrl,
    } as Omit<R, keyof PhotoRow> & TrailPhotoDto; // TS cannot see that the rest of R keeps its other fields
  }

  /** The photos of one trail the viewer may see, in line order (the timeline, V5). */
  async listForTrail(trailId: string, viewer: Viewer): Promise<TrailPhotoDto[]> {
    const rows = await this.db
      .select(photoColumns)
      .from(trailPhotos)
      .where(and(eq(trailPhotos.trailId, trailId), visibleTo(viewer)))
      .orderBy(asc(trailPhotos.lineFraction), asc(trailPhotos.createdAt));
    return Promise.all(rows.map((row) => this.view(row)));
  }

  /** The moderation queue: photos with one status, oldest first. */
  async listQueue(status: TrailStatus): Promise<QueuePhotoDto[]> {
    const rows = await this.db
      .select({ ...withTrail, authorEmail: user.email, createdAt: trailPhotos.createdAt })
      .from(trailPhotos)
      .innerJoin(trails, eq(trails.id, trailPhotos.trailId))
      .leftJoin(user, eq(user.id, trailPhotos.authorId))
      .where(eq(trailPhotos.status, status))
      .orderBy(asc(trailPhotos.createdAt));
    return Promise.all(rows.map(async ({ createdAt, ...row }) => ({ ...(await this.view(row)), createdAt: createdAt.toISOString() })));
  }

  /**
   * Publish or hide (admin, V1c). Publishing copies both files to the public bucket; any other
   * status deletes the public copies (the private files stay, so a later publish works). The row
   * changes only after the storage step succeeded: else 503 STORAGE_UNAVAILABLE and nothing changed.
   * Undefined when no photo has the id.
   */
  async setStatus(id: string, status: TrailStatus): Promise<PhotoDto | undefined> {
    const keys = await this.keysOf(id);
    if (!keys) return undefined;
    await this.storage('photo_status_failed', () => (status === 'published' ? this.media.publish(keys) : this.media.unpublish(keys)));
    const updated = await this.db
      .update(trailPhotos)
      .set({ status, updatedAt: new Date() })
      .where(eq(trailPhotos.id, id))
      .returning({ id: trailPhotos.id });
    return updated.length ? this.findOne(id) : undefined;
  }

  /** Deletes the files in both buckets, then the row (admin). False when no photo has the id. */
  async remove(id: string): Promise<boolean> {
    const keys = await this.keysOf(id);
    if (!keys) return false;
    await this.storage('photo_delete_failed', () => this.media.destroy(keys));
    await this.db.delete(trailPhotos).where(eq(trailPhotos.id, id));
    return true;
  }

  private async keysOf(id: string): Promise<string[] | undefined> {
    const [row] = await this.db.select({ imageKey: trailPhotos.imageKey, thumbKey: trailPhotos.thumbKey }).from(trailPhotos).where(eq(trailPhotos.id, id));
    return row && [row.imageKey, row.thumbKey];
  }

  /** A storage step; its failure is a 503 STORAGE_UNAVAILABLE (logged by name, never the keys' content). */
  private async storage(event: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.logger.error(JSON.stringify({ event, name: error instanceof Error ? error.name : 'unknown' }));
      throw new ServiceUnavailableException(coded('STORAGE_UNAVAILABLE'));
    }
  }

  private async findOne(id: string): Promise<PhotoDto | undefined> {
    const [row] = await this.db.select(withTrail).from(trailPhotos).innerJoin(trails, eq(trails.id, trailPhotos.trailId)).where(eq(trailPhotos.id, id));
    return row && this.view(row);
  }

  /**
   * A new draft photo (plan §9 V1–V4, V1c). Order: the pending limit (a shortcut), the type by
   * magic bytes, the trail near the body position (when given: no encode for a far photo), the
   * EXIF fields (JPEG only) and the re-encode in one encode slot, the position (body, else EXIF),
   * the nearest published trail, the upload of both files to the PRIVATE bucket, then the row under
   * a per-author lock with the limit rechecked. Both uploads settle before any cleanup; a failed
   * upload writes no row and a failed insert deletes the files.
   */
  async create(uploader: { id: string; admin: boolean }, bytes: Uint8Array, bodyPosition: LngLat | null): Promise<PhotoDto> {
    if (!uploader.admin) await this.refuseTooManyPending(this.db, uploader.id);
    const type = photoType(bytes);
    if (!type) throw new UnsupportedMediaTypeException(coded('PHOTO_TYPE'));
    let trail = bodyPosition ? await this.requireTrail(bodyPosition) : undefined;
    const encoded = await encodePhoto(bytes, type);
    const { exif } = encoded;
    const position = bodyPosition ?? exif.position;
    if (!position) throw new BadRequestException(coded('NO_POSITION'));
    trail ??= await this.requireTrail(position);

    const id = randomUUID();
    const imageKey = this.media.key(`${id}.webp`);
    const thumbKey = this.media.key(`${id}-t.webp`);
    const keys = [imageKey, thumbKey];
    // allSettled: a cleanup must not run while the other PUT is still in flight (it would orphan it).
    const puts = await Promise.allSettled([this.media.putPrivate(imageKey, encoded.image), this.media.putPrivate(thumbKey, encoded.thumb)]);
    const failed = puts.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      await this.media.discard(keys);
      const reason: unknown = failed.reason;
      this.logger.error(JSON.stringify({ event: 'photo_upload_failed', name: reason instanceof Error ? reason.name : 'unknown' }));
      throw new ServiceUnavailableException(coded('STORAGE_UNAVAILABLE'));
    }

    try {
      await this.db.transaction(async (tx) => {
        if (!uploader.admin) {
          await tx.execute(sql`select pg_advisory_xact_lock(${PHOTO_LOCK}, hashtext(${uploader.id}))`);
          await this.refuseTooManyPending(tx, uploader.id);
        }
        await tx.insert(trailPhotos).values({
          id,
          trailId: trail.id,
          authorId: uploader.id,
          position,
          lineFraction: trail.fraction,
          exifPosition: exif.position,
          altitudeM: exif.altitudeM,
          heading: exif.heading,
          takenAt: exif.takenAt,
          imageKey,
          thumbKey,
          width: encoded.width,
          height: encoded.height,
        });
      });
    } catch (error) {
      await this.media.discard(keys);
      if (error instanceof HttpException) throw error;
      const cause = (error as { cause?: { code?: string } }).cause;
      this.logger.error(JSON.stringify({ event: 'photo_create_failed', code: cause?.code }));
      throw new InternalServerErrorException();
    }
    return (await this.findOne(id))!;
  }

  private async requireTrail(position: LngLat): Promise<{ id: string; fraction: number }> {
    const trail = await this.nearestTrail(position);
    if (!trail) throw new UnprocessableEntityException(coded('NO_TRAIL_NEARBY'));
    return trail;
  }

  /** The nearest published trail whose line passes within NEARBY_M, and the point's place on it. */
  private async nearestTrail({ lng, lat }: LngLat): Promise<{ id: string; fraction: number } | undefined> {
    const point = sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)`;
    const [row] = await this.db
      .select({ id: trails.id, fraction: sql<number>`ST_LineLocatePoint(${trails.path}, ${point})` })
      .from(trails)
      .where(and(eq(trails.status, 'published'), sql`ST_DWithin(${trails.path}::geography, ${point}::geography, ${NEARBY_M})`))
      .orderBy(sql`ST_Distance(${trails.path}::geography, ${point}::geography)`)
      .limit(1);
    return row;
  }

  private async refuseTooManyPending(db: Pick<Database, 'select'>, authorId: string): Promise<void> {
    const [pending] = await db
      .select({ n: count() })
      .from(trailPhotos)
      .where(and(eq(trailPhotos.authorId, authorId), eq(trailPhotos.status, 'draft')));
    if (pending!.n >= PHOTO_PENDING_LIMIT) throw new HttpException(coded('TOO_MANY_PENDING'), HttpStatus.TOO_MANY_REQUESTS);
  }
}
