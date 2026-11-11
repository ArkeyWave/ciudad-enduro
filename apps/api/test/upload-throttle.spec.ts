import { describe, expect, it } from 'vitest';
import { UPLOAD_ATTEMPTS, UPLOAD_WINDOW_MS, UploadAttempts } from '../src/trails/upload-throttle.js';

describe('UploadAttempts', () => {
  const t0 = 1_000_000;

  it('refuses the 11th attempt inside the window and accepts it when the first attempt leaves it', () => {
    const uploads = new UploadAttempts();
    for (let i = 0; i < UPLOAD_ATTEMPTS; i++) expect(uploads.take('a', t0)).toBe(true);
    expect(uploads.take('a', t0 + UPLOAD_WINDOW_MS - 1)).toBe(false);
    expect(uploads.take('a', t0 + UPLOAD_WINDOW_MS)).toBe(true);
    // A fresh window: 9 more attempts pass (10 in all), the next one does not.
    for (let i = 0; i < UPLOAD_ATTEMPTS - 1; i++) expect(uploads.take('a', t0 + UPLOAD_WINDOW_MS)).toBe(true);
    expect(uploads.take('a', t0 + UPLOAD_WINDOW_MS)).toBe(false);
  });

  it('drops each attempt exactly when it leaves the window, while a newer one keeps the user', () => {
    const uploads = new UploadAttempts();
    for (let i = 0; i < UPLOAD_ATTEMPTS - 1; i++) uploads.take('a', t0);
    uploads.take('a', t0 + 1);
    expect(uploads.take('a', t0 + UPLOAD_WINDOW_MS - 1)).toBe(false);
    expect(uploads.take('a', t0 + UPLOAD_WINDOW_MS)).toBe(true);
  });

  it('counts each user apart', () => {
    const uploads = new UploadAttempts();
    for (let i = 0; i < UPLOAD_ATTEMPTS; i++) uploads.take('a', t0);
    expect(uploads.take('b', t0)).toBe(true);
  });

  it('forgets a user whose attempts all left the window', () => {
    const uploads = new UploadAttempts();
    uploads.take('a', t0);
    uploads.take('b', t0 + 1);
    expect(uploads.size).toBe(2);
    uploads.take('b', t0 + UPLOAD_WINDOW_MS);
    expect(uploads.size).toBe(1);
  });
});
