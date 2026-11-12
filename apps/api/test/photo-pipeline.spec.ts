// Unit checks of the photo pipeline and the storage cleanup (plan §9 V1b, V1c; review B2, B4, B5).
import { deflateSync } from 'node:zlib';
import exifr from 'exifr';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { encodePhoto, encodesRunning } from '../src/photos/image.js';
import { MediaStorage } from '../src/photos/media-storage.js';

// exifr's export cannot be spied on: a pass-through mock counts the calls.
vi.mock('exifr', async (original) => {
  const real = (await original<{ default: typeof exifr }>()).default;
  return { default: { ...real, parse: vi.fn(real.parse.bind(real)) } };
});

afterEach(() => vi.restoreAllMocks());

/** A PNG with a 4 MiB iCCP profile compressed to a few KB inserted after IHDR (exifr would inflate it). */
async function pngWithIccp(): Promise<Buffer> {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000' } }).png().toBuffer();
  const data = Buffer.concat([Buffer.from('icc\0\0', 'latin1'), deflateSync(Buffer.alloc(4 * 1024 * 1024))]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from('iCCP', 'latin1'), data]);
  const crc = Buffer.alloc(4);
  const { crc32 } = await import('node:zlib');
  crc.writeUInt32BE(crc32(body));
  const ihdrEnd = 8 + 25; // signature + IHDR chunk
  return Buffer.concat([png.subarray(0, ihdrEnd), len, body, crc, png.subarray(ihdrEnd)]);
}

const cameraJpeg = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#557733' } })
    .jpeg()
    .withExif({
      IFD2: { DateTimeOriginal: '2026:11:08 07:30:15' },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '9/1 5/1 3300/100', GPSLongitudeRef: 'W', GPSLongitude: '78/1 31/1 1200/100', GPSImgDirection: '2705/10' },
    })
    .toBuffer();

describe('the EXIF read (B2)', () => {
  it('never runs the EXIF reader on a PNG, even one with a large iCCP chunk', async () => {
    const parse = vi.mocked(exifr.parse);
    parse.mockClear();
    const png = await pngWithIccp();
    expect(png.length).toBeLessThan(64 * 1024);
    // libvips may accept or refuse the odd profile: either way the EXIF reader stays off.
    await encodePhoto(png, 'png').catch(() => undefined);
    expect(parse).not.toHaveBeenCalled();
  });

  it('reads the time, the position and the heading of a JPEG', async () => {
    const parse = vi.mocked(exifr.parse);
    parse.mockClear();
    const { exif } = await encodePhoto(await cameraJpeg(), 'jpeg');
    expect(parse).toHaveBeenCalledTimes(1);
    expect(exif.takenAt?.toISOString()).toBe('2026-11-08T12:30:15.000Z');
    expect(exif.position?.lat).toBeCloseTo(-9.0925, 6);
    expect(exif.position?.lng).toBeCloseTo(-78.52, 6);
    expect(exif.heading).toBe(270.5);
  });
});

describe('the encode cap (B5)', () => {
  it('answers exactly one of three encodes in one tick with 503 ENCODE_BUSY, and frees every slot after', async () => {
    const jpeg = await cameraJpeg();
    const results = await Promise.allSettled([encodePhoto(jpeg, 'jpeg'), encodePhoto(jpeg, 'jpeg'), encodePhoto(jpeg, 'jpeg')]);
    const busy = results.filter((r) => r.status === 'rejected');
    expect(busy).toHaveLength(1);
    expect((busy[0] as PromiseRejectedResult).reason).toMatchObject({ status: 503, response: { code: 'ENCODE_BUSY' } });
    expect(encodesRunning()).toBe(0);
  });

  it('frees the slot after a broken input', async () => {
    await expect(encodePhoto(Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]), 'jpeg')).rejects.toMatchObject({ status: 400 });
    expect(encodesRunning()).toBe(0);
  });
});

describe('MediaStorage deletes (B4)', () => {
  function storage() {
    const media = new MediaStorage(loadEnv({ ...process.env, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' }));
    const internals = media as unknown as { client: { send: (command: { input: { Delete: { Objects: { Key: string }[] } } }) => Promise<unknown> }; logger: { error: (line: string) => void } };
    const log = vi.spyOn(internals.logger, 'error').mockImplementation(() => undefined);
    return { media, internals, log };
  }
  const keysOf = (call: unknown[]) => (call[0] as { input: { Delete: { Objects: { Key: string }[] } } }).input.Delete.Objects.map((o) => o.Key);

  it('retries only the keys DeleteObjects reports in Errors, once', async () => {
    const { media, internals, log } = storage();
    const send = vi
      .spyOn(internals.client, 'send')
      .mockResolvedValueOnce({ Errors: [{ Key: 'photos/b.webp', Code: 'InternalError' }] })
      .mockResolvedValueOnce({});
    await media.unpublish(['photos/a.webp', 'photos/b.webp']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(keysOf(send.mock.calls[1]!)).toEqual(['photos/b.webp']);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs the keys still failing after the retry and throws for a delete that must succeed', async () => {
    const { media, internals, log } = storage();
    vi.spyOn(internals.client, 'send').mockResolvedValue({ Errors: [{ Key: 'photos/b.webp', Code: 'InternalError' }] });
    await expect(media.unpublish(['photos/a.webp', 'photos/b.webp'])).rejects.toThrow('media_delete_failed');
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'media_delete_failed', keys: ['photos/b.webp'] }));
    // The cleanup of a failed upload logs and never throws.
    await expect(media.discard(['photos/b.webp'])).resolves.toBeUndefined();
  });
});
