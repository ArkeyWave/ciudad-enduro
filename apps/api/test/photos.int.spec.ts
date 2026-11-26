// Trail photos, plan §9 V1–V4: the pipeline (type, EXIF, re-encode without metadata), the trail
// link within 50 m, the limits, the storage cleanup, the visibility and the admin queue. Runs
// against the S3 mock (docker-compose.dev.yml locally, a CI service).
import { crc32 } from 'node:zlib';
import { CopyObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import exifr from 'exifr';
import type pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { trailPhotos, trails, type TrailStatus } from '../src/db/schema/index.js';
import { MediaStorage } from '../src/photos/media-storage.js';
import { UploadAttempts } from '../src/trails/upload-throttle.js';
import { openTestClient } from './test-db.js';
import { createAuthTestApp, signInWithOtp, truncateAuth, uniqueIp, WEB_ORIGIN, type AuthTestApp } from './support/test-app.js';

const PUBLIC = process.env.R2_MEDIA_BUCKET!;
const PRIVATE = process.env.R2_PRIVATE_BUCKET!;
const BASE = process.env.MEDIA_PUBLIC_BASE_URL!;
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

/** The keys in a bucket; the private one by default (every upload lands there, V1c). */
async function listKeys(bucket = PRIVATE): Promise<string[]> {
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  return Contents.map((o) => o.Key!).sort();
}
async function emptyBucket() {
  for (const bucket of [PUBLIC, PRIVATE]) {
    const keys = await listKeys(bucket);
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  }
}
/** The HTTP status of an anonymous GET, as a browser would make it. */
const statusOf = async (url: string) => (await fetch(url)).status;

let t: AuthTestApp;
let client: pg.Client;
let db: NodePgDatabase;
let admin: string;
let rider: string;
let other: string;
let riderId: string;
let adminId: string;
let otherId: string;

// A line due south from (-9.09, -78.52) to (-9.10, -78.52), about 1.1 km.
const LINE: [number, number][] = [
  [-78.52, -9.09],
  [-78.52, -9.1],
];
/** Degrees of longitude per metre at this latitude. */
const LNG_PER_M = 1 / (111_320 * Math.cos((9.09 * Math.PI) / 180));
/** A point `east` metres east of the line at `fraction` of its length. */
const near = (fraction: number, east: number) => ({ lat: -9.09 - 0.01 * fraction, lng: -78.52 + east * LNG_PER_M });

let n = 0;
async function seedTrail(status: TrailStatus = 'published', path: [number, number][] = LINE, slug = `t-${++n}`) {
  const [row] = await db
    .insert(trails)
    .values({
      slug,
      name: `Sendero ${slug}`,
      city: 'Chimbote',
      department: 'Ancash',
      difficulty: 'facil',
      type: 'urbano',
      status,
      startPoint: { lng: path[0]![0], lat: path[0]![1] },
      path,
    })
    .returning({ id: trails.id, slug: trails.slug });
  return row!;
}

async function seedPhotos(trailId: string, authorId: string, status: TrailStatus, count: number) {
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    await db.insert(trailPhotos).values({
      id,
      trailId,
      authorId,
      status,
      position: { lng: -78.52, lat: -9.09 },
      lineFraction: 0,
      imageKey: `photos/${id}.webp`,
      thumbKey: `photos/${id}-t.webp`,
      width: 1,
      height: 1,
    });
  }
}

/** A camera JPEG: EXIF GPS 9°5'33"S 78°31'12"W (a quarter down the line), time, direction, device. */
async function cameraJpeg(width = 2400, height = 1800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#557733' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestMake', Model: 'TestModel', Artist: 'Owner Name', Software: 'TestSoft' },
      IFD2: { DateTimeOriginal: '2026:11:08 07:30:15', BodySerialNumber: 'SN-12345' },
      IFD3: {
        GPSLatitudeRef: 'S',
        GPSLatitude: '9/1 5/1 3300/100',
        GPSLongitudeRef: 'W',
        GPSLongitude: '78/1 31/1 1200/100',
        GPSAltitude: '1234/10',
        GPSImgDirectionRef: 'T',
        GPSImgDirection: '2705/10',
      },
    })
    .toBuffer();
}

/** A JPEG with no EXIF at all. */
const plainJpeg = (width = 64, height = 48) => sharp({ create: { width, height, channels: 3, background: '#335577' } }).jpeg().toBuffer();

/** A PNG whose header claims 10 000 × 10 000 px (100 MP) with almost no data: a decompression bomb. */
function bombPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10_000, 0);
  ihdr.writeUInt32BE(10_000, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), chunk('IEND', Buffer.alloc(0))]);
}

type Headers = Record<string, string>;
const as = (cookie: string | null, origin: string | null = WEB_ORIGIN): Headers => ({
  'cf-connecting-ip': uniqueIp(),
  ...(cookie ? { cookie } : {}),
  ...(origin ? { origin } : {}),
});

function upload(app: AuthTestApp, headers: Headers, file: Uint8Array | null, position?: { lat: number; lng: number } | Record<string, string>) {
  const form = new FormData();
  if (position) for (const [key, value] of Object.entries(position)) form.append(key, String(value));
  if (file) form.append('photo', new Blob([new Uint8Array(file)]), 'IMG_0001.jpg');
  return fetch(`${app.url}/api/photos`, { method: 'POST', headers, body: form });
}
const post = (headers: Headers, file: Uint8Array | null, position?: { lat: number; lng: number } | Record<string, string>) => upload(t, headers, file, position);
const patch = (id: string, headers: Headers, body: unknown) =>
  fetch(`${t.url}/api/photos/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path: string, headers: Headers = as(null, null)) => fetch(`${t.url}/api${path}`, { headers });
const count = async () => Number((await client.query<{ n: string }>('select count(*) as n from trail_photos')).rows[0]!.n);

type Photo = { id: string; status: string; lineFraction: number; position: { lat: number; lng: number }; url: string; thumbUrl: string; width: number; height: number; trailSlug: string };

beforeAll(async () => {
  t = await createAuthTestApp();
  client = await openTestClient();
  db = drizzle(client);
  await truncateAuth(client);
  admin = await signInWithOtp(t, 'admin@x.pe');
  rider = await signInWithOtp(t, 'rider@x.pe');
  other = await signInWithOtp(t, 'otro@x.pe');
  await client.query(`update "user" set role = 'admin' where email = 'admin@x.pe'`);
  const idOf = async (email: string) => (await client.query<{ id: string }>(`select id from "user" where email = $1`, [email])).rows[0]!.id;
  riderId = await idOf('rider@x.pe');
  adminId = await idOf('admin@x.pe');
  otherId = await idOf('otro@x.pe');
}, 30_000);
afterAll(async () => {
  await emptyBucket();
  await client.end();
  await t.app.close();
  s3.destroy();
});
beforeEach(async () => {
  await client.query('TRUNCATE trails, trail_sources, trail_photos');
  t.app.get(UploadAttempts).clear();
  await emptyBucket();
});

describe('POST /api/photos: the pipeline (V1, V1b)', () => {
  it('keeps taken_at, position, altitude and heading from EXIF, and stores two WebPs without any metadata', async () => {
    const trail = await seedTrail();
    const res = await post(as(rider), await cameraJpeg());
    expect(res.status).toBe(201);
    const photo = (await res.json()) as Photo;
    expect(photo).toMatchObject({ status: 'draft', trailSlug: trail.slug, width: 1600, height: 1200, heading: 270.5, takenAt: '2026-11-08T12:30:15.000Z' });
    expect(photo.lineFraction).toBeCloseTo(0.25, 2);
    expect(photo.position.lat).toBeCloseTo(-9.0925, 6);
    expect(photo.position.lng).toBeCloseTo(-78.52, 6);
    // No device field reaches the answer.
    expect(JSON.stringify(photo)).not.toMatch(/TestMake|TestModel|SN-12345|Owner Name|TestSoft/);

    const { rows } = await client.query<{ taken_at: Date; heading: number; altitude_m: number; elat: number; lng: number; author_id: string; image_key: string; thumb_key: string }>(
      `select taken_at, heading, altitude_m, ST_Y(exif_position::geometry) as elat, ST_X(position::geometry) as lng, author_id, image_key, thumb_key from trail_photos`,
    );
    expect(rows).toHaveLength(1);
    const [row] = rows as [(typeof rows)[number]];
    expect(row.taken_at.toISOString()).toBe('2026-11-08T12:30:15.000Z');
    expect(row).toMatchObject({ heading: 270.5, author_id: riderId, image_key: `photos/${photo.id}.webp`, thumb_key: `photos/${photo.id}-t.webp` });
    expect(row.altitude_m).toBeCloseTo(123.4, 3);
    expect(row.elat).toBeCloseTo(-9.0925, 6);

    // Only the two re-encoded files, in the private bucket: the original is never stored, and a
    // draft is never public (V1c).
    expect(await listKeys()).toEqual([`photos/${photo.id}-t.webp`, `photos/${photo.id}.webp`].sort());
    expect(await listKeys(PUBLIC)).toEqual([]);
    expect(await statusOf(`${BASE}/photos/${photo.id}.webp`)).toBe(404);
    for (const [url, side] of [
      [photo.url, 1600],
      [photo.thumbUrl, 160],
    ] as const) {
      const stored = Buffer.from(await (await fetch(url)).arrayBuffer());
      const meta = await sharp(stored).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: side });
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(await exifr.parse(stored, true).catch(() => undefined)).toBeUndefined();
      expect(stored.includes('TestMake')).toBe(false);
      expect(stored.includes('SN-12345')).toBe(false);
    }
  }, 30_000);

  it('takes the body position over the EXIF one', async () => {
    await seedTrail();
    const at = near(0.5, 30);
    const res = await post(as(rider), await cameraJpeg(), at);
    expect(res.status).toBe(201);
    const photo = (await res.json()) as Photo;
    expect(photo.lineFraction).toBeCloseTo(0.5, 2);
    expect(photo.position.lat).toBeCloseTo(at.lat, 6);
    expect(photo.position.lng).toBeCloseTo(at.lng, 6);
  });

  it('applies the EXIF orientation before the strip', async () => {
    await seedTrail();
    const rotated = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#335577' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const res = await post(as(rider), rotated, near(0.1, 0));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ width: 48, height: 64 });
  });

  it('accepts a PNG and a WebP; never enlarges a small photo', async () => {
    await seedTrail();
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#000' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#000' } }).webp().toBuffer();
    for (const file of [png, webp]) {
      const res = await post(as(rider), file, near(0.1, 0));
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ width: 40, height: 30 });
    }
  });

  it('answers 415 PHOTO_TYPE to a file that is not a JPEG, PNG or WebP, whatever its name', async () => {
    await seedTrail();
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
    const res = await post(as(rider), gif, near(0.1, 0));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: 'PHOTO_TYPE' });
    expect(await count()).toBe(0);
  });

  it('answers 413 over 10 MiB, before any processing', async () => {
    await seedTrail();
    const big = Buffer.concat([await plainJpeg(), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await post(as(rider), big, near(0.1, 0))).status).toBe(413);
    expect(await listKeys()).toEqual([]);
  });

  it('answers 413 PHOTO_TOO_LARGE to a decompression bomb, and 400 PHOTO_INVALID to broken bytes', async () => {
    await seedTrail();
    const bomb = await post(as(rider), bombPng(), near(0.1, 0));
    expect(bomb.status).toBe(413);
    expect(await bomb.json()).toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    const broken = await post(as(rider), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), near(0.1, 0));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ code: 'PHOTO_INVALID' });
    expect(await count()).toBe(0);
    expect(await listKeys()).toEqual([]);
  });
});

describe('POST /api/photos: the position and the trail link (V2, V3)', () => {
  it('answers 400 NO_POSITION when neither the body nor the EXIF has a position', async () => {
    await seedTrail();
    const res = await post(as(rider), await plainJpeg());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'NO_POSITION' });
  });

  it('answers 400 NO_POSITION to a PNG without a body position before decoding it', async () => {
    await seedTrail();
    // A bomb would be 413 once decoded: the 400 proves the check runs first.
    const res = await post(as(rider), bombPng());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'NO_POSITION' });
  });

  it('answers 400 to a lone coordinate or an out-of-range one', async () => {
    await seedTrail();
    expect((await post(as(rider), await plainJpeg(), { lat: '-9.09' })).status).toBe(400);
    expect((await post(as(rider), await plainJpeg(), { lat: '-99', lng: '-78.52' })).status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('attaches a photo 30 m off the line, and refuses one 80 m off with 422 NO_TRAIL_NEARBY', async () => {
    await seedTrail();
    expect((await post(as(rider), await plainJpeg(), near(0.75, 30))).status).toBe(201);
    const far = await post(as(rider), await plainJpeg(), near(0.75, 80));
    expect(far.status).toBe(422);
    expect(await far.json()).toMatchObject({ code: 'NO_TRAIL_NEARBY' });
    expect(await count()).toBe(1);
    expect(await listKeys()).toHaveLength(2);
  });

  it('ignores a draft or hidden trail within 50 m', async () => {
    await seedTrail('draft');
    await seedTrail('hidden');
    expect((await post(as(rider), await plainJpeg(), near(0.5, 0))).status).toBe(422);
  });

  it('picks the nearest of two published trails', async () => {
    const shifted = (m: number): [number, number][] => LINE.map(([lng, lat]) => [lng + m * LNG_PER_M, lat]);
    await seedTrail('published', shifted(40), 'lejos');
    await seedTrail('published', shifted(10), 'cerca');
    await seedTrail('published', shifted(25), 'medio');
    const res = await post(as(rider), await plainJpeg(), near(0.5, 0));
    expect(await res.json()).toMatchObject({ trailSlug: 'cerca' });
  });
});

describe('POST /api/photos: who and how many (V4)', () => {
  it('answers 401 to an anonymous user and 403 to a foreign Origin', async () => {
    await seedTrail();
    expect((await post(as(null), await plainJpeg(), near(0.1, 0))).status).toBe(401);
    expect((await post(as(rider, 'https://other.vops.pe'), await plainJpeg(), near(0.1, 0))).status).toBe(403);
    expect(await count()).toBe(0);
  });

  it('answers 429 TOO_MANY_PENDING to a rider with 20 photos in review, and stores nothing', async () => {
    const trail = await seedTrail();
    await seedPhotos(trail.id, riderId, 'draft', 20);
    const res = await post(as(rider), await plainJpeg(), near(0.1, 0));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_PENDING' });
    expect(await listKeys()).toEqual([]);
  });

  it('counts only own drafts, and does not limit an admin', async () => {
    const trail = await seedTrail();
    await seedPhotos(trail.id, riderId, 'draft', 19);
    await seedPhotos(trail.id, riderId, 'published', 3);
    await seedPhotos(trail.id, riderId, 'hidden', 3);
    await seedPhotos(trail.id, otherId, 'draft', 5);
    await seedPhotos(trail.id, adminId, 'draft', 20);
    expect((await post(as(rider), await plainJpeg(), near(0.1, 0))).status).toBe(201);
    expect((await post(as(admin), await plainJpeg(), near(0.1, 0))).status).toBe(201);
  });

  it('serializes concurrent uploads: a rider with 19 drafts gets exactly one more, and the refused one leaves no file', async () => {
    const trail = await seedTrail();
    await seedPhotos(trail.id, riderId, 'draft', 19);
    // A slow insert widens the window between the count and the insert: without the lock, both pass.
    await client.query(`create or replace function slow_photo() returns trigger language plpgsql as $$ begin perform pg_sleep(0.3); return new; end $$`);
    await client.query('create trigger slow_photo before insert on trail_photos for each row execute function slow_photo()');
    try {
      const results = await Promise.all([1, 2].map(async () => post(as(rider), await plainJpeg(), near(0.1, 0))));
      expect(results.map((res) => res.status).sort()).toEqual([201, 429]);
      expect(await count()).toBe(20);
      expect(await listKeys()).toHaveLength(2);
    } finally {
      await client.query('drop trigger slow_photo on trail_photos');
    }
  });

  it('shares the upload throttle with trails: the 11th upload of a rider in 10 min gets 429 TOO_MANY_UPLOADS', async () => {
    await seedTrail();
    const gif = Buffer.from('GIF89a', 'latin1');
    for (let i = 0; i < 5; i++) expect((await post(as(rider), gif)).status).toBe(415);
    for (let i = 0; i < 5; i++) {
      const form = new FormData();
      form.append('gpx', new Blob(['<gpx><trk>']), 'r.gpx');
      for (const [k, v] of Object.entries({ name: 'X', city: 'Chimbote', difficulty: 'facil', type: 'urbano' })) form.append(k, v);
      expect((await fetch(`${t.url}/api/trails`, { method: 'POST', headers: as(rider), body: form })).status).toBe(400);
    }
    const res = await post(as(rider), await plainJpeg(), near(0.1, 0));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_UPLOADS' });
    expect((await post(as(other), await plainJpeg(), near(0.1, 0))).status).toBe(201);
  });
});

describe('POST /api/photos: storage cleanup', () => {
  it('deletes the uploaded files when the insert fails', async () => {
    await seedTrail();
    await client.query(`create or replace function fail_photo() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await client.query('create trigger fail_photo before insert on trail_photos for each row execute function fail_photo()');
    try {
      expect((await post(as(rider), await plainJpeg(), near(0.1, 0))).status).toBe(500);
      expect(await listKeys()).toEqual([]);
    } finally {
      await client.query('drop trigger fail_photo on trail_photos');
    }
  });

  it('writes no row when the upload fails (503 STORAGE_UNAVAILABLE), and keys go under MEDIA_KEY_PREFIX', async () => {
    await seedTrail();
    const broken = await createAuthTestApp({ env: { R2_PRIVATE_BUCKET: 'no-such-bucket' } });
    const prefixed = await createAuthTestApp({ env: { MEDIA_KEY_PREFIX: 'staging/' } });
    try {
      const res = await upload(broken, as(rider), await plainJpeg(), near(0.1, 0));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      expect(await count()).toBe(0);

      const ok = (await (await upload(prefixed, as(rider), await plainJpeg(), near(0.1, 0))).json()) as Photo;
      expect(await listKeys()).toEqual([`staging/photos/${ok.id}-t.webp`, `staging/photos/${ok.id}.webp`]);
      expect(ok.url.startsWith(`${process.env.S3_ENDPOINT}/${PRIVATE}/staging/photos/${ok.id}.webp?`)).toBe(true);
      expect(await statusOf(ok.url)).toBe(200);
    } finally {
      await broken.app.close();
      await prefixed.app.close();
    }
  });
});

describe('POST /api/photos: both uploads settle before the cleanup (B3)', () => {
  it('leaves no file when one PUT fails fast and the other succeeds later', async () => {
    await seedTrail();
    const media = t.app.get(MediaStorage);
    const real = media.putPrivate.bind(media);
    const spy = vi.spyOn(media, 'putPrivate').mockImplementation(async (key, body) => {
      if (key.endsWith('-t.webp')) throw new Error('put failed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      return real(key, body);
    });
    try {
      const res = await post(as(rider), await plainJpeg(), near(0.1, 0));
      expect(res.status).toBe(503);
      // Past the slow PUT: with Promise.all the cleanup ran before it, and its file would land now.
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(await listKeys()).toEqual([]);
      expect(await count()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('publish, hide and delete move the files (V1c)', () => {
  const urls = (id: string) => [`${BASE}/photos/${id}.webp`, `${BASE}/photos/${id}-t.webp`];
  async function draft() {
    await seedTrail();
    return (await (await post(as(rider), await plainJpeg(), near(0.3, 0))).json()) as Photo;
  }
  const del = (id: string, headers: Headers) => fetch(`${t.url}/api/photos/${id}`, { method: 'DELETE', headers });

  it('serves a draft only through its presigned URL; publish copies it to the public bucket with a 1 h cache', async () => {
    const photo = await draft();
    expect(await statusOf(photo.url)).toBe(200);
    expect(await statusOf(photo.thumbUrl)).toBe(200);
    for (const url of urls(photo.id)) expect(await statusOf(url)).toBe(404);

    const res = await patch(photo.id, as(admin), { status: 'published' });
    expect(res.status).toBe(200);
    const published = (await res.json()) as Photo;
    expect([published.url, published.thumbUrl]).toEqual(urls(photo.id));
    for (const url of urls(photo.id)) {
      const got = await fetch(url);
      expect(got.status).toBe(200);
      expect(got.headers.get('cache-control')).toBe('public, max-age=3600');
    }
  });

  it('hide deletes the public copies and keeps the private ones; publishing again works', async () => {
    const photo = await draft();
    expect((await patch(photo.id, as(admin), { status: 'published' })).status).toBe(200);
    const hidden = await patch(photo.id, as(admin), { status: 'hidden' });
    expect(hidden.status).toBe(200);
    expect(await listKeys(PUBLIC)).toEqual([]);
    expect(await listKeys()).toHaveLength(2);
    for (const url of urls(photo.id)) expect(await statusOf(url)).toBe(404);
    expect(await statusOf(((await hidden.json()) as Photo).url)).toBe(200);
    expect((await patch(photo.id, as(admin), { status: 'published' })).status).toBe(200);
    for (const url of urls(photo.id)) expect(await statusOf(url)).toBe(200);
  });

  it('leaves the row unchanged with 503 STORAGE_UNAVAILABLE when the copy or the public delete fails', async () => {
    const photo = await draft();
    const broken = await createAuthTestApp({ env: { R2_MEDIA_BUCKET: 'no-such-bucket' } });
    try {
      const send = (status: string) =>
        fetch(`${broken.url}/api/photos/${photo.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...as(admin) }, body: JSON.stringify({ status }) });
      const copy = await send('published');
      expect(copy.status).toBe(503);
      expect(await copy.json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      expect((await client.query('select status from trail_photos')).rows).toEqual([{ status: 'draft' }]);
      await client.query(`update trail_photos set status = 'published'`);
      expect((await send('hidden')).status).toBe(503);
      expect((await client.query('select status from trail_photos')).rows).toEqual([{ status: 'published' }]);
    } finally {
      await broken.app.close();
    }
  });

  it('does not touch storage when the status does not change', async () => {
    const photo = await draft();
    const publish = vi.spyOn(t.app.get(MediaStorage), 'publish');
    try {
      expect((await patch(photo.id, as(admin), { status: 'published' })).status).toBe(200);
      expect((await patch(photo.id, as(admin), { status: 'published' })).status).toBe(200);
      expect(publish).toHaveBeenCalledTimes(1);
    } finally {
      publish.mockRestore();
    }
  });

  it('rolls back a half-made publish: the thumbnail copy fails, no public file remains, the row stays a draft', async () => {
    const photo = await draft();
    const media: unknown = t.app.get(MediaStorage);
    const s3client = (media as { client: { send: (command: unknown) => Promise<unknown> } }).client;
    const real = s3client.send.bind(s3client);
    const send = vi.spyOn(s3client, 'send').mockImplementation(async (command) => {
      if (command instanceof CopyObjectCommand && command.input.Key?.endsWith('-t.webp')) throw new Error('copy failed');
      return real(command);
    });
    try {
      expect((await patch(photo.id, as(admin), { status: 'published' })).status).toBe(503);
    } finally {
      send.mockRestore();
    }
    expect(await listKeys(PUBLIC)).toEqual([]);
    expect((await client.query('select status from trail_photos')).rows).toEqual([{ status: 'draft' }]);
  });

  it('serializes a publish and a hide on one photo: the files match the final status', async () => {
    const photo = await draft();
    const media = t.app.get(MediaStorage);
    const real = media.publish.bind(media);
    // The copies land, then the publish waits: without the row lock the hide runs in that gap.
    const publish = vi.spyOn(media, 'publish').mockImplementation(async (keys) => {
      await real(keys);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    try {
      const published = patch(photo.id, as(admin), { status: 'published' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const hidden = patch(photo.id, as(admin), { status: 'hidden' });
      expect([(await published).status, (await hidden).status]).toEqual([200, 200]);
    } finally {
      publish.mockRestore();
    }
    const [{ status }] = (await client.query<{ status: string }>('select status from trail_photos')).rows as [{ status: string }];
    expect(status).toBe('hidden');
    expect(await listKeys(PUBLIC)).toEqual([]);
  });

  it('serializes a delete and a publish: no public file is left without its row', async () => {
    const photo = await draft();
    const media = t.app.get(MediaStorage);
    const real = media.publish.bind(media);
    const publish = vi.spyOn(media, 'publish').mockImplementation(async (keys) => {
      await real(keys);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    try {
      const published = patch(photo.id, as(admin), { status: 'published' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const deleted = del(photo.id, as(admin));
      expect([(await published).status, (await deleted).status]).toEqual([200, 204]);
    } finally {
      publish.mockRestore();
    }
    expect(await count()).toBe(0);
    expect(await listKeys(PUBLIC)).toEqual([]);
    expect(await listKeys()).toEqual([]);
  });

  it('keeps the row and the private files when the delete fails (503 STORAGE_UNAVAILABLE)', async () => {
    const photo = await draft();
    const broken = await createAuthTestApp({ env: { R2_MEDIA_BUCKET: 'no-such-bucket' } });
    try {
      const res = await fetch(`${broken.url}/api/photos/${photo.id}`, { method: 'DELETE', headers: as(admin) });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      expect(await count()).toBe(1);
      expect(await listKeys()).toHaveLength(2);
    } finally {
      await broken.app.close();
    }
  });

  it('lets an admin delete a photo: both buckets empty, the row gone; 403 for a rider or a foreign Origin, 404 unknown', async () => {
    const photo = await draft();
    expect((await patch(photo.id, as(admin), { status: 'published' })).status).toBe(200);
    expect((await del(photo.id, as(rider))).status).toBe(403);
    expect((await del(photo.id, as(admin, 'https://other.vops.pe'))).status).toBe(403);
    expect((await del(crypto.randomUUID(), as(admin))).status).toBe(404);
    expect(await count()).toBe(1);
    expect((await del(photo.id, as(admin))).status).toBe(204);
    expect(await listKeys(PUBLIC)).toEqual([]);
    expect(await listKeys()).toEqual([]);
    expect(await count()).toBe(0);
  });
});

describe('who sees a photo, and the admin queue (V5, plan §6)', () => {
  async function draftPhoto() {
    const trail = await seedTrail();
    const res = await post(as(rider), await plainJpeg(), near(0.6, 5));
    const photo = (await res.json()) as Photo;
    return { trail, photo };
  }
  const photosOf = async (slug: string, cookie: string | null) =>
    ((await (await get(`/trails/${slug}`, as(cookie, null))).json()) as { photos: { id: string; status: string }[] }).photos;

  it('shows a draft photo on the trail to its author and to an admin only', async () => {
    const { trail, photo } = await draftPhoto();
    expect(await photosOf(trail.slug, rider)).toEqual([expect.objectContaining({ id: photo.id, status: 'draft' })]);
    expect(await photosOf(trail.slug, admin)).toHaveLength(1);
    expect(await photosOf(trail.slug, other)).toEqual([]);
    expect(await photosOf(trail.slug, null)).toEqual([]);
  });

  it('lists the trail photos in line order', async () => {
    const trail = await seedTrail();
    for (const fraction of [0.8, 0.2, 0.5]) expect((await post(as(admin), await plainJpeg(), near(fraction, 0))).status).toBe(201);
    await client.query(`update trail_photos set status = 'published'`);
    const fractions = ((await (await get(`/trails/${trail.slug}`)).json()) as { photos: Photo[] }).photos.map((p) => Math.round(p.lineFraction * 10) / 10);
    expect(fractions).toEqual([0.2, 0.5, 0.8]);
  });

  it('lists the queue for an admin (thumbnail, trail, author), 403 for a rider, 401 anonymous', async () => {
    const { trail, photo } = await draftPhoto();
    const res = await get('/admin/photos?status=draft', as(admin, null));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: photo.id, trailSlug: trail.slug, trailName: `Sendero ${trail.slug}`, authorEmail: 'rider@x.pe', thumbUrl: expect.stringContaining(`/${PRIVATE}/photos/${photo.id}-t.webp?`) as string }),
    ]);
    expect((await get('/admin/photos?status=draft', as(rider, null))).status).toBe(403);
    expect((await get('/admin/photos?status=draft')).status).toBe(401);
  });

  it('lets an admin publish and hide; a rider gets 403, a foreign Origin 403, an unknown id 404', async () => {
    const { trail, photo } = await draftPhoto();
    expect((await patch(photo.id, as(rider), { status: 'published' })).status).toBe(403);
    expect((await patch(photo.id, as(admin, 'https://other.vops.pe'), { status: 'published' })).status).toBe(403);
    expect((await patch(crypto.randomUUID(), as(admin), { status: 'published' })).status).toBe(404);
    expect((await patch('not-a-uuid', as(admin), { status: 'published' })).status).toBe(404);
    const res = await patch(photo.id, as(admin), { status: 'published' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: photo.id, status: 'published' });
    expect(await photosOf(trail.slug, other)).toEqual([expect.objectContaining({ id: photo.id, status: 'published' })]);
    expect((await patch(photo.id, as(admin), { status: 'hidden' })).status).toBe(200);
    expect(await photosOf(trail.slug, null)).toEqual([]);
    expect(await photosOf(trail.slug, rider)).toEqual([expect.objectContaining({ status: 'hidden' })]);
  });
});
