// Browser calls for the photos ("vistas", plan §9 V1–V5) on the same origin: the browser sends the
// `Origin` header the API's OriginGuard checks, and the session cookie.
import type { components } from 'api-client';
import { MESSAGES } from './auth-errors';
import { canMark, type Fix } from './tracer';
import { PATCH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './trails-client';

export type Photo = components['schemas']['PhotoDto'];
export type PhotoStatus = Photo['status'];
export type PhotoFailure = { status: number; code?: string };
export type PhotoResult = { ok: true; photo: Photo } | ({ ok: false } & PhotoFailure);

async function send(path: string, init: RequestInit, timeoutMs: number): Promise<PhotoResult> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, status: 0 }; // network failure or timeout
  }
  const json = (await response.json().catch(() => null)) as (Photo & { code?: string }) | null;
  if (!response.ok) return { ok: false, status: response.status, code: json?.code };
  if (json === null) return { ok: false, status: response.status };
  return { ok: true, photo: json };
}

export const uploadPhoto = (form: FormData) => send('/api/photos', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);

export const updatePhoto = (id: string, status: PhotoStatus) =>
  send(
    `/api/photos/${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) },
    PATCH_TIMEOUT_MS,
  );

/** Deletes a photo and its files (admin, plan §9 V1c): ok on 204. */
export async function deletePhoto(id: string): Promise<{ ok: true } | ({ ok: false } & PhotoFailure)> {
  let response: Response;
  try {
    response = await fetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', signal: AbortSignal.timeout(PATCH_TIMEOUT_MS) });
  } catch {
    return { ok: false, status: 0 };
  }
  if (response.ok) return { ok: true };
  const json = (await response.json().catch(() => null)) as { code?: string } | null;
  return { ok: false, status: response.status, code: json?.code };
}

/**
 * The phone position sent with a photo: only a fix that passes the tracer gate (≤ 30 m, ≤ 10 s, V2).
 * Otherwise none, and the API falls back to the photo's EXIF GPS.
 */
export function positionFields(fix: Fix | null, now: number): { lat: string; lng: string } | null {
  return canMark(fix, now) ? { lat: String(fix.lat), lng: String(fix.lng) } : null;
}

const CODE_MESSAGES: Record<string, string> = {
  NO_TRAIL_NEARBY: 'No hay un sendero a menos de 50 m.',
  NO_POSITION: 'No sabemos dónde tomaste la foto. Activa tu ubicación.',
  PHOTO_TYPE: 'La foto debe ser JPEG, PNG o WebP.',
  PHOTO_INVALID: 'No pudimos leer la foto.',
  PHOTO_TOO_LARGE: 'La foto tiene demasiados píxeles.',
  TOO_MANY_PENDING: 'Tienes 20 vistas en revisión. Espera la aprobación.',
  TOO_MANY_UPLOADS: 'Demasiados intentos. Prueba en unos minutos.',
  ENCODE_BUSY: 'El servidor está ocupado. Prueba en unos segundos.',
  STORAGE_UNAVAILABLE: 'El servidor está ocupado. Prueba en unos segundos.',
};

/** The Spanish message for a failed photo upload or review, by error code first, then by status. */
export function photoErrorMessage({ status, code }: PhotoFailure): string {
  if (code && Object.hasOwn(CODE_MESSAGES, code)) return CODE_MESSAGES[code] as string;
  if (status === 413) return 'La foto pesa más de 10 MB.';
  if (status === 415) return CODE_MESSAGES.PHOTO_TYPE as string;
  if (status === 401) return 'Tu sesión venció. Ingresa de nuevo.';
  if (status === 403) return 'No tienes permiso para esta acción.';
  return MESSAGES.generic;
}
