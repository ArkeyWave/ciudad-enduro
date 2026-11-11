// Browser calls to the admin trail routes on the same origin. Plain fetch, so the browser sends the
// `Origin` header that the API's OriginGuard (CSRF) checks, and the session cookie.
import type { components, TrailDetail } from 'api-client';
import { MESSAGES } from './auth-errors';

/** A GPX upload can be 10 MiB on a slow phone link. */
export const UPLOAD_TIMEOUT_MS = 60_000;
export const PATCH_TIMEOUT_MS = 10_000;

export type TrailUpdate = components['schemas']['UpdateTrailDto'];

/** `slug` is the existing trail when the same GPX is already uploaded (409 GPX_DUPLICATE). */
export type TrailFailure = { status: number; code?: string; slug?: string };
export type TrailResult = { ok: true; trail: TrailDetail } | ({ ok: false } & TrailFailure);

async function send(path: string, init: RequestInit, timeoutMs: number): Promise<TrailResult> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, status: 0 }; // network failure or timeout
  }
  const json = (await response.json().catch(() => null)) as (TrailDetail & { code?: string }) | null;
  if (!response.ok) {
    const slug = typeof json?.slug === 'string' ? json.slug : undefined;
    return { ok: false, status: response.status, code: json?.code, slug };
  }
  // A 2xx that is not JSON (a proxy or captive-portal page) is not the trail.
  if (json === null) return { ok: false, status: response.status };
  return { ok: true, trail: json };
}

export const uploadTrail = (form: FormData) => send('/api/trails', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);

export const updateTrail = (slug: string, body: TrailUpdate) =>
  send(
    `/api/trails/${encodeURIComponent(slug)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    PATCH_TIMEOUT_MS,
  );

const CODE_MESSAGES: Record<string, string> = {
  GPX_INVALID: 'El archivo no es un GPX válido.',
  GPX_EMPTY: 'El GPX no tiene un recorrido.',
  GPX_TOO_LARGE: 'El GPX tiene demasiados puntos.',
  GPX_MULTI_SEGMENT: 'El GPX tiene más de un tramo. Sube un solo recorrido continuo.',
  GPX_OUT_OF_AREA: 'El recorrido está fuera del Perú.',
  GPX_DUPLICATE: 'Este GPX ya está subido.',
  SLUG_EMPTY: 'El nombre necesita letras o números.',
  SLUG_TAKEN: 'Ya hay varias rutas con este nombre. Usa otro nombre.',
  TOO_MANY_PENDING: 'Ya tienes 3 rutas en revisión. Espera la aprobación antes de registrar otra.',
};

/** The Spanish message for a failed upload or edit, by error code first, then by status. */
export function trailErrorMessage({ status, code }: TrailFailure): string {
  if (code && Object.hasOwn(CODE_MESSAGES, code)) return CODE_MESSAGES[code] as string;
  if (status === 413) return 'El archivo pesa más de 10 MB.';
  if (status === 401) return 'Tu sesión venció. Ingresa de nuevo.';
  if (status === 403) return 'No tienes permiso para esta acción.';
  return MESSAGES.generic;
}
