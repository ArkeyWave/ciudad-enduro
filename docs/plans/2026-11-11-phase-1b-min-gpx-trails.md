# Phase 1b-min — GPX import and the trail detail page — Plan (rev. 1, for the gate)

**Goal:** the owner uploads a real GPX file, the API stores the trail as a draft with its path,
distance, elevation gain and elevation profile, the owner publishes it, and every visitor sees it on
`/rutas/<slug>` with a 2D map and the elevation profile. First live use: the owner's three rides of
Sunday 2026-11-15, uploaded in production.

**Owner decisions (2026-11-11):** uploads by the owner only (role `admin`); scope = GPX import + detail
page with a 2D map and the elevation profile; no photos, no recording in the app, no 3D (the Fable 5.2
trial in #11 comes with the full Phase 1b plan); cities stay Chimbote, Nuevo Chimbote, Trujillo (a ride
elsewhere adds a city by migration).

## 0. Verified facts (code at main 21e98cb)

| Fact | Where |
|------|-------|
| `trails.path` is `geometry(LineString, 4326)`, 2D; written as EWKT, read with `ST_AsGeoJSON`; `distance_m`, `elevation_gain_m` are integers; no Z, no profile column | `apps/api/src/db/types/geo.ts:12-20`, `db/schema/trails.ts:31-35` |
| Check constraints keep start/end points inside a Peru bounding box (`ST_X`/`ST_Y`) | `apps/api/drizzle/0001_trail_constraints.sql` |
| `@Controller('trails')` is `@AllowAnonymous()`; detail returns 404 for a draft; list never returns `path` | `trails.controller.ts:9-10`, `trails.service.ts:8-62` |
| HTTP input is validated with class-validator under a global `ValidationPipe({ whitelist, forbidNonWhitelisted })` | `configure-app.ts:5-6`, `dto/list-trails.query.ts` |
| A global Better Auth guard protects every route that is not `@AllowAnonymous()`; `@Session()` gives the user; `user.role` exists (`text`, default `rider`, `input: false`); no code checks it | `auth.module.ts:29-31`, `me.controller.ts:16-21`, `db/schema/auth.ts:15`, `auth.options.ts:58` |
| Express 5; non-auth routes get a JSON parser with limit `1mb`; no multipart parser is a direct dependency (`multer` is transitive through `@nestjs/platform-express`) | `main.ts:12`, `auth.module.ts:38` |
| Migrations: drizzle-kit, `apps/api/drizzle/`, run at container boot (`docker-entrypoint.sh:3-4`); a failed migration stops the container | `drizzle.config.ts`, `src/db/migrate.ts` |
| No XML, GPX, geo, map or chart library in any `package.json` | — |
| Web: server components fetch through `api-client` (`lib/api.ts`); browser mutations use same-origin `fetch` with `credentials: 'same-origin'`; no CSP in the repo | `apps/web/src/lib/api.ts`, `lib/auth-client.ts:11-20`, `next.config.ts` |
| The session cookie is `SameSite=Lax` (Phase 0 §11), so a cross-site POST carries no session | Phase 0 plan §11 |
| Architecture: D9 moderation through an `admin` role; D10 media on R2 by object key (later slice); slice B named "GPX import (with elevation hysteresis)" | `docs/architecture/phase-0-foundation.md:29-30,110` |
| UX standard R5: a `[param]` route loads its resource before the first Suspense boundary, so a missing resource returns HTTP 404 | `docs/plans/2026-11-10-agents-gates-ux-standard.md` §6 |
| Libraries: `fast-xml-parser` 5.12.0, `leaflet` 1.9.4, `@types/leaflet` 1.9.22 | npm registry, 2026-11-11 |

## 1. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Who may upload and publish | Role `admin` only. The owner's account gets `role = 'admin'` by a documented one-off SQL step per environment (no UI, no API to change roles). A rider gets 403, an anonymous caller 401. |
| D2 | Transport | `multipart/form-data` through Nest's `FileInterceptor` (multer, memory storage), one file field `gpx`, `limits.fileSize` 10 MiB, `files: 1`. `multer` becomes a direct dependency at the version Nest pins. The text fields go through a class-validator DTO. |
| D3 | CSRF on mutations | `SameSite=Lax` already keeps the session off a cross-site POST. In addition, every non-`GET` trail route requires `Origin` == `WEB_ORIGIN` (the same predicate the auth routes use); a missing or other origin → 403 before any parsing. |
| D4 | Parser | `fast-xml-parser` with `processEntities: false`, `allowBooleanAttributes: false`; the raw text is refused before parsing if it contains `<!DOCTYPE` or `<!ENTITY`. Read every `trk/trkseg/trkpt` (`lat`, `lon`, optional `ele`) in order; segments are joined. No `rte`/`wpt` support. Refuse: no track point, fewer than 2 points, more than 100 000 points, a coordinate out of range, a point outside the Peru bounding box. Errors are 400 with a stable `code` (`GPX_INVALID`, `GPX_EMPTY`, `GPX_TOO_LARGE`, `GPX_OUT_OF_AREA`). |
| D5 | Storage | `path` stays 2D (full resolution). New columns: `elevation_profile jsonb` (array of `[distance_m, ele_m]`, at most 300 points, null when the GPX has no `ele`), `elevation_loss_m integer`, `ele_min_m`, `ele_max_m` (integers). New table `trail_sources` (`trail_id` FK cascade, `gpx text`, `sha256 text unique`, `uploaded_at`): the original file is kept so the numbers can be computed again; the same file twice → 409 `GPX_DUPLICATE`. Moving the source to R2 belongs to the media slice (D10). |
| D6 | Numbers | `distance_m` = `ST_Length(path::geography)` in the insert. Elevation gain/loss with a hysteresis threshold of 5 m on the raw `ele` series (a named constant, the calibration knob; tuned with the Sunday tracks against the device's own numbers). Profile: cumulative distance on the geography, downsampled to ≤ 300 points by distance buckets (keep each bucket's last point and the global min/max). `start_point` / `end_point` = first / last track point. |
| D7 | Slug | From the name: NFD, strip diacritics, lowercase, non-alphanumerics → `-`, trim, max 60 chars; on collision append `-2`, `-3`, … inside the insert transaction. |
| D8 | Endpoints | `POST /api/trails` (admin, multipart) → 201 with the detail (status `draft`, `author_id` = the user). `PATCH /api/trails/:slug` (admin, JSON `{ status }`, one of `draft`/`published`/`hidden`) → 200. `GET /api/trails/:slug`: an admin also gets drafts and hidden trails; everyone else keeps the 404. The detail adds `elevationProfile`, `elevationLossM`, `eleMinM`, `eleMaxM`, and a display path simplified with `ST_SimplifyPreserveTopology` (tolerance 0.00002° ≈ 2 m) — the stored path is not changed. `GET /api/trails?status=draft` for an admin only (else 400). OpenAPI + `api-client` regenerated. |
| D9 | Web | `/rutas/[slug]`: server component, loads the trail before any Suspense boundary (`notFound()` → 404); a client map component (Leaflet, loaded with `next/dynamic`, `ssr: false`, OpenStreetMap tiles with the required attribution) with a fixed-height skeleton; the elevation profile as an inline SVG (no chart library) with a text summary (distance, gain, loss, min/max) for screen readers. Admin only: "Publicar" / "Ocultar" on the detail, and `/rutas/nueva` (the server checks `getMe().role === 'admin'`, else 404) with a form (file, name, city, difficulty, type, description) that posts `FormData` with same-origin `fetch`, shows pending and error states (no optimistic UI, UX D7), and goes to the new draft. The home list links each trail to its detail; the header shows "Nueva ruta" to an admin. Spanish copy, no helper text. |
| D10 | Not in this slice | Photos and R2 media, recording in the app, editing a path, duplicate detection by geometry (the 100 m rule), rider uploads and moderation, 3D, the Fable trial, field Web Vitals. |

## 2. Batches

```
B-A  API: migration, parser, numbers, endpoints, role + origin checks, contract ─► B-B  Web: detail, upload, publish, links
```

### B-A — API (`apps/api/**`, `packages/api-client/**`, the CHANGELOG)

1. Migration `0004`: the four columns and `trail_sources` (hand-reviewed SQL; `down` not used by the project).
2. `gpx/parse-gpx.ts` (pure): D4 rules → `{ points: {lat, lon, ele?}[] }` or a typed error.
3. `gpx/elevation.ts` (pure): hysteresis gain/loss, min/max, profile downsampling (D6).
4. `trails.service.ts`: `createFromGpx`, `setStatus`, detail for admin, `status=draft` list.
5. Controller: `POST` with `FileInterceptor`, `PATCH`; an `AdminGuard` (role check from `@Session()`; use the adapter's `@Roles` only if it reads the same `user.role`) and an `OriginGuard` on non-GET routes.
6. **Tests** (integration on the real test DB, plus unit tests for the pure parts), each rule with both sides:
   parser — valid multi-segment track; no `trkpt`; DOCTYPE/ENTITY refused; out-of-range and out-of-area
   points; > 100 000 points; missing `ele` → null profile. Elevation — noise below 5 m → gain 0; a real
   climb counted once; downsampling keeps ≤ 300 points and the min/max. Endpoints — anonymous 401, rider 403,
   admin 201; foreign or missing `Origin` 403 with 0 rows; file > 10 MiB 413; the same file twice 409;
   slug collision → `-2`; a draft visible to the admin and 404 to a rider; `PATCH` publish → visible in the
   list; `status=draft` refused for a rider.
   Mutations (recorded red → restored): drop the admin check; drop the origin check; drop the DOCTYPE
   refusal; set the hysteresis to 0; remove the bounding-box check; remove the duplicate check.
7. Fixtures: two small real-shaped GPX files (one with `ele`, one without) under `apps/api/test/fixtures/`.

### B-B — Web (`apps/web/**`)

1. `/rutas/[slug]` with the map and the profile (D9); admin publish/hide buttons.
2. `/rutas/nueva` (admin), links from the home list and the header.
3. **E2E** (existing stack; the e2e seed gets an admin user and a path + profile on one trail): the admin
   uploads the fixture GPX → the draft detail shows the map container and the profile → publish → the trail
   appears in the home list; a rider gets 404 on `/rutas/nueva` and sees no publish button; an unknown slug
   → the 404 page; axe scans of the detail and the upload form (WCAG A/AA). Mutations: remove the admin check
   on `/rutas/nueva`; render the map before `notFound()` (the 404 test must go red).

### Live check (both batches merged, staging)

The owner's account set to `admin` on staging; upload one real GPX (an earlier ride of the owner, or a
public sample track inside the bounding box) → check the numbers against the device's → publish → check
the public page on PC and phone → delete the trail and its source row → 0 residual rows. In production the
same after P1a-3, with the Sunday rides as the real data (not deleted).

## 3. Review plan

| Stage | Reviewers |
|-------|-----------|
| This plan | opus @ high (`reviewer`) ∥ gpt-6.1-sol @ high → final `final-reviewer` @ xhigh |
| B-A (security-relevant: upload, XML, auth) | `reviewer` @ high ∥ gpt-6.1-sol @ high → fixes → `final-reviewer` @ xhigh |
| B-B | `reviewer` @ high → fixes → `final-reviewer` @ xhigh |

Load rules: one heavy local job at a time; reviewers run no local suites (CI is the gate); `rg`, never
`grep -r`.

## 4. Open questions for the gate

1. Is keeping the raw GPX in Postgres (`trail_sources`) right until the media slice, or should B-A wait for R2?
2. 5 m hysteresis on raw GPS `ele` — reasonable start, or compute gain from a smoothed series?
3. OpenStreetMap standard tiles for a public site with low traffic — acceptable under the OSM tile policy, or use another provider now?
