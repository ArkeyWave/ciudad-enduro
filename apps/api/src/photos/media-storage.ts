import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

/**
 * The media bucket (plan §9 V1): R2 through the S3 API, or the S3 mock of dev and CI when
 * S3_ENDPOINT is set (path-style URLs). The browser never gets a key: it reads the public base URL.
 */
@Injectable()
export class MediaStorage implements OnApplicationShutdown {
  private readonly logger = new Logger(MediaStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.bucket = env.R2_MEDIA_BUCKET;
    this.client = new S3Client({
      region: 'auto',
      endpoint: env.S3_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: env.S3_ENDPOINT !== undefined,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }

  /** The public URL of a stored key. */
  url(key: string): string {
    return `${this.env.MEDIA_PUBLIC_BASE_URL}/${key}`;
  }

  /** A new key under the env prefix: `[prefix]photos/<name>`. */
  key(name: string): string {
    return `${this.env.MEDIA_KEY_PREFIX}photos/${name}`;
  }

  async putWebp(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        // The key is a random uuid and never rewritten.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  /** Best effort: a failure is logged (with the keys, never the credentials) and swallowed. */
  async remove(keys: string[]): Promise<void> {
    try {
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
    } catch (error) {
      this.logger.error(JSON.stringify({ event: 'media_delete_failed', keys, name: error instanceof Error ? error.name : 'unknown' }));
    }
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
