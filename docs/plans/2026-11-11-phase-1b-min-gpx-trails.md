# Phase 1b-min — GPX import and the trail detail page — Plan (rev. 3, gate closed; §6 amendments are BINDING)

**Goal:** the owner uploads a real GPX file, the API stores the trail as a draft with its path,
distance, elevation gain/loss and elevation profile, the owner publishes it, and every visitor sees it on
`/rutas/<slug>` with a 2D map and the elevation profile. First real data: the owner's three rides of
Sunday 2026-11-15, uploaded in production (the upload can come after Sunday; the GPX files stay on the
device).

**Owner decisions (2026-11-11):** uploads by the owner only (role `admin`); scope = GPX import + detail
page with a 2D map and the elevation profile; no photos, no recording in the app, no 3D (the Fable 5.2
trial in #11 comes with the full Phase 1b plan); cities stay Chimbote, Nuevo Chimbote, Trujillo (a ride
elsewhere adds a city by migration).

**Revision 2** applies the gate (opus @ high `reviewer` and gpt-6.1-sol @ high, both "request changes";
blocking: the class-level `@AllowAnonymous()` hides `@Roles`, unbounded multipart fields, joined GPX
segments). Ledger in §5.

## 0. Verified facts (code at main 21e98cb)

| Fact | Where |
|------|-------|
| `trails.path` is `geometry(LineString, 4326)`, 2D; written as EWKT, read with `ST_AsGeoJSON` as `[lng, lat]`; `distance_m`, `elevation_gain_m` integers; `department` NOT NULL; no Z, no profile column | `apps/api/src/db/types/geo.ts:12-20`, `db/schema/trails.ts:23-37` |
| Check constraints keep start/end points inside a Peru bounding box | `apps/api/drizzle/0001_trail_constraints.sql` |
| `@AllowAnonymous()` is on the **class** `TrailsController`. The adapter guard (`@thallesp/nestjs-better-auth` 2.8.0) returns early for PUBLIC before it checks `ROLES` (`dist/index.mjs:203-207` before `:227-233`); its `@Roles` reads `session.user.role` (`:310-311`) | `trails.controller.ts:9-10` |
| `user.role` exists (`text`, default `rider`, `input: false`); no code checks it | `db/schema/auth.ts:15`, `auth.options.ts:58` |
| Express 5; the adapter mounts a JSON (`1mb`) and an urlencoded parser on non-auth routes; Nest's `FileInterceptor` uses multer 2.5.0 (pinned by `@nestjs/platform-express` 12.4.2) with memory storage when no `dest` is set; `LIMIT_FILE_SIZE` maps to 413 | `main.ts:12`, `auth.module.ts:38`, adapter `index.mjs:674-697` |
| Nest order: middleware → guards → interceptors → pipes → handler, so guards run **before** `FileInterceptor` parses the multipart body; a JSON body (PATCH) is parsed by middleware before guards | docs.nestjs.com/faq/request-lifecycle |
| Better Auth checks `Origin` only when a request has a cookie or `Sec-Fetch-*` | `apps/api/test/auth/origin.int.spec.ts:26` |
| The session cookie is `SameSite=Lax`; `enduro.vops.pe`, `enduro-next.vops.pe`, `infra.vops.pe` are **one site**, so Lax sends the cookie on a same-site POST from another `*.vops.pe` app | Phase 0 §11; RFC 6265bis "same-site" |
| Migrations: drizzle-kit (journal + snapshot in `apps/api/drizzle/meta`), run at container boot; both trail suites run `TRUNCATE trails` in `beforeEach` | `docker-entrypoint.sh:3-4`, `test/trails.int.spec.ts` |
| Web: server fetch through `api-client` (`lib/api.ts`); only `getMe` forwards the cookie; browser mutations use same-origin `fetch`; no `not-found.tsx`, no `@axe-core/playwright`, `SessionHeader` not in Suspense (L3 is not built) | `apps/web/src/lib/api.ts:8-39`, `app/layout.tsx:13` |
| E2E seed: two published trails and one draft, all `city = 'Chimbote'`, start point only, `path` null | `apps/web/e2e/prepare-db.ts`, `e2e/fixtures.ts` |
| `fast-xml-parser` 5.12.0 defaults: `ignoreAttributes: true`, `isArray: () => false`; `processEntities: false` stops replacement but the parser still reads a DOCTYPE; `XMLValidator.validate` exists; no external I/O | package source v5.12.0 |
| Next.js 16 refuses `dynamic(…, { ssr: false })` in a Server Component; `/rutas/nueva` (static) wins over `/rutas/[slug]` | nextjs.org lazy-loading, routing |
| OSM tile policy: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, visible linked attribution, normal Referer, no prefetch/offline, no SLA | operations.osmfoundation.org/policies/tiles |
| `leaflet` 1.9.4 (2.0 is beta), `@types/leaflet` 1.9.22 | npm registry 2026-11-11 |

## 1. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Who may upload, edit, publish | Role `admin`, through the adapter's `@Roles(['admin'])` on every mutation. `@AllowAnonymous()` moves from the class to the two GET handlers. The owner's account gets `role = 'admin'` by a documented one-off SQL step per environment (no API to change roles). Anonymous → 401, rider → 403. |
| D2 | Transport | `multipart/form-data`, `FileInterceptor('gpx', { limits: { fileSize: 10 MiB, files: 1, fields: 6, parts: 7, fieldSize: 4 KiB, fieldNameSize: 32 } })`, memory storage. Exactly one `gpx` file is required. No direct `multer` dependency (Nest's own); `@types/multer` as a dev dependency. Text fields go through a class-validator DTO with bounded strings (name ≤ 80, description ≤ 2000). |
| D3 | CSRF | The **Origin check is the CSRF guard** (Lax does not stop same-site `*.vops.pe` apps). An `OriginGuard` on every non-GET trail route: `req.headers.origin === env.WEB_ORIGIN` exactly, else 403. Order on upload: auth → role → origin → multipart → XML. On PATCH the bounded JSON body is parsed by middleware first (accepted). |
| D4 | GPX parsing | 1) Decode with `new TextDecoder('utf-8', { fatal: true })` (a bad byte → 400). 2) Refuse `/<!DOCTYPE/i` before anything else. 3) `XMLValidator.validate` must pass. 4) Parse with `ignoreAttributes: false`, `attributeNamePrefix: ''`, `removeNSPrefix: true`, `processEntities: false`, `isArray` for `trk`, `trkseg`, `trkpt`. 5) Root must be `gpx`. 6) **Exactly one `trk` with exactly one non-empty `trkseg`**; more segments or tracks → 400 `GPX_MULTI_SEGMENT` (the owner exports or trims one continuous ride). 7) Every point: `lat`/`lon` with `Number()` + `Number.isFinite`, in range, inside the Peru bounding box; 2 ≤ points ≤ 100 000. 8) `ele`: used only if **every** point has a finite `ele` in −500…7000 m; otherwise all elevation outputs are null. Errors: 400 with a constant `code` (`GPX_INVALID`, `GPX_EMPTY`, `GPX_TOO_LARGE`, `GPX_MULTI_SEGMENT`, `GPX_OUT_OF_AREA`), never an XML snippet. |
| D5 | Storage | `path` stays 2D, full resolution. New columns on `trails`: `elevation_profile jsonb` (array of `[distance_m, ele_m]`, ≤ 300 points, null without elevation) and `elevation_loss_m integer`. Min/max elevation are derived from the profile in the DTO (the profile keeps the global extrema). New table `trail_sources`: `trail_id uuid PRIMARY KEY REFERENCES trails ON DELETE CASCADE`, `gpx text NOT NULL`, `sha256 text NOT NULL UNIQUE` (of the uploaded bytes), `uploaded_at timestamptz NOT NULL DEFAULT now()`. **Postgres is the long-term home of GPX sources** (a GPX is data, not media; TOAST compresses it): an explicit exception to architecture D10, recorded there. Size trigger to look again: the table passes 1 GB. The source is never returned by the API. |
| D6 | Numbers | All distances in TS with one haversine helper (R = 6 371 008.8 m): cumulative distance per point; `distance_m` = the last cumulative value, rounded (one source for the summary and the profile x axis). **Elevation (threshold filter):** `T = 5` m (named constant, the calibration knob); `f = ele[0]`; for each next `e`: if `e − f ≥ T` then `gain += e − f; f = e`; else if `f − e ≥ T` then `loss += f − e; f = e`; at the end add the residual `ele[last] − f` to gain (if > 0) or loss (if < 0). Integers by rounding at the end; an overflow of `int4` is refused. **Profile:** 296 equal-distance buckets keep their last point, plus the first point, the last point, the global min and the global max; deduplicate by index; sort by index (≤ 300). `start_point` / `end_point` = first / last point. |
| D7 | Slug | NFD, strip diacritics, lowercase, non-alphanumerics → `-`, trim, ≤ 56 chars (room for a suffix). Empty → 400 `SLUG_EMPTY`. Reserved: `nueva`. Collision → `-2`, `-3`, …: the insert of the trail and its source runs in one transaction; on a unique violation (23505) of the slug the transaction rolls back and is retried with the next suffix (≤ 5 tries); a 23505 of `sha256` → 409 `GPX_DUPLICATE`. |
| D8 | Endpoints | `POST /api/trails` (admin, multipart) → 201 with the detail (`status: draft`, `author_id` = the user; `department` derived: Chimbote / Nuevo Chimbote → Ancash, Trujillo → La Libertad). `PATCH /api/trails/:slug` (admin, JSON, all optional: `status`, `name`, `description`, `city`, `difficulty`, `type`; the slug does not change) → 200 with the detail. `GET /api/trails/:slug`: an admin also gets drafts and hidden trails (the response says `status`); everyone else keeps the 404. The detail adds `elevationProfile`, `elevationLossM`, and a display path simplified with `ST_SimplifyPreserveTopology` (0.00002°) — the stored path does not change. No draft list endpoint. OpenAPI + `api-client` regenerated. |
| D9 | Web | `/rutas/[slug]`: server component; `getTrail(slug, cookie)` forwards the incoming cookie; the trail loads **before** any Suspense boundary; only an API 404 → `notFound()` (HTTP 404); other failures go to the error boundary. The map: a `'use client'` wrapper that calls `dynamic(() => import('./TrailMap'), { ssr: false })` with a skeleton of the same fixed height; Leaflet CSS imported; OSM tiles at the exact policy URL with a visible linked "© OpenStreetMap" attribution; the path drawn from GeoJSON (`[lng, lat]`, converted explicitly); start/end as `circleMarker` (no marker images); `map.remove()` on cleanup. A trail with a null path shows the start point only; a null profile shows no chart. The profile: an inline SVG (no chart library) with a text summary (distance, gain, loss, min, max) for screen readers; a flat or zero-distance profile draws a flat line. Admin only: "Publicar" / "Ocultar" and an edit form for the metadata on the detail, and `/rutas/nueva` (server checks `getMe().role === 'admin'`, else `notFound()`) with a form (file, name, city, difficulty, type, description) that posts `FormData` with same-origin `fetch`, shows pending and error states (no optimistic UI), and goes to the new draft. The home list links each trail; the header shows "Nueva ruta" to an admin. B-B adds the Spanish `app/not-found.tsx` and `@axe-core/playwright` (not the rest of L3). |
| D10 | Map library | Leaflet is the 2D view. The 3D trial in #11 decides whether MapLibre GL replaces it (named trigger: the trial result); until then there is one map stack. |
| D11 | Calibration | Before the production upload, one earlier real ride is imported on staging and compared with the device: distance within 3 %, gain within 10 %. If the gain is high, raise `T` (up to 10 m) first; a median spike filter only if it is still high; if the distance is off by more than 3 %, a minimum-step filter. The algorithm is frozen before the three Sunday rides are imported. Device totals are a comparison, not ground truth. |
| D12 | Privacy | Runbook step: trim the start and end of each GPX away from home before the upload (privacy zones come later). The raw source stays private (D5). |
| D13 | Not in this slice | Photos/R2 media, recording, path editing, geometric duplicate detection (the 100 m rule), rider uploads and moderation, delete (an admin hides a trail), 3D, the Fable trial, multi-segment GPX, field Web Vitals. |

## 2. Batches and the critical path

```
B-A API ─► B-B Web ─► staging live check (D11 calibration) ─┐
P1a-1 (A5 switch, in progress) ─► P1a-3 (needs the owner's R2 keys, A8) ─┴─► production: owner = admin, upload the Sunday rides
```

### B-A — API (`apps/api/**`, `packages/api-client/**`, root lockfile, CHANGELOG)

1. Migration `0004` through `pnpm --filter api db:generate` (journal + snapshot), reviewed: the two columns
   and `trail_sources`. Both trail suites truncate `trails, trail_sources` together.
2. `gpx/parse-gpx.ts` (pure, D4), `gpx/metrics.ts` (pure, D6: haversine, threshold filter, profile).
3. `trails.service.ts`: `createFromGpx` (transaction + slug retry + duplicate mapping, D7), `update`
   (PATCH), detail for an admin.
4. Controller: `@AllowAnonymous()` on the GET handlers only; `@Roles(['admin'])` + `OriginGuard` on POST and
   PATCH; `FileInterceptor` with the D2 limits.
5. **Tests**, each rule with both sides and exact numbers:
   - parser: one-track one-segment file with a single `trk`; namespaced file; missing `lat`/`lon`
     attribute; malformed XML (truncated) → `GPX_INVALID`; DOCTYPE → `GPX_INVALID`; bad UTF-8 → `GPX_INVALID`;
     two segments → `GPX_MULTI_SEGMENT`; 1 point → `GPX_EMPTY`; 100 001 points → `GPX_TOO_LARGE`; a point
     outside the box → `GPX_OUT_OF_AREA`; one point without `ele` → null elevation outputs;
   - metrics: `100,104,108,112` → gain 12, loss 0; `100,103,100,103,100` (below T) → gain 0, loss 0;
     `100,110,100` → gain 10, loss 10; equality `100,105` → gain 5; descending symmetry; profile of 10 000
     points ≤ 300 and contains first, last, min, max; flat profile; a known two-point distance;
   - endpoints: POST and PATCH each — anonymous 401, rider 403, admin with a foreign/missing `Origin` 403,
     admin 201/200; **order proof**: an admin with a foreign `Origin` and an invalid GPX gets 403 (not 400);
     file > 10 MiB → 413; 7 text fields → 4xx before the handler; same file twice → 409; slug collision →
     `-2`; name `Nueva` → `nueva-2`; emoji-only name → `SLUG_EMPTY`; a draft visible to the admin, 404 to a
     rider and to an anonymous user; a hidden trail 404 to a rider; PATCH publish → in the public list;
     PATCH metadata keeps the slug; `department` derived from the city.
   - Mutations (recorded red → restored): `@AllowAnonymous()` back on the class (anonymous POST test red);
     drop `@Roles` on PATCH; drop the `OriginGuard`; drop the DOCTYPE refusal; `T = 0`; drop the
     bounding-box check; drop the segment-count check; drop the `isArray` option (single-`trk` test red).
6. Fixtures: three small GPX files under `apps/api/test/fixtures/` (one segment with `ele`, one without
   `ele`, two segments).

### B-B — Web (`apps/web/**`, root lockfile, CHANGELOG)

1. `/rutas/[slug]` (D9), `TrailMap` (client), `ElevationProfile` (SVG), admin controls.
2. `/rutas/nueva` (admin), links from the list and the header, `app/not-found.tsx`.
3. **E2E** (existing stack): the seed sets `role = 'admin'` for one e2e address, and the test signs in
   through the real code flow; `page.route('https://tile.openstreetmap.org/**')` returns a blank PNG.
   Cases: the admin uploads the fixture GPX → the draft detail shows the map container with the path layer,
   the attribution and the profile → publish → the trail is in the home list; a seeded trail with a null
   path renders (start point, no profile); a rider gets **HTTP 404** on `/rutas/nueva` and no admin
   controls; an unknown slug → **HTTP 404** with the Spanish page; axe scans (WCAG A/AA) of the detail and
   the upload form. Mutations: add `app/rutas/[slug]/loading.tsx` (the 404-status test must go red); drop
   the admin check of `/rutas/nueva`; drop the cookie forwarding (the admin draft test red).

### Live checks

- **Staging** (after B-B): the owner's account set to `admin`; import one earlier real ride (D11
  calibration); publish; the public page on PC and phone; then delete the trail (its source cascades) →
  0 residual rows.
- **Production** (after P1a-3): the owner set to `admin`; the three Sunday rides trimmed (D12), uploaded,
  checked, published. They stay.

## 3. Review plan

| Stage | Reviewers |
|-------|-----------|
| This plan | rev. 1: `reviewer` @ high ∥ gpt-6.1-sol @ high (done) → rev. 2: `final-reviewer` @ xhigh (approve with changes) → rev. 3. Gate CLOSED. |
| B-A (upload, XML, auth) | `reviewer` @ high ∥ gpt-6.1-sol @ high → fixes → `final-reviewer` @ xhigh |
| B-B | `reviewer` @ high → fixes → `final-reviewer` @ xhigh |

Load rules: one heavy local job at a time; reviewers run no local suites (CI is the gate); `rg`, never
`grep -r`.

## 4. Gate answers (rev. 1 §4)

1. Raw GPX in Postgres, long term (both) → D5, D10 exception recorded.
2. A single threshold, defined exactly, calibrated on a real ride before the Sunday import; named next knobs (both) → D6, D11.
3. OSM standard tiles under the full policy; stubbed in tests (both) → D9.

## 5. Gate ledger (rev. 1 → rev. 2)

| Finding | Source | Where fixed |
|---------|--------|-------------|
| Class-level `@AllowAnonymous()` makes `@Roles` a no-op | both (blocking) | §0, D1, B-A.4, mutation |
| Multipart fields/parts unbounded | gpt (blocking) | D2 |
| Joining segments invents a ride across gaps | gpt (blocking) | D4.6, test, mutation |
| Lax is not CSRF protection on `*.vops.pe`; exact Origin predicate; real order | both | §0, D3, order-proof test |
| Parser options, validation, encoding, numeric checks | both | D4, tests |
| Distance from two sources | opus | D6 (one haversine helper) |
| Hysteresis undefined; partial `ele` | gpt | D4.8, D6, exact tests |
| Profile can exceed 300 points; flat profile | both | D6, D9 |
| Slug: `nueva`, empty, race, atomic insert | both | D7, tests |
| Cookie forwarding; `department`; 404 vs other errors | both | D8, D9, mutation |
| Next/Leaflet boundary; coordinate order; markers | both | D9 |
| FK breaks `TRUNCATE trails`; migration journal | gpt | B-A.1 |
| E2E: real admin session, tile stub, HTTP-status 404, defined mutation | both | B-B.3 |
| Null path/profile rendering | opus | D9, e2e case |
| PATCH has no auth tests | opus | B-A.5 |
| B-B depends on L3 pieces | opus | §0, D9 (adds only not-found + axe) |
| Critical path to Sunday | opus | §2 |
| No metadata edit | opus | D8 (PATCH metadata) |
| Home address in the public track | opus | D12 |
| "Move to R2 later" is a stopgap | both | D5 |
| One map stack | opus | D10 |
| Cut: draft list, min/max columns, direct `multer`, `<!ENTITY` check | both | D2, D4, D5, D8 |

## 6. Rev. 3 amendments — BINDING (they replace any conflicting text above)

From the final review (`final-reviewer` @ xhigh, approve with changes, no blocking).

**M1 — tests that can fail for their rule (B-A.5).** The order proof is: an admin with a foreign `Origin`
and **7 text fields** gets 403 (not 400 "Too many fields"), which proves origin before multipart. The field
test asserts the message matches `/Too many (fields|parts)/`. Mutations added: move the origin check into
an interceptor after `FileInterceptor` (order proof red); delete `fields`/`parts` from the limits (field
test red).

**M2 — PATCH DTO (D8).** `@ValidateIf((_, v) => v !== undefined)` instead of `@IsOptional()` (so `null`
is validated and refused); an empty body → 400; `updatedAt` set explicitly. Tests: `{"name": null}` → 400,
`{}` → 400.

**M3 — one `departmentOf(city)` (D8)** in create and update. Test: PATCH city Trujillo → department
La Libertad.

**M4 — no GPX in the logs (D5, D12).** `createFromGpx` maps the two 23505 cases; every other DB error is
logged only as `{ event, code: err.cause?.code, constraint }` and rethrown as
`InternalServerErrorException` with no `cause` (drizzle's `DrizzleQueryError` message carries the params,
i.e. the whole GPX). Test with a capture logger (pattern of `test/auth/logging.int.spec.ts`): a forced DB
error leaves no GPX text in the log.

**M5 — small parser/metric guards.** `ele` counts only when `typeof ele === 'number'` (an empty `<ele/>`
is not 0). A total distance of 0 → `GPX_EMPTY`. One test each.

**M6 — slug retry mechanics (D7).** The retry loop is **outside** `db.transaction`; match
`err.cause.code === '23505'` and `err.cause.constraint` (`trails_slug_unique` or the sha256 constraint), as
`test/trail-constraints.int.spec.ts:41` does. After 5 tries → 409 `SLUG_TAKEN`.

**M7 — e2e admin (B-B.3).** `prepare-db.ts` INSERTs the admin user (`email_verified` true, `role` admin);
the admin signs in once per run (one serial `describe` or `storageState`, or `endCooldown()`), using the
last code.

**M8 — `fieldSize: 8 KiB`** (D2), so a 2000-code-point description fits on POST as on PATCH.

**M9 — 409 carries the existing `slug`** and the form links to it; the D11 runbook deletes the staging
import before a new import.

**M10 — docs in B-A scope.** The D10 exception row in `docs/architecture/phase-0-foundation.md`; a runbook
`docs/operations/trails-import.md` with the role SQL (per environment), the trim step (D12), a segment
merge in a GPX editor for a device that writes one `trkseg` per pause, and the staging delete.
