# UI redesign, layer 1: Night Rider on the screens the API already supports

Status: **built and live on enduro.vops.pe (2026-11-11, `5a770c1`)**. Gate: opus @ high and gpt-6.1-sol @ high both REVISE; their findings (opus F1–F24, gpt F01–F18) were applied as binding rules in the build PRs (#50 API, #52 web; their bodies list each one). Issue: #13.

**Goal:** the pages that work today look like the approved prototype (`15-ciudad-enduro/ui-redesign/`,
brief `15-ciudad-enduro/docs/plans/2026-09-16-ui-redesign-design.md`) on staging (enduro-next.vops.pe):
`/`, a new `/mapa`, `/rutas/[slug]`, `/rutas/nueva`, `/ingresar`, the error page and the not-found page.
Target: before the owner's first real rides on Sunday 2026-11-15. Every e2e test that is green today
stays green. No new UI library. **Later layers:** §5.

## 0. Verified facts (main 15c7af1, prototype read-only)

| Fact | Where |
|------|-------|
| Prototype tokens: `--bg #0A0A0A`, `--bg-soft #111`, `--card #141414`, `--card-hi #1A1A1A`, `--border #2A2A2A`, `--border-hi #3A3A3A`, `--text #F5F5F5`, `--muted #A3A3A3`, `--dim #8A8A8A`, `--lime #CCFF00`, `--lime-dim #99CC00`, `--cyan #00D4FF`, `--red #FF3333`, `--green #00E676`, `--amber #FFB020`; difficulty colours `#00E676 / #FFB020 / #FF5555`. Fonts Bebas Neue (display) and Inter 400–700. `--nav-h: 80px`. A global `:focus-visible` lime outline and a `prefers-reduced-motion` rule. | `ui-redesign/styles.css:6-36, 705-708` |
| The prototype's 44 px misses: `.toggle button` 46×38, `.back` 40, `.map-ctrl` 42, `.chip` 36. Stat labels are 9 px. | `styles.css` |
| Prototype Explorar: an eyebrow (city), the headline "¿Qué desafíos quieres **superar hoy?**", a toggle between a swipe deck and a map. A card shows a difficulty pill, the name in Bebas, a mini elevation SVG (fake data) and Distancia / Desnivel / Pendiente / Duración. The map has difficulty pins and a bottom mini-card. | `app.js:363-540` |
| Prototype Pendiente = `round(elevation / distance_m × 100)`. | `app.js:62` |
| Prototype Detalle: a 300 px photo hero with a back button and a fade, then a body pulled up 30 px: pill and type, a 40 px title, a stats row, an elevation card, a 220 px map card, the description, the contributor, "Recorrer", and "Cómo llegar al inicio" (a Google Maps `dir` link). | `app.js:556-620` |
| Prototype bottom nav: Explorar · Retos · FAB · Comunidad · Perfil. The FAB opens a sheet with "Importar GPX" among its options. | `app.js:223-256` |
| The prototype uses keyless Esri `World_Dark_Gray_Base` and `_Reference` tiles, attribution "Esri". | `app.js:151-160` |
| The web app has no CSS file and no Tailwind: 43 inline `style={{}}`, plus the shared constants in `components/sign-in/styles.ts` (`LIME`, buttons, input) that 8 files import. `layout.tsx` sets the body colours inline. | `apps/web/src` |
| `GET /api/trails` (`TrailSummaryDto`) returns `id, slug, name, city, difficulty, type, start, distanceM`, **not** the gain, the loss or the profile. The detail adds `elevationGainM/LossM/MinM/MaxM`, `elevationProfile` (≤ 300 `[d, e]` pairs), `path`, `end`, `status`, `description`. No duration, rating, photos, contributor or completions field anywhere. | `apps/api/src/trails/dto/trail.dto.ts`, `trails.service.ts:12-21` |
| `TrailMap` uses OSM at the policy URL with a linked attribution. `MAP_HEIGHT = 320` is shared with its skeleton. The detail loads the trail before any Suspense boundary (HTTP 404); no `loading.tsx` there. | `components/trail/*`, `app/rutas/[slug]/page.tsx` |
| L3 of the UX standard is **not built**: no `<Suspense>` around `SessionHeader`, no home skeleton, no `a11y.spec.ts`, no LHCI. Binding R5: the home skeleton is a `<Suspense>` inside `app/page.tsx`, never `app/loading.tsx`. | `layout.tsx`, UX plan §6 R5 |
| e2e selectors that depend on the markup: `link 'Nueva ruta'` (trails.spec:83, :164), `getByText('Trujillo · Difícil · Cross-country · Borrador'/'Publicada')` (:95, :116), `link 'Ingresar'` (strict, error-page.spec), `heading <trail name>` on `/` (home.spec), testids `trail-map`, `elevation-profile`, `trail-description`, `session-email`, `dt:text-is() + dd` facts, labels Nombre/Ciudad/Dificultad/Tipo/Correo/Código, buttons Subir ruta/Publicar/Ocultar/Guardar/Salir, the 390 px fit test. | `apps/web/e2e/*.spec.ts` |
| The seed has two published trails and one draft, with no path and no profile. | `e2e/fixtures.ts`, `e2e/prepare-db.ts` |
| No CSP header (`next.config.ts`), so `next/font` and a tile change need no header edit. | `apps/web/next.config.ts` |

## 1. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | How the styles are written | One `apps/web/src/app/globals.css`, imported in `layout.tsx`: the tokens as `:root` custom properties copied verbatim from the prototype, a base layer (body, `:focus-visible`, reduced motion), and **only** the prototype classes this layer uses (`.head .eyebrow .h-display .stat(s) .diff-pill .card .cta(.ghost) .toggle .field .dropzone .back .bottom-nav .nav-item .nav-fab .mini-card .elev`) plus the Leaflet overrides. Class names stay as in the prototype, so the RN port can map them. No CSS Modules, no Tailwind. Inline styles are removed from every file this layer touches. `sign-in/styles.ts` is deleted when its last importer moves to classes. |
| D2 | Fonts | `next/font/google` (Bebas Neue 400; Inter 400/500/600/700, `display: swap`): built into Next, self-hosted at build time with a size-adjusted fallback (no CLS, no runtime request to Google), OFL. Exposed as `--font-display` / `--font-body` through `variable`. If the image build cannot reach Google Fonts, use `next/font/local` with the woff2 files committed. |
| D3 | Prototype deviations for a11y (recorded) | Minimum target 44×44 px for `.toggle` buttons, `.back`, map controls, nav items and the Leaflet zoom buttons (`.leaflet-bar a`). Text never below 11 px (the 9–10 px stat and nav labels go to 11 px). Leaflet attribution at 11 px. If axe reports a contrast failure on a tinted pill, change the text colour, not the tint. |
| D4 | Desktop | No phone frame. One centred column `max-width: 720px` on all pages. At ≥ 720 px the bottom nav becomes an inline row under the top bar (same element, CSS only). A wide two-pane layout waits for a later layer. |
| D5 | App shell | **Top bar** (`SessionHeader`, restyled): a Bebas wordmark "CIUDAD ENDURO" in lime; on the right the session (e-mail with ellipsis, "Salir") or "Ingresar". It keeps today's 390 px behaviour. **Bottom nav** (new client `components/AppNav.tsx`, `usePathname` → `aria-current="page"`): **Explorar** (`/`) · **Mapa** (`/mapa`) · admin only, a centre FAB link **"Importar GPX"** (`/rutas/nueva`, `aria-label`). No Retos, Ranking, Comunidad or Perfil. "Nueva ruta" leaves the header (the FAB replaces it; two links with one purpose also break strict selectors). "Ingresar" stays only in the top bar (a second one breaks `error-page.spec`). Fixed at the bottom with `z-index: 1100` (above Leaflet's 400–1000). `body` gets `padding-bottom: calc(var(--nav-h) + env(safe-area-inset-bottom))` under 720 px. The admin flag comes from the server: the layout passes `isAdmin(me)` from `getMe` (cached per request). |
| D6 | Explorar list vs swipe | The swipe deck means Guardar/Pasar, which needs saved trails (no API). Layer 1 renders the **same card** in a vertical list: every trail visible, keyboard-friendly, `home.spec` stays green. Each card is one link to the detail. **O1**. |
| D7 | Explorar list ↔ map | Two server routes, `/` (Lista) and `/mapa` (Mapa), with a shared Explorar head (eyebrow "Chimbote · Trujillo", headline, "N senderos", the `.toggle` as **two links** with `aria-current`). No client state; back/forward and deep links work. `/mapa` uses a client `ExploreMap` (dynamic, `ssr: false`, fixed-height skeleton) with one `circleMarker` per trail start (class `trail-pin`, colour by difficulty). A pin click selects it and shows a bottom `.mini-card` (a link). The first trail is preselected. Pins are not keyboard targets: the mini-card link is, and the list is the accessible alternative. A "Ver como lista" link sits in the map region. |
| D8 | Card data and the API addition | The summary gains `elevationGainM`, `elevationLossM`, `elevationProfile` (nullable): three existing columns added to `summaryColumns`, no new logic, no migration. The web draws the mini profile: `sampleProfile(profile, 40)` in `lib/profile.ts` (evenly spaced by index, first and last kept), through the existing `profilePolyline` into a `.elev` SVG (`aria-hidden`). Stats as text on the card. Pendiente: `slopePct(gainM, distanceM)` = `round(gain / distance × 100)` (prototype formula), `null` when either value is null or the distance is 0 (stat hidden). Cards show Distancia, Desnivel, Pendiente. Duración omitted (no data, **O3**). Rating, photos, contributor, completions omitted. `ponytail:` the full profile rides in the list (~6 KB per trail, server to server; the browser gets a 40-point SVG); at ~200 trails, sample in the API or paginate. |
| D9 | Detalle | The prototype layout with the **map as the hero** (no photos). `TrailMapLoader` full-bleed at 300 px (`MAP_HEIGHT` → 300) with a "Volver" `.back` link (44 px) to `/` and the bottom fade. Body pulled up 30 px: difficulty pill · type · for an admin a status chip `data-testid="trail-status"`; an `h1` in Bebas 40; an eyebrow with the city; the stats row (Distancia, Desnivel, Pendiente); a `.card` "Perfil de elevación" with `ElevationProfile` (its `dl` facts and testids kept, classes only); the description (`trail-description`); the `TrailAdmin` controls restyled (`.cta`, `.field`, same names); "Cómo llegar al inicio" (`.cta.ghost`, an external Google Maps `dir` link from `start`, no API). "Recorrer" and the bookmark wait for later layers. Loading order and 404 behaviour unchanged. |
| D10 | Importar GPX, Ingresar, error, not-found | Restyle only: same fields, labels, names, button texts, alerts. `/rutas/nueva` gets a `.head` ("IMPORTAR GPX"); the file input sits inside a `.dropzone` `<label>` with the visible text "Archivo GPX" (native input stays, `name="gpx"`). Selects stay selects. `/ingresar`: `.head` and `.field`/`.cta`. Error and not-found pages: `.head`, a `.cta` "Reintentar" / "Ir al inicio", the error message in `role="alert"`. |
| D11 | Map tiles | **Stay on OSM standard tiles** (policy URL, linked "© OpenStreetMap", e2e stub in place). Dark look: `.leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) grayscale(.4) }`, tile pane only, so the path, pins and attribution keep their colours; the attribution stays visible. The prototype's keyless Esri tiles are **not** used: Esri basemaps in a public app need an ArcGIS account or key and "Powered by Esri" plus data attribution. **O2**. |
| D12 | UX states (standard L3 rules, only on the pages touched) | `/`: `<Suspense>` **inside `app/page.tsx`** with a card-shaped skeleton (`data-testid="trail-list-skeleton"`, 3 cards of final height) around the async list (R5). `/mapa`: same pattern, map-shaped skeleton. Empty state: "Aún no hay senderos publicados." plus a next action ("Importar GPX" for an admin; otherwise text only). Error: root `error.tsx` (restyled, `role="alert"`, retry). The detail stays as is (no skeleton route, 1b D9). Not here: L3's Suspense around `SessionHeader`, LHCI, the pre-commit hook. |
| D13 | Motion | Only `:active` scale and `transition` on the toggle and nav (prototype values). No screen-enter animation, no swipe. The prototype's reduced-motion rule is copied. |
| D14 | Acceptance | `e2e/screens.spec.ts` captures full-page screenshots at **390×844** and **1280×800** of `/`, `/mapa`, a detail with a profile, `/rutas/nueva` (admin), `/ingresar` (tiles stubbed), attached with `testInfo.attach` and uploaded by the CI artifact step (extend it if it does not cover `test-results/`). **Not** pixel baselines. The owner compares them with the prototype at 390 px and signs off on the PR; the same views are checked live on staging on a phone. |

## 2. Batches and the critical path

```
U-A tokens + shell ─► U-B API summary + Explorar (/ and /mapa) ─► U-C Detalle + forms restyle ─► staging, owner sign-off
```

U-A and U-B merged by **Fri 2026-11-13**, U-C by **Sat 2026-11-14**. If time runs short, U-C slips after
Sunday: uploads work without it. Each batch: implementer (TDD) → `reviewer` @ high → fixes →
`final-reviewer` @ xhigh. CI is the gate; reviewers run no local suites. If the L3 batch runs at the same
time, whichever merges second rebases `layout.tsx` and `app/page.tsx`.

Shared e2e helpers (added in U-A, `e2e/ui.ts`): `expectTarget(locator)` (bounding box ≥ 44×44);
`axe(page)` (moved from `trails.spec.ts`); `stubTiles(context)` (the OSM blank-PNG route, moved from
`header.spec`/`trails.spec`).

### U-A — tokens, fonts, shell (`apps/web/**`, CHANGELOG)

1. `globals.css` (D1, D3, D11 overrides, D13); fonts (D2) in `layout.tsx`; inline body style removed.
2. `SessionHeader` restyle (D5); "Nueva ruta" removed. `AppNav` with Explorar, Mapa (until U-B lands,
   `/mapa` is a server page with the Explorar head and a "Próximamente" line, so the link is never dead)
   and the admin FAB.
3. Restyle `error.tsx` and `not-found.tsx` (D10).
4. **Red first** (`e2e/shell.spec.ts`): at 390 the nav is visible, `link 'Explorar'` has
   `aria-current="page"` on `/`, `expectTarget` passes per nav item; an admin sees `link 'Importar GPX'`,
   a rider none; at 1280 the nav is in the flow (`top` < 200 px); keyboard: Tab reaches the wordmark, the
   session, then the nav, and the focused element's `outline-style` ≠ `none`; `axe(page)` on `/` and the
   not-found page; `getComputedStyle(h1).fontFamily` contains "Bebas".
5. **Selector updates:** `trails.spec:83` → `link 'Importar GPX'`; `:164` → `link 'Importar GPX'` count 0.
   `header.spec` unchanged and green with the nav present (no horizontal scroll at 390).
6. **Mutations** (red → restored): delete `:focus-visible` → keyboard test red; nav item
   `min-height: 40px` → target test red; drop `aria-current` → nav test red; nav `z-index` below 1000 →
   a new check red (at 390 on a detail scrolled so the map sits under the nav, `elementFromPoint` at the
   nav centre must be inside the nav).

### U-B — summary fields, Explorar list and map (`apps/api/**`, `packages/api-client/**`, `apps/web/**`, CHANGELOG)

1. API: `summaryColumns` + `TrailSummaryDto` get `elevationGainM`, `elevationLossM`,
   `elevationProfile` (D8). Regenerate OpenAPI and `api-client` (`contract` job).
2. Web: `lib/profile.ts` (`sampleProfile`, `slopePct`); `components/trail/TrailCard.tsx` (server);
   `app/page.tsx` (Explorar head + Suspense list, D12); `app/mapa/page.tsx` +
   `components/trail/ExploreMap.tsx` (D7). Leaflet's base layer and attribution move into one
   `components/trail/tiles.ts` shared by `TrailMap` and `ExploreMap`.
3. Seed: one published trail in `prepare-db.ts` gets `distance_m = 4200`, `elevation_gain_m = 380`,
   `elevation_loss_m = 410` and a 5-point profile. The draft stays as is.
4. **Red first**: API int (`trails.int.spec.ts`): the list returns gain, loss, profile for the profiled
   trail and `null` for a bare one. Unit (`profile.test.ts`): `slopePct(380, 4200)` = 9;
   `slopePct(null, 4200)`, `slopePct(10, 0)`, `slopePct(10, null)` = null; `sampleProfile` of 300 points
   gives 40 with first and last kept, of 5 gives 5. e2e `explore.spec.ts`: each published trail is a card
   link (`home.spec` unchanged); the profiled card shows `Distancia 4,2 km`, `Desnivel 380 m`,
   `Pendiente 9 %` and one `.elev` SVG, the bare card no Pendiente and no SVG; `link 'Mapa'` → `/mapa`
   with `aria-current`; `path.trail-pin` count = 2; the mini-card link opens the detail; `link 'Lista'`
   goes back; `expectTarget` on both toggle links; axe on `/` and `/mapa`. Hung API (port 3104): `/`
   shows `trail-list-skeleton` first, then "No pudimos cargar esta página"; the existing hung test stays
   green, including its no-leak HTML assertions.
5. **Mutations**: drop `elevationGainM` from `summaryColumns` → API test red; `slopePct` uses the loss →
   unit red; remove the `<Suspense>` → skeleton test red; move it to `app/loading.tsx` → the `/ingresar`
   hung test must go red (R5), else record why; pins without `trail-pin` → map test red.

### U-C — Detalle, Importar GPX, Ingresar (`apps/web/**`, CHANGELOG, `docs/features.json`, `docs/progress.md`)

1. Detail layout (D9); `TrailAdmin`, `TrailFields`, `NewTrailForm`, `SignInForm`, `SignOutButton` move
   to classes; delete `sign-in/styles.ts`. The lime polyline colour comes from CSS
   `.trail-path { stroke: var(--lime) }` (SVG attributes do not resolve `var()`).
2. **Selector updates:** `trails.spec:95/:116` → assert the eyebrow `Trujillo`, the pill `Difícil`, the
   type `Cross-country`, and `getByTestId('trail-status')` with `Borrador` / `Publicada`. All other
   selectors kept on purpose.
3. **Red first**: the detail at 390 shows the map as the first block (`trail-map` top < header bottom +
   10) and `link 'Volver'` with `expectTarget`; `link 'Cómo llegar al inicio'` href contains
   `destination=<lat>,<lng>` of the start; the profiled detail shows `Pendiente 9 %`; `/rutas/nueva`
   with the `.dropzone` still uploads and `getByLabel('Archivo GPX')` resolves; axe on the detail (admin
   and anonymous), `/rutas/nueva`, `/ingresar` steps 1 and 2 (helpers `requestCode`/`freshIp` moved per
   R6); `screens.spec.ts` (D14).
4. **Mutations**: remove the dropzone label text → `getByLabel` and axe red; `.back` 40 px → target red;
   the Google link with lng,lat order → href test red.
5. Docs: `features.json` entry `ui-redesign-l1` with its proofs; a progress line; a CHANGELOG entry per PR.

### Live check (after U-C, or after U-B if U-C slips)

On staging, PC and phone (390): `/`, `/mapa`, a calibration-import detail, `/rutas/nueva` as admin,
`/ingresar`. Compare with the prototype. The owner signs off or files changes as **O-rounds** in #13.
0 residual rows (the D11 calibration trail from 1b is deleted per its runbook).

## 3. Web Vitals and weight

No new dependency. Fonts self-hosted with a size-adjusted fallback. Every async block (list, map, detail
map) has a fixed-height skeleton, so CLS stays near 0. The L3 LHCI baseline is measured **after** this
layer, so its byte budgets include the fonts. Bebas one weight, Inter four, Latin subset only.

## 4. Open decisions for the owner

| # | Question | Default |
|---|----------|---------|
| O1 | Explorar: list of cards, or the prototype's swipe deck (Guardar/Pasar needs saved trails, a later layer) | List (D6) |
| O2 | Tiles: dark-filtered OSM, Esri with an ArcGIS key ("Powered by Esri"), or CARTO dark (account terms) | Dark-filtered OSM (D11) |
| O3 | Duración on cards: omit, or estimate from distance and gain (a stated speed model) | Omit |
| O4 | Pendiente for a Descenso trail: gain / distance (prototype), or loss / distance | **Decided 2026-11-12 (owner):** a Descenso shows −loss; Pendiente = mean grade in degrees; under 1 km in metres |
| O5 | Bottom nav for a signed-in non-admin rider is only Explorar · Mapa: show it, or hide it until a third entry exists | Show it |
| O6 | Desktop: a centred 720 px column, or the prototype's phone frame | Column (D4) |

## 5. Later layers (out of scope)

- **Gamification:** Retos, Ranking, Perfil + EXP, badges, Desbloqueos (needs an XP model and APIs).
- **Comunidad:** feed, posts, comments, likes.
- **Negocios:** shops and workshops with hours and calls.
- **Grabar GPS:** a foreground recorder (screen-on caveat) and the "Recorrer" CTA.
- **Trazar:** a tap-to-draw route editor with a suggestion workflow.
- **Guardar / swipe deck and Constructor de ruta:** saved trails and multi-trail totals.
- **Onboarding:** the post-sign-up flow.
- **Photos on trails:** GPS-arrow photo markers and the photo hero (needs media/R2, #12).
- **React Native:** the iOS/Android port reusing the tokens and class map.

## 6. Rider routes and owner approval (goal set by the owner 2026-11-11: finish the web app, 4 h)

Riders sign up (e-mail code, existing) and submit their routes; the owner approves each one.
No new table: `trails.author_id` and `status` exist. `draft` = "En revisión", `hidden` = "No aprobada".

| # | Decision |
|---|----------|
| R-D1 | `POST /api/trails` (multipart GPX) is open to **any signed-in user** (was admin only). It always creates `draft` with `author_id` = the session user. OriginGuard, GPX limits, sha256 refusal and the slug rules stay. |
| R-D2 | Abuse limit: a non-admin with **3 or more `draft` trails** gets 429 `TOO_MANY_PENDING` (counted in the same transaction as the insert, `SELECT … FOR UPDATE` on the user row or an advisory lock per user). Admins have no limit. |
| R-D3 | `GET /api/trails/:slug`: published for everyone; any status for an admin; `draft`/`hidden` also for **its author**. Others get 404 (same body as missing). |
| R-D4 | `GET /api/me/trails` (signed in): the user's own trails, every status, newest first, summary fields + `status`. |
| R-D5 | `GET /api/admin/trails?status=draft` (admin): the moderation queue, oldest first, summary + `status` + author e-mail. |
| R-D6 | `PATCH /api/trails/:slug` stays **admin only** (publish = `published`, reject = `hidden`, metadata edits). Authors cannot edit in v1. |
| R-D7 | Web: the FAB "Registrar ruta" (`/rutas/nueva`) for **every signed-in user** (anonymous users see "Ingresar"). After the upload a rider lands on the trail page with the chip "En revisión". New `/mis-rutas` (signed in; list with status chips) in the nav as "Mis rutas". New `/admin/rutas` (admin; 404 for others) lists the queue; each row links to the detail, where the existing Publicar/Ocultar controls act. |
| R-D8 | Tests both sides: rider POST 201 + draft + author; anonymous 401; 4th pending 429 and admin not limited; author sees own draft, other rider 404; `/me/trails` only own; queue admin 200 / rider 403; rider PATCH 403. Mutations: drop the author check in R-D3 → the other-rider test red; drop the limit → 429 test red. |

The first published route is built by the owner's Google Maps points: the orchestrator converts the
lat/lng list into a GPX (elevations from the Open-Meteo elevation API, cited in the import note),
uploads it as admin and the owner publishes it.

## 7. Production (enduro.vops.pe)

The cutover runs the P1a-3 part 2 steps (private deploy, checks, cutover, rehearsed rollback) as soon as
the web is ready. **Deviation from A8, recorded:** the R2 keys arrive after the deadline, so the first
backup layer is a daily on-box `pg_dump -Fc` of the prod DB (14 days kept) with one restore proven into a
scratch DB before the cutover; the off-box R2 copy is added on top when the keys arrive (same dump file).

## 8. Layer 2: register by GPS, the FAB sheet, trail photos (owner request 2026-11-12)

The owner asked for GPS functions on the register page (mark the current location and points along
the way), photos taken during a ride shown as a timeline on the trail, and a FAB with a choice
between a trail and a "vista". The approved prototype already has these: the FAB sheet (Grabar ruta,
Trazar en el mapa, Importar GPX, Registrar una Vista, `ui-redesign/app.js:1325-1345`), the tracer
("Toca para marcar puntos", `:1447`) and GPS photo markers (§5 "Photos on trails").

| # | Decision |
|---|----------|
| G1 | The FAB opens a sheet (a native `<dialog>`, 44 px options): **Sendero** (`/rutas/nueva`) and **Vista** (`/vistas/nueva`, batch L2-B). Anonymous users keep "Ingresar". |
| G2 | `/rutas/nueva` has two tabs (links, `?modo=`): **Marcar** (default) and **Importar GPX** (today's form). |
| G3 | Marcar: a Leaflet map. "Mi ubicación" asks `watchPosition` (high accuracy), centres the map and shows a dot with its accuracy circle. "Marcar punto" adds the current fix; it is disabled while there is no fix or the accuracy is worse than 30 m (the button says the accuracy). A tap on the map also adds a point (for a rider at home). "Deshacer" removes the last point. The line and the live distance show. With ≥ 2 points the same fields as the GPX form appear (name, city, difficulty, type, description). Denied permission: a message, the map tap still works. Points live in `sessionStorage` until the submit, so a reload does not lose a ride. |
| G4 | Submit: the client writes a GPX 1.1 (`<trkpt>` without `<ele>`) and posts it to the existing `POST /api/trails`. Same limits, throttle, duplicate check, 3-pending rule and owner approval; no new endpoint. |
| G5 | API: when the parsed GPX has no usable elevations, the service densifies the line to ≤ 10 m (inside the point cap) and fills the elevations from the Open-Meteo elevation API (Copernicus GLO-90, 100 points per call, 5 s timeout). On failure the trail is stored without elevations (the stats hide), never refused. `ELEVATION_API_URL` env with the public default; tests stub it. |
| G6 | Not in this batch: continuous recording ("Grabar ruta", screen-on only on the web), photos and the "Vista" page (L2-B, needs R2 storage and owner decisions on moderation). |
