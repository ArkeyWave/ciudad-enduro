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
| G1 | The FAB opens a sheet (a native `<dialog>`, 44 px options): **Sendero** (`/rutas/nueva`) and **Vista** (`/vistas/nueva`, batch L2-B). Anonymous users keep "Ingresar". **Built in L2-A (deviation):** until L2-B ships, the option is shown disabled as "Vista (pronto)" and `/vistas/nueva` does not exist. L2-B enables it. |
| G2 | `/rutas/nueva` has two tabs (links, `?modo=`): **Marcar** (default) and **Importar GPX** (today's form). |
| G3 | Marcar: a Leaflet map. "Mi ubicación" asks `watchPosition` (high accuracy), centres the map and shows a dot with its accuracy circle. "Marcar punto" adds the current fix; it is disabled while there is no fix or the accuracy is worse than 30 m (the button says the accuracy). A tap on the map also adds a point (for a rider at home). "Deshacer" removes the last point. The line and the live distance show. With ≥ 2 points the same fields as the GPX form appear (name, city, difficulty, type, description). Denied permission: a message, the map tap still works. Points live in `sessionStorage` until the submit, so a reload does not lose a ride. |
| G4 | Submit: the client writes a GPX 1.1 (`<trkpt>` without `<ele>`) and posts it to the existing `POST /api/trails`. Same limits, throttle, duplicate check, 3-pending rule and owner approval; no new endpoint. |
| G5 | API: when the parsed GPX has no usable elevations, the service densifies the line to ≤ 10 m (inside the point cap) and fills the elevations from the Open-Meteo elevation API (Copernicus GLO-90, 100 points per call, 5 s timeout). On failure the trail is stored without elevations (the stats hide), never refused. **Built in L2-A (deviation):** at most 2 000 samples per trail (20 calls), far below the point cap: above 20 km the spacing grows past 10 m (50 m at 100 km), still finer than the 90 m GLO-90 cells. The map of a trail with a profile credits "Elevación: Open-Meteo (Copernicus GLO-90)" (CC BY 4.0). `ELEVATION_API_URL` env with the public default; tests stub it. |
| G6 | Not in this batch: continuous recording ("Grabar ruta", screen-on only on the web), photos and the "Vista" page (L2-B, needs R2 storage and owner decisions on moderation). |

## 9. Layer 2-B: trail photos ("vistas") and 2-C: automatic review with the Claude API (owner answers 2026-11-12)

Owner answers: (1) R2 keys come from the owner (`~/.secrets/ciudad-enduro-oss-r2.env`); (2) the Claude
API reviews routes and photos and approves them; find other uses; (3) a photo attaches to the nearest
trail, usually on the line or a few metres aside; (4) the project is open source, community-run,
sponsored by VOPS and non-commercial, so the Open-Meteo free tier and the OSM tiles stay; a move to
paid providers comes with monetisation.

| # | Decision |
|---|----------|
| V1 | Storage: R2 bucket `ciudad-enduro-media` through the S3 API (`@aws-sdk/client-s3`). The browser never gets a write key: it uploads to the API (multipart, max 10 MB, JPEG/PNG/WebP by magic bytes; phone browsers convert HEIC to JPEG on upload). The API re-encodes with `sharp` to WebP (max 1600 px) plus a 160 px thumbnail, which drops every EXIF field (GPS, device, owner) before storage. Public read through an R2 custom domain (`media.enduro.vops.pe`). |
| V1b | EXIF (owner 2026-11-12: an alternative to a plain strip): the API reads the EXIF block of the upload **before** the re-encode (`exifr`) and keeps only the fields the product uses, in `trail_photos` columns: `taken_at` (DateTimeOriginal), the EXIF GPS position and altitude, and `heading` (GPSImgDirection, for the GPS-arrow markers of the prototype). It drops every other field (device, serial numbers, owner, software, thumbnails). The stored WebP files carry no metadata. The original upload is never stored. **Built in L2-B (review B2):** EXIF is read from JPEG input only (the phone-camera case); a PNG or WebP needs the body position. The read runs inside the encode slot, with only the TIFF IFD0/EXIF/GPS blocks on and every other exifr parser off (`icc`, `xmp`, `iptc`, `jfif`, `ihdr`: exifr 7.1.3 inflates a PNG iCCP chunk, 1 KB → MBs). |
| V1c | Drafts are never public (review B1, 2026-11-12). Two buckets: `R2_PRIVATE_BUCKET` (prod `ciudad-enduro-media-private`, no custom domain, no public access) holds every upload; `R2_MEDIA_BUCKET` (public through `MEDIA_PUBLIC_BASE_URL`) holds published photos only, same keys, `MEDIA_KEY_PREFIX` in both. A non-published photo is served to its author and admins through presigned GET URLs (15 min). Publish: CopyObject private → public for both files (`Cache-Control: public, max-age=3600`, no `immutable`), then the row; a failed copy leaves the row unchanged (503 `STORAGE_UNAVAILABLE`). Hide (or back to draft): delete the public copies, then the row; the private files stay, so a later publish works. "Eliminar" (admin, `DELETE /api/photos/:id`, a native confirm step): the files in both buckets, then the row. Both uploads settle (`Promise.allSettled`) before any cleanup; a DeleteObjects `Errors` entry is retried once, then logged as `media_delete_failed` (keys only). sharp pipelines time out after 15 s. Re-review (2026-11-12): each status change and delete locks the photo row (`select … for update`) for its storage step and skips both when the status does not change; S3 calls time out (connect 5 s, request 15 s), so a held lock is bounded; the delete removes the public files first and stops at the first failure, so a row never loses its private files; a PNG or WebP without a body position is refused (400 `NO_POSITION`) before decoding; `R2_PRIVATE_BUCKET` must differ from `R2_MEDIA_BUCKET`. |
| V2 | Location: the phone's GPS position at upload (`getCurrentPosition`, accuracy ≤ 30 m, age ≤ 10 s, same gate as the tracer). EXIF GPS is read before the strip only as a fallback when the browser gives no position. |
| V3 | Trail link: the nearest published trail within 50 m of the position (PostGIS `ST_DWithin` on geography, then `ST_LineLocatePoint` for the fraction along the line). None within 50 m → 422 `NO_TRAIL_NEARBY` "No hay un sendero a menos de 50 m." The fraction orders the timeline. |
| V4 | Table `trail_photos`: id, trail_id, author_id, status (`draft` / `published` / `hidden`, same meaning as trails), position (geography point), line_fraction, object keys, width/height, created_at, review fields (V7). Limits: 10 uploads per 10 minutes per user (the existing throttle), 20 photos in review per user. **Built in L2-B:** the throttle counter is shared by trail and photo uploads (10 in total); the review limit is counted under `pg_advisory_xact_lock(7302, hashtext(author_id))`; the V7 review fields wait for 2-C. The decoder refuses images above 50 MP (413 `PHOTO_TOO_LARGE`; 40 MP would refuse 48 MP phone photos), at most 2 encodes at a time (503 `ENCODE_BUSY`). An EXIF time without `OffsetTimeOriginal` is read as Peru time (UTC−5). |
| V5 | UI: the FAB "Vista" option opens `/vistas/nueva` (camera input `capture="environment"`, position, preview, "Publicar vista"). Trail page: a horizontal timeline under the profile, one 56 px round thumbnail per published photo in line order, start and end dots; a tap opens the photo full-screen; the same photos as round markers on the map. The rider sees their own photo with "En revisión". |
| V6 | Migration through drizzle; R2 credentials only as Coolify env (`R2_*`); CI and local use MinIO in the dev compose. **Built in L2-B (deviation):** the official MinIO images are no longer published (Docker Hub and quay.io refuse the pull, 2026-11-12), so dev and CI run `adobe/s3mock` 5.2.3 (Apache 2.0, pinned by digest): a plain `services:` entry, buckets from `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS`, path-style, GET without auth (the e2e browser loads the photos from it). Env: `R2_ACCOUNT_ID` or `S3_ENDPOINT` (the mock; path-style only then), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_MEDIA_BUCKET`, `MEDIA_PUBLIC_BASE_URL`, all required at start; optional `MEDIA_KEY_PREFIX` (staging `staging/`, prod empty). |
| V7 | Claude review (2-C): one call per new route or photo, `claude-opus-5-5`, effort `low`, structured output `{ decision: "approve" \| "reject" \| "unsure", reason }`. Input: for a photo the 1600 px WebP; for a route the name, description, city, type, difficulty, distance, gain/loss and a rendered map image of the line. User text goes in as data inside tags; the model's answer can only pick one of three values. `approve` → `published`; `reject` → `hidden` with the reason shown to the owner; `unsure`, an error, a refusal or a timeout → stays `draft` for the owner. The owner can override every decision in "Revisión", which lists the AI decision and reason. Spend limit set in the Anthropic Console. |
| V8 | Trail summary (2-C, owner 2026-11-12): when a trail is published or its fields change, one `claude-opus-5-5` call (effort `low`) writes a 2–3 sentence Spanish summary from the name, description, city, type, difficulty, distance, gain/loss, grade and the elevation profile. Stored on the trail (`ai_summary`, `ai_summary_at`); shown on the detail under the stats with the label "Resumen IA". User text goes in as data; the output is plain text, max 400 characters, no links. |
| V9 | Condition notes (2-C, owner 2026-11-12): when a photo of a trail is published, a job (at most once per hour per trail) sends the published photos of the last 30 days (max 8, newest first, with their dates and line positions) to `claude-opus-5-5` with vision; structured output `{ notes: [{ text, photoId }] , ok: boolean }` (max 3 notes, e.g. "barro en el km 0,4", "rama caída"). Stored in `trail_conditions` (notes, generated_at, photo ids); shown on the detail as "Estado del sendero" with the age ("hace 2 días"); hidden when older than 30 days or when there are no photos. |
| V10 | Later Claude uses (not planned): alt text for each photo; a suggested difficulty. |

Known, not built (review of PR #56): **N5** no trail delete exists yet; when one is added it must delete the photo files of the trail too (the rows cascade). `trail_photos` has no CHECK constraints, same as `trails`. **N7** staging shares the media buckets under `staging/` with the same R2 key as production (accepted: staging and production run on one box and one Coolify, so a separate staging key adds little isolation).

## 10. Layer 3: districts, card slider, location UX, vistas from the trail (owner feedback 2026-11-25)

Owner feedback on staging `10ce0f3` (PR #56 live there, production still `5a770c1`):

1. The Explorar card is a static block. It must be a **slider**: slide 1 = the trail location on a map; a few
   seconds after the card reaches the centre of the screen it moves by itself to the first photo of the trail.
2. `/vistas/nueva` has **no manual location**: without a GPS fix (desktop, denied permission) and without EXIF
   GPS the upload is refused with `NO_POSITION` and the rider cannot go on.
3. The public trail page has **no "add a photo to this trail"** action; only the global FAB "Vista".
4. The **city** field is a `<select>` of three cities. It must be a searchable input over **all districts of
   Peru**, with the district nearest to the user suggested first (Chimbote for the owner).
5. **"Mi ubicación"** gives no feedback: no searching state, no position on the map, no active state.

Verified facts (main `10ce0f3`):
- `city` is a pg enum (`Chimbote`, `Nuevo Chimbote`, `Trujillo`) with a derived `department` enum (`Ancash`,
  `La Libertad`), `apps/api/src/db/schema/trails.ts:5-31`; `departmentOf()` in `trails.service.ts:76`; the
  OpenAPI enum `City` reaches `packages/api-client` and `apps/web/src/lib/labels.ts:5` (`CITIES`, test
  `labels.test.ts:32` pins it to the contract). `GET /api/trails?city=` filters on it.
- `POST /api/photos` takes optional flat `lat`/`lng` (`photos.controller.ts:90`) and links the photo to the
  nearest published trail within 50 m (V3). The web sends a position only when the fix passes the tracer gate
  (`positionFields`, ≤ 30 m, ≤ 10 s).
- `TrailCard` is one `<a>` around the whole card (`TrailCard.tsx:15`); a control inside it would be an
  interactive element inside a link.
- `Tracer.locate()` (`Tracer.tsx:102`) starts a `watchPosition` and centres on the first fix, but draws no
  position marker and the button has no state. `NewPhotoForm` has its own `watchPosition` (`NewPhotoForm.tsx:26`).
- Maps: Leaflet + OSM tiles (`tiles.ts`), dark look by CSS filter. The photo timeline orders by `line_fraction`.

| # | Decision |
|---|----------|
| L3-1 | **Districts replace cities.** Trails store `ubigeo char(6)` (INEI district code, NOT NULL), validated against a bundled list of every district of Peru (code, district, province, department, centroid lat/lng). The `city` and `department` enums and `departmentOf` are removed (no compatibility path). Migration maps `Chimbote` → `021801`, `Nuevo Chimbote` → `021809`, `Trujillo` → `130101`, then drops both enums. The list lives in one JSON file in `packages/api-client` (or a new tiny `packages/geo`), read by the API (validation, names in responses) and the web (search, suggestion). Source: the INEI ubigeo list with district centroids from an open dataset; the implementer records the source URL, the licence and the row count (expected ≈ 1,890) in the CHANGELOG and stops to ask if no open licence is found. |
| L3-2 | **API shape.** Trail DTOs replace `city` with `district: { ubigeo, name, province, department }`. Writes take `ubigeo` (`@IsIn` the list). `GET /api/trails?ubigeo=` replaces `?city=`. The Explorar head line lists the distinct district names of the published trails (was the fixed `CHIMBOTE · TRUJILLO`). |
| L3-3 | **District input.** One accessible combobox (ARIA 1.2 combobox + listbox pattern, keyboard: arrows, Enter, Escape; 44 px options), no new dependency. Search is accent- and case-insensitive over "district, province, department", max 8 results. Suggestion: the district whose centroid is nearest to the trail start (when the form has a path) or to the device position; shown first as the default value, the rider can change it. Shortcut accepted: nearest centroid, not point-in-polygon (a border trail can get the neighbour district; the rider corrects it). |
| L3-4 | **Shared location hook.** `useGeolocation()` in `apps/web/src/lib/` owns one `watchPosition` (start on demand, stop on unmount, denied → `denied` state). States: `idle` / `searching` / `active(fix)` / `denied` / `unavailable`. Both the tracer and `/vistas/nueva` use it (removes the two copies). |
| L3-5 | **"Mi ubicación" dynamic.** The chip shows the state: `searching` → spinner icon and "Buscando…", `active` → filled lime chip with `aria-pressed="true"` and "±N m"; denied → the existing alert. The map draws the position as a cyan dot with an accuracy circle that moves with each fix; a tap on the chip re-centres. Same chip and dot on the `/vistas/nueva` map. |
| L3-6 | **Manual location for a vista.** `/vistas/nueva` shows a map. With a good fix the marker sits on the fix; without one the rider taps the map to place the marker (draggable). The form sends the marker position as `lat`/`lng` (the gate of V2 applies only to an automatic fix). With no fix, no tap and no EXIF GPS the submit button stays enabled and the API answers `NO_POSITION` as today, with the message "Toca el mapa donde tomaste la foto." |
| L3-7 | **Vista from the trail page.** The trail page gets a "Agregar vista" button (signed-in users; anonymous users get the sign-in link) to `/vistas/nueva?ruta=<slug>`. There the map shows that trail's line and starts on it. The form sends `trail=<slug>`; the API then links the photo to **that** published trail if the position is within 50 m of it (else 422 `NO_TRAIL_NEARBY` as today), instead of the nearest trail. Unknown or unpublished slug → 404. |
| L3-8 | **Card slider.** The card becomes an `<article>` with the title as the link (stretched over the card with CSS) and the slider outside the link. Slides: (1) a static map: a 2×2 mosaic of OSM tiles around the trail start at zoom 14 with the start dot (plain `<img>` tiles + CSS, no Leaflet instance per card), (2…) the published photos of the trail in line order (max 5, thumbnails, `loading="lazy"`). Auto-advance: an `IntersectionObserver` with a centre band (`rootMargin: -40% 0px -40% 0px`) starts a 3 s timer when the card enters the band; leaving the band cancels it; it moves once from the map to the first photo, never loops. `prefers-reduced-motion` → no animation (the slide still changes). Manual: swipe (CSS scroll-snap) and dots (buttons, `aria-label="Foto N de M"`). A trail with no photos shows the map only, no dots. `TrailSummaryDto` gains `photos: { thumbUrl, url }[]` (published only, max 5, line order). The OSM attribution shows on the map slide. |
| L3-9 | Out of scope: point-in-polygon districts, a geocoding service, a map slide with the full line (needs the path in the summary), snapping the vista marker to the line. |

Batches (Standard rung unless noted; one implementer + review loop each):

| Batch | Scope | Rung |
|---|---|---|
| L3-A | L3-1, L3-2, L3-3: data file, migration, API DTOs/filters, api-client regen, combobox in `TrailFields`, Explorar head. Tests: migration maps the three cities and drops the enums; write with an unknown ubigeo → 400; filter by ubigeo; search folds accents ("ancash" finds "Áncash"); nearest-centroid suggestion (Chimbote coordinates → `021801`); combobox keyboard e2e. | **Full** (schema + contract) |
| L3-B | L3-4 … L3-7: hook, tracer chip and dot, `/vistas/nueva` map with manual marker, `?ruta=`, API `trail` field, "Agregar vista" button. Tests: `trail` given + position 40 m from it but 10 m from another trail → linked to the given one; `trail` given + 60 m → 422; unpublished slug → 404; manual marker sends lat/lng without a GPS fix (e2e with geolocation denied); chip states with a mocked geolocation. | Standard |
| L3-C | L3-8: summary photos, card markup, slider, auto-advance. Tests: summary lists only published photos, max 5, line order; card with no photos has no dots; auto-advance after 3 s in the centre band and not when the card leaves before 3 s (fake timers + mocked observer); the title link is the only link and the dots are buttons outside it (a11y check). | Standard |

Order: L3-A first (it changes the summary DTO and the openapi file); L3-B and L3-C after it, in parallel worktrees
(L3-C regenerates the api-client after rebasing on L3-B or the other way). Production: `10ce0f3` can go to
production before this layer; nothing in it is broken, only incomplete.

### 10.1 Plan gate amendments (binding; opus `reviewer` high + gpt-6.2-sol high, 2026-11-25)

Where an amendment and the table above differ, the amendment wins.

| # | Amendment (source) |
|---|---|
| A1 | **Data:** `jmcastagnetto/ubigeo-peru-aumentado` `ubigeo_distrito.csv` (MIT; 1,893 rows = INEI 2026 SISCONCODE count). Its lat/lng is the **district capital point**, not a centroid: every "centroid" in L3-1/L3-3 means "capital point" (a true centroid gives Coishco for Chimbote city; the capital point gives `021801`). Drop the `NA` row. Rows with no coordinates stay searchable and selectable but are never suggested. Display names: title case built from the source (Spanish particles lower case); search folds accents and case, so the test is "ancash" and "ANCASH" both find "Ancash". The MIT notice ships next to the JSON. Check that the INEI 2026 roster codes all appear; list any missing code in the CHANGELOG. (opus F1, codex 2-3) |
| A2 | **Package:** a new `packages/geo` (JSON + LICENSE + `searchDistricts()` + `nearestDistrict()`), a dependency of `api` and `web`; the API image build must contain it (check `pnpm --filter api deploy --prod` output). The web loads it only on form pages (dynamic import, ≈ 31 KB gzip). (opus F2) |
| A3 | **OpenAPI:** `ubigeo` is `type: string, pattern: ^[0-9]{6}$`, never an enum (a 1,892-member union). `@IsIn` the list for validation. Replace `contract.test-d.ts:14`, `labels.test.ts:32` and the `openapi.spec.ts:44` City pin; do not port them. Unknown ubigeo → 400 on create, patch and the list filter; the old `?city=` → 400. (opus F3, codex 1) |
| A4 | **Migration 0006 (custom, `drizzle-kit generate --custom`):** add `ubigeo` nullable → `UPDATE … CASE` for the three cities → `CHECK (ubigeo ~ '^[0-9]{6}$')` + `SET NOT NULL` → drop `city`, drop `department` → `DROP TYPE city, department`. Test it on data that exists **before** 0006: migrate a temp DB to 0005 (truncated journal copy), insert one row per city, apply 0006, assert the codes. Then `drizzle-kit generate` must report no change. (opus F4, codex 1) |
| A5 | **Deploy of L3-A (first destructive migration):** the API container migrates on start while the old container still serves, so the old code gets 500s for a short window and an image-only rollback is impossible. Before the production dispatch: a fresh `pg_dump` of production, and the written rollback = restore that dump + the previous image. The short error window is accepted (one real trail, few users). After the deploy: smoke the list, the detail, a create and a patch. (opus F5, codex 1) |
| A6 | **Explorar head:** only the eyebrow line moves into its own small `<Suspense>` (fixed-width skeleton); the h1 stays outside. At most 3 district names + "y N más". (opus F6) |
| A7 | **Suggestion precedence:** a saved value (edit, admin) or a value the rider chose is never replaced. Otherwise: trail start (tracer path or parsed GPX) first, else a device fix. On the GPX import tab, a fix only after "Mi ubicación" or when the permission is already `granted` (no prompt on load). `useGeolocation()` (L3-4) moves into **L3-A**, since the suggestion needs it. (codex 3, opus F19, codex 10) |
| A8 | **Upload limits:** `PHOTO_UPLOAD_LIMITS` → `fields: 3, parts: 4`; `trail` in the multipart DTO and OpenAPI (slug pattern), with 404 `TRAIL_NOT_FOUND` documented. The slug is checked **before** the encode. Only the explicit-slug branch skips the nearest-trail search; a named trail beyond 50 m → 422 even when another trail is nearer; distance and `line_fraction` against that trail's path; publication re-checked inside the insert transaction. Test a real four-part upload and assert the trail id and `line_fraction`. (codex 4-5, opus F7-F8) |
| A9 | **"Agregar vista" button:** only on a `published` trail **with a path**, for signed-in users (anonymous users do not see it; return-after-sign-in is out of scope). The form rejects an unavailable `?ruta=` before it shows a map. (codex 5, opus F7) |
| A10 | **Position on `/vistas/nueva`:** one explicit pin. A tap or drag places it, and later fixes never move it again (test: drag, mocked fix, pin stays). A keyboard action "Poner aquí" places it at the map centre. Submit order: pin, else a fresh fix that passes V2, else nothing (EXIF on the server). Without `?ruta=` and without a good fix, the rider first picks a trail from a list (published trails), and its line is drawn before the pin. Server fallback: when the body position has no trail within 50 m and the JPEG has EXIF GPS, the API tries the EXIF position. (codex 6, opus F9-F11) |
| A11 | **"Mi ubicación":** no `aria-pressed`; label "Centrar en mi ubicación"; the state is text in a live region ("Buscando…", "±N m", the denied alert); reuse the tracer's dot and accuracy circle and its stale-fix handling. (codex 6, opus F18) |
| A12 | **List DTO:** the photos for cards are `previewPhotos: { url, thumbUrl }[]` on a new `TrailListItemDto` used by `GET /api/trails` only (detail keeps its `photos`; `/mis-rutas` and `/admin/rutas` have no slider). One batched query (`row_number() over (partition by trail_id order by line_fraction)`, published only, max 5). Tests: a draft or hidden photo never shows on a card; detail still returns the viewer's drafts. (codex 7, opus F17) |
| A13 | **Card layout:** the slider, its dots and the OSM attribution sit above the stretched-link overlay (`position: relative; z-index`); a tap on a slide does not open the trail. The scroller is `role="region"`, `tabindex="0"`, `aria-label="Mapa y vistas de <name>"`. Dots: "Mapa", then "Vista N de M", `aria-current="true"` on the active one. Photo slides use `url` (1600 px) with `loading="lazy"` and `sizes`; tiles `loading="lazy"`. Update `--card-h` for the taller card. Test: the title link is the only link outside the attribution. (opus F12-F14, F16, codex 8) |
| A14 | **Auto-advance:** observe a sentinel at the card's vertical centre, not the card edge; 3 s in the band → `scroller.scrollTo({ left })` once (never `scrollIntoView`); any pointer, scroll, focus or dot input cancels it for good; reduced motion → no auto-advance. Tests: advances once when centred; no advance after leaving the band before 3 s; no advance after a manual swipe. Playwright checks the geometry at 390 and 1280 px. (codex 9, opus F15) |
| A15 | **Order:** L3-A (Full, incl. `useGeolocation`) → L3-B ∥ L3-C in worktrees. The second to merge rebases, regenerates the api-client from the combined API and re-runs the contract and integration checks. (codex 10) |
