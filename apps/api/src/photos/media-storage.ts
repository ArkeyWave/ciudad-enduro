import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

/** A presigned GET for a photo that is not published: seen by its author and admins only. */
export const SIGNED_URL_SECONDS = 15 * 60;
/** Public objects may be cached for an hour: a hidden photo stops being served within that time. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=3600';

/**
 * The media buckets (plan §9 V1, V1c): R2 through the S3 API, or the S3 mock of dev and CI when
 * S3_ENDPOINT is set (path-style URLs). Every upload goes to the private bucket; publishing copies
 * the files to the public bucket (read through MEDIA_PUBLIC_BASE_URL), hiding deletes that copy.
 * The browser never gets a key.
 */
@Injectable()
export class MediaStorage implements OnApplicationShutdown {
  private readonly logger = new Logger(MediaStorage.name);
  private readonly client: S3Client;
  private readonly public: string;
  private readonly private: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.public = env.R2_MEDIA_BUCKET;
    this.private = env.R2_PRIVATE_BUCKET;
    this.client = new S3Client({
      region: 'auto',
      endpoint: env.S3_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: env.S3_ENDPOINT !== undefined,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      // Bounded calls: a status change holds the photo's row lock during its storage step.
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000, throwOnRequestTimeout: true },
    });
  }

  /** A new key under the env prefix: `[prefix]photos/<name>` (the same key in both buckets). */
  key(name: string): string {
    return `${this.env.MEDIA_KEY_PREFIX}photos/${name}`;
  }

  /** The URL of a published file. */
  publicUrl(key: string): string {
    return `${this.env.MEDIA_PUBLIC_BASE_URL}/${key}`;
  }

  /** A presigned GET of a private file, valid for SIGNED_URL_SECONDS. */
  signedUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.private, Key: key }), { expiresIn: SIGNED_URL_SECONDS });
  }

  async putPrivate(key: string, body: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.private, Key: key, Body: body, ContentType: 'image/webp', CacheControl: 'private, no-store' }));
  }

  /** Copies the files to the public bucket; on any failure the copies made are removed and it throws. */
  async publish(keys: string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.map((Key) =>
        this.client.send(
          new CopyObjectCommand({
            Bucket: this.public,
            Key,
            CopySource: `${this.private}/${Key}`,
            MetadataDirective: 'REPLACE',
            ContentType: 'image/webp',
            CacheControl: PUBLIC_CACHE_CONTROL,
          }),
        ),
      ),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (!failed) return;
    await this.delete(this.public, keys);
    throw failed.reason;
  }

  /**
   * Removes the public copies; throws when a key could not be deleted. Then the row keeps its
   * status (published), and the other file may already be gone: a retry of "Ocultar" finishes it.
   */
  async unpublish(keys: string[]): Promise<void> {
    const left = await this.delete(this.public, keys);
    if (left.length) throw new Error('media_delete_failed');
  }

  /**
   * Removes the files from the public bucket, then from the private one; throws at the first key
   * that could not be deleted, so a failure never leaves a row without its private files.
   */
  async destroy(keys: string[]): Promise<void> {
    for (const bucket of [this.public, this.private]) {
      if ((await this.delete(bucket, keys)).length) throw new Error('media_delete_failed');
    }
  }

  /** Best effort, for the cleanup of a failed upload: what is left is logged, never thrown. */
  async discard(keys: string[]): Promise<void> {
    await this.delete(this.private, keys);
  }

  /**
   * DeleteObjects, then once more for the keys it reports in `Errors` (or all of them when the call
   * fails). Returns the keys still not deleted, and logs them (keys only, never credentials).
   */
  private async delete(bucket: string, keys: string[]): Promise<string[]> {
    let left = keys;
    for (let attempt = 0; attempt < 2 && left.length; attempt++) {
      try {
        const out = await this.client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: left.map((Key) => ({ Key })) } }));
        const failed = new Set((out.Errors ?? []).map((e) => e.Key));
        left = left.filter((key) => failed.has(key));
      } catch {
        // the whole call failed: every key is left
      }
    }
    if (left.length) this.logger.error(JSON.stringify({ event: 'media_delete_failed', keys: left }));
    return left;
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
