# Phase 0 Foundation — Implementation Plan (rev. 3, gate closed)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (inside the
> orchestrated-delivery loop) to implement this plan batch by batch.

**Goal:** A monorepo where a Next.js web app lists published trails from a NestJS + PostGIS API
through a generated typed client, and a rider signs in with an email code or Google through
Better Auth, deployed to a staging host on Coolify behind the Cloudflare origin lock.

**Architecture:** pnpm + Turborepo monorepo. `apps/api` (NestJS 12, Drizzle, Better Auth) owns all
data and auth. `apps/web` (Next.js 16) is a client of the API only. One domain: Traefik routes
`/api` and `/api/*` to the API container and the rest to the web container, so auth cookies are
first-party and there is no CORS.

**Tech stack (verified on npm 2026-11-10):** Node 24.18, pnpm 12.18, turbo 2.11, TypeScript
**6.0.3** (pinned, D13), @nestjs/core 12.4, @nestjs/swagger 12.1, drizzle-orm 0.45.4, drizzle-kit
0.31.11, better-auth 1.7.19, **auth 1.7.19** (the CLI; a separate package — better-auth has no bin),
@thallesp/nestjs-better-auth 2.8.0, next 16.4, vitest 5.1, unplugin-swc 2.0 + @swc/core 1.16,
@playwright/test 1.65, zod 4.6, pg 8.23, resend 6.37, openapi-typescript 7.13, openapi-fetch 0.17.

Design reference: `docs/architecture/phase-0-foundation.md`.

**Revision 3** folds in the plan gate: round 1 (opus 5.5 @ high ∥ gpt-6.1-sol @ high) and the final
adversarial review (claude-fable-5.2 @ high), 2026-11-10. Every fact in section 0 was read in the
published package source by at least one reviewer and spot-checked by the orchestrator. The gate
ledger is in section 9.

---

## 0. Verified facts that shape the plan

- **Adapter** `@thallesp/nestjs-better-auth@2.8.0`: peers `@nestjs/core ^11.1.6 || ^12`,
  `better-auth >=1.5 <2`, `typescript ^5.9.2 || ^6`, `express ^5.1`. Registers a **global**
  `AuthGuard` (routes need `@AllowAnonymous()` / `@OptionalAuth()`). Needs `bodyParser: false` in
  `NestFactory.create`. Has `AuthModule.forRootAsync`. **Turns on credentialed CORS for
  `trustedOrigins` by default** → we set `disableTrustedOriginsCors: true`.
- **Email-OTP plugin** sends mail from **three** endpoints: `/email-otp/send-verification-otp`,
  `/email-otp/request-password-reset`, `/forget-password/email-otp` (routes.mjs:75, 449, 502).
  Non-`sign-in` types send only to existing users, and the send is awaited → a timing oracle.
  `storeOTP: 'hashed'` is an **unsalted SHA-256**; plain storage is stored as `code:attempts`.
  The endpoint lowercases the email but does **not** trim it.
- **Built-in rate limiter** runs **before** `hooks.before`; the plugin default for the send path
  is 3 per 60 s per IP. The client IP comes from `advanced.ipAddress.ipAddressHeaders`; without it,
  behind Cloudflare + Traefik, many clients share one bucket.
- **Origin check** is **off when `NODE_ENV=test`** unless `advanced.disableOriginCheck: false` is
  set (create-context.mjs:211).
- **`useSecureCookies`**, when set, overrides Better Auth's detection from the `https://` base URL
  (cookies/index.mjs:23). We do not set it.
- **Sessions** store the raw token (internal-adapter.mjs:300); 1.7.19 has no option to hash it.
  → Accepted deviation (section 8).
- **Google provider:** the **redirect flow only decodes** the ID token returned by Google's token
  endpoint (google.mjs:118-121, callback.mjs:28-47); JWKS verification applies only to an `idToken`
  posted in the body of `/sign-in/social` or `/link-social` (sign-in.mjs:154-163). We use the
  redirect flow and **reject `idToken` bodies**. Account linking with `trustedProviders` skips the
  `email_verified` check (link-account.mjs). `mapProfileToUser` throwing `APIError` leaves no rows.
- **Origin check** in the router runs only when the request carries a `Cookie` header
  (origin-check.mjs:101-108); `formCsrfMiddleware` (exported from `better-auth/api`) validates
  unconditionally. The send-OTP endpoint runs its own origin middleware **after** `hooks.before`.
- **CLI** (`auth@1.7.19`) needs a config file that **exports an instance** (`auth` or default); it
  emits a Drizzle schema that drizzle-kit 0.31.11 accepts (gpt-6.1-sol generated it end to end).
  With `rateLimit.storage: 'database'` it also emits a `rateLimit` table.
- **Drizzle 0.45** `geometry()` is **hard-coded to `geometry(point)`**: the builder discards
  `type` and `srid`, and writes `point(x y)` with SRID 0 (geometry.js:20-47). No geography, no
  LineString. → **All geo columns use `customType`** with an explicit SRID and EWKT writes. The
  migration journal lives in schema **`drizzle`** (`drizzle.__drizzle_migrations`), not `public`.
  (Rev. 1 and rev. 2 called the native type SRID-aware; that was wrong — found by the final review.)
- **Swagger in preview mode** (`NestFactory.create(AppModule, { preview: true })`) skips DI
  instantiation but **not** import-time code; it reads the global prefix from the app instance;
  response schemas need `@ApiOkResponse({ type })` — `@ApiProperty` alone does not attach them.
- **Vitest + unplugin-swc** works with Nest 12 DI and Swagger (gpt-6.1-sol probe; removing
  decorator metadata made it fail). Keep Vitest; add a small metadata smoke test.

## 1. Decisions taken at the gate

| # | Question | Decision | Why |
|---|----------|----------|-----|
| G1 | Account linking | **Off.** Google sign-in additionally requires `email_verified === true`. An email-code user who taps Google gets a clear "Ingresa con tu código de correo" message. | Linking with trusted providers skips the verification check (takeover). Without the `email_verified` rule, an attacker pre-creates the user with Google and keeps access after the owner signs in by code — this applies even with linking off. Google warns a verified third-party address may no longer belong to the account holder. |
| G2 | Throttle placement | `hooks.before` runs the CSRF check, then the per-address cooldown and global cap, and issues a one-use send permit; the **mailer refuses to send without a permit**; unused paths disabled via an allowlist test; the built-in per-IP limiter stays on the send path (5/60 s); mail is sent in the background. | Round 1 reproduced the bypass and the limiter ordering; the final review showed a cross-origin request could burn a slot with no mail, and that removing the per-IP limit let one IP drain the global cap. |
| G3 | Test runner | **Vitest + unplugin-swc**. | Both reviewers; ESM-only better-auth is the usual Jest pain. |
| G4 | Parallelism | Auth and the web list do **not** run in parallel (they share `apps/api/package.json` and the contract). **Staging deploy (B3) and auth (B4) run in parallel worktrees**: disjoint files, separate databases. | Removes the real collisions, keeps real parallelism. |
| G5 | Deploy access | Migrations run in the **API container entrypoint**. The GitHub secret is an SSH key restricted by `command=` to one deploy script that takes a commit SHA. | A public repo must not hold a general shell key to the shared box. |
| G6 | Deploy order | Staging comes **right after the web list** (B3), not at the end. | Traefik/origin-lock/Coolify problems surface early. |

## 2. Batches

```
B0 skeleton+CI ─► B1 API core+contract ─► B2 web list ─┬─► B3 staging deploy (wt-deploy) ─┬─► B5 sign-in UI + live auth checks
                                                       └─► B4 auth (wt-auth)  ─────────────┘
```

| Batch | Rung | Owns | Parallel |
|-------|------|------|----------|
| B0 Monorepo skeleton + CI | Full | root `package.json`, `turbo.json`, lockfile, `ci.yml` | no |
| B1 API core: env, DB, trails, contract emitter | Full | `apps/api/**` | no |
| B2 api-client + web trail list | Standard | `packages/api-client/**`, `apps/web/**` | no |
| B3 Staging deploy of the skeleton | Full + Codex | `**/Dockerfile`, `.dockerignore`, `.github/workflows/deploy-staging.yml`, `docs/operations/**`, box + Coolify | **yes, with B4** |
| B4 Auth (Better Auth + security rules) | Full + Codex | `apps/api/src/auth/**`, `apps/api/src/db/schema/**`, `apps/api/drizzle/**`, `apps/api/package.json` | **yes, with B3** |
| B5 Sign-in UI + auth live checks | Standard (+ live) | `apps/web/src/app/ingresar/**`, `apps/web/e2e/**` | no |

**Shared-file rules:** only B0 edits root `package.json` / `turbo.json`. The lockfile is never
hand-edited; at every merge the orchestrator runs `pnpm install` with the pinned pnpm, regenerates
the API client, and re-runs the full gate. B3 must not touch `apps/api/package.json` or
`apps/api/src/**` (B1 already provides the `db:migrate` script and the entrypoint it needs).

## 3. Rules in every implementer and reviewer prompt

- TDD. Test both sides of every rule (must fire / must not fire).
- **Mutation proof** for every rule test; record "mutation → test that went red" in the PR body. A
  claim in a comment, docblock or CHANGELOG with no failing-when-broken test is deleted.
- Scoped runs: `pnpm --filter <pkg> exec vitest run <file> -t "<name>"`. Type-check first, alone.
  Full gate once at the end. Long output to a file once, then search the file.
- **Type-level tests are only real when type-checked:** `typecheck` covers `test/**` and
  `*.test-d.ts`; a type assertion that only Vitest runs proves nothing.
- No mocks for the database. HTTP-level stubs (undici `MockAgent`) for Google and Resend only.
- **Each worktree uses its own test database** `ciudad_enduro_test_<worktree>` (`TEST_DB_SUFFIX`).
- STOP and ASK on unexpected state. Comments in English, UI strings in Spanish (es-PE).
- Commit trailer `Co-Authored-By: ArkeyWave <kennedy.monzon@gmail.com>`. No secrets; `.env.example`
  lists every variable with a dummy value.

---

## B0 — Monorepo skeleton + CI

**Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.nvmrc` (`24`),
`.editorconfig`, `.gitattributes` (`* text=auto eol=lf`), `.env.example`, `docker-compose.dev.yml`,
`docker/init-test-dbs.sh`, `packages/config/{package.json,tsconfig.base.json,eslint.config.mjs}`,
`.github/workflows/ci.yml`, `README.md` (dev setup), `CHANGELOG.md`.

1. Root `package.json`: `"packageManager": "pnpm@12.18.0"`, `engines.node ">=24 <25"`, scripts
   `dev build lint typecheck test db:up`; devDeps `turbo 2.11.10`, `typescript 6.0.3`.
2. `turbo.json`: `build` (dependsOn `^build`), `dev` (persistent, no cache), `lint`, `typecheck`
   (dependsOn `^build`), `test` (dependsOn `^build`, **`cache: false`**, `passThroughEnv`:
   `DATABASE_URL`, `TEST_DB_SUFFIX`, `CI`). Declare `env` for build-time variables of `web`
   (`API_INTERNAL_URL`). Turbo's strict env mode drops undeclared variables.
3. `docker-compose.dev.yml`: `postgis/postgis:17-3.5`, port `5434:5432`, healthcheck, volume.
   `init-test-dbs.sh` creates `ciudad_enduro` with PostGIS. Test databases are created on demand by
   the API test global setup (B1).
4. `packages/config/tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2023`,
   `module/moduleResolution NodeNext`, `skipLibCheck`. ESLint flat config with typescript-eslint
   recommended-type-checked.
5. `ci.yml` (push to `main`, `pull_request`): `pnpm/action-setup` (pinned) **before**
   `actions/setup-node` (`cache: pnpm`, node 24) → `pnpm install --frozen-lockfile` → lint →
   typecheck → test (PostGIS service) → build. Workflow `permissions: contents: read`.

**Done when:** `pnpm install && pnpm lint && pnpm typecheck` pass; CI green on a PR; `pnpm db:up`
brings PostGIS up and `select postgis_version()` answers `3.5`.

---

## B1 — API core: env, database, trails, contract emitter

**Files:**
- `apps/api/{package.json,tsconfig.json,tsconfig.build.json,nest-cli.json,vitest.config.ts,drizzle.config.ts}`
- `src/main.ts`, `src/configure-app.ts`, `src/app.module.ts`, `src/config/env.ts`
- `src/db/{db.module.ts,db.provider.ts,migrate.ts,schema/index.ts,schema/trails.ts,types/geo.ts}`
- `src/trails/{trails.module.ts,trails.controller.ts,trails.service.ts,dto/*.ts}`
- `src/health/health.controller.ts`, `src/openapi.ts`, `scripts/emit-openapi.ts`
- `drizzle/0000_*.sql` (generated), `drizzle/0001_trail_constraints.sql` (custom)
- `test/{global-setup.ts,test-db.ts,metadata.spec.ts,env.spec.ts,trails.int.spec.ts,trail-constraints.int.spec.ts,openapi.spec.ts,health.int.spec.ts}`

**B1.1 Env (fail fast).** zod 4 schema: `NODE_ENV` **required** enum
`development | test | production`; `PORT` (default 3001); `DATABASE_URL`; `WEB_ORIGIN`;
`BETTER_AUTH_SECRET` (≥32); `BETTER_AUTH_URL`; `RESEND_API_KEY`; `EMAIL_FROM`; `GOOGLE_CLIENT_ID`;
`GOOGLE_CLIENT_SECRET`; `OTP_HMAC_SECRET` (≥32). `loadEnv()` is **called lazily inside providers**,
never at import time. Tests: valid → typed env; 31-char secret → throws and the message names the
key without the value; missing `NODE_ENV` → throws.

**B1.2 Lazy resources.** `db.provider.ts` creates the `pg` pool in a Nest factory provider (so
`preview: true` never opens a connection). `configure-app.ts` exports
`configureApp(app)`: `setGlobalPrefix('api')`, `ValidationPipe({ whitelist: true, transform: true,
forbidNonWhitelisted: true })`. `main.ts` and `emit-openapi.ts` both call it.

**B1.3 Metadata smoke.** `metadata.spec.ts`: a two-file provider/consumer pair resolves through Nest
DI under Vitest. Mutation: disable `emitDecoratorMetadata` in the test tsconfig → red.

**B1.4 Geo types.** Two `customType`s in `types/geo.ts`, both write-only on the driver side:
`pointGeom` → `dataType() = 'geometry(Point, 4326)'`, `toDriver({lng,lat}) = 'SRID=4326;POINT(lng lat)'`;
`lineStringGeom` → `'geometry(LineString, 4326)'`, `toDriver([[lng,lat],…]) = 'SRID=4326;LINESTRING(…)'`.
Reads always select `ST_X/ST_Y` or `ST_AsGeoJSON(col)::json`, never the raw driver value (hex EWKB).
Test: after migration, `Find_SRID('public','trails','start_point') = 4326` and a written point has
`ST_SRID = 4326`; inserting `ST_SetSRID(ST_MakePoint(-78.5,-9.1), 0)` is rejected by the typmod.
Mutation: switch `start_point` to Drizzle's native `geometry()` → the SRID tests go red.

**B1.5 Schema.** `trails`: `id uuid pk`, `slug unique`, `name`, `description default ''`, enums
`city` (`Chimbote | Nuevo Chimbote | Trujillo`), `department` (`Ancash | La Libertad`),
`difficulty` (`facil | intermedio | dificil`), `type` (`descenso | cross_country | urbano`),
`status` (`draft | published | hidden`, default `draft`), `start_point` not null, `end_point` null,
`path` null, `distance_m` null, `elevation_gain_m` null, `author_id text null` (FK in B4),
`created_at`, `updated_at`.
`0001_trail_constraints.sql`: only the two Peru bounding-box CHECKs (start, end-or-null). No SRID
check (the column typmod enforces it), no extra indexes (no Phase 0 query needs them — they arrive
with the first distance query in Phase 1).

**B1.6 Test database.** `global-setup.ts` (Vitest `globalSetup`, runs once per run):
1. **Refuse** a `TEST_DB_SUFFIX` that does not match `^[a-z0-9_]{1,26}$`.
2. **Refuse** unless the host of `DATABASE_URL` is `localhost`, `127.0.0.1` or `postgres` (the CI
   service name). The check runs before any connection is opened.
3. Build the test URL with database `ciudad_enduro_test_${TEST_DB_SUFFIX ?? 'main'}`.
4. `DROP DATABASE IF EXISTS … WITH (FORCE)`, `CREATE DATABASE`, `CREATE EXTENSION postgis`, run all
   migrations. (A fresh database removes the `drizzle` journal too.)
Spec files truncate their tables in `beforeEach`; `fileParallelism: false` for `*.int.spec.ts`.
Tests, both sides: host `db.example.com` → throws and no connection is attempted (spy on the `pg`
client constructor); host `localhost` → runs; suffix `x; drop` → throws.

**B1.7 Constraints test.** Valid Peru point → ok; swapped axes → `trails_start_in_peru`; end
outside Peru → `trails_end_in_peru`; end null → ok. Mutation: delete the start CHECK, re-run (fresh
DB) → swapped-axes test red.

**B1.8 Trails endpoints.** `GET /api/trails?city=` → published only, `created_at desc`,
`TrailSummaryDto[]` (`id, slug, name, city, difficulty, type, start {lat,lng}, distanceM`).
`GET /api/trails/:slug` → `TrailDetailDto` (+ `description, end, path [lng,lat][] | null,
elevationGainM`); 404 for missing **or** unpublished, identical bodies. Invalid `city` → 400.
Controllers carry `@ApiOkResponse({ type, isArray })`, `@ApiQuery({ enum })`, `@ApiNotFoundResponse`.
Tests: 2 published + 1 draft → list has 2; `city=Chimbote` → 1; `city=Lima` → 400; draft slug →
404 equal to unknown slug; `start` = `{ lat: -9.09, lng: -78.52 }`. Mutations: drop the published
filter; swap x/y in the mapper.

**B1.9 Health.** `GET /api/health` → `{status:'ok', db:'ok', revision: <BUILD_SHA>}`; DB down →
503 `db:'down'`. `BUILD_SHA` is a build arg baked into the image (`unknown` in dev). Both sides.

**B1.10 Contract emitter.** `emit-openapi.ts`: `NestFactory.create(AppModule, { preview: true,
logger: false })` → `configureApp` → `SwaggerModule.createDocument` → write
`packages/api-client/openapi.json` with sorted keys. `openapi.spec.ts` asserts the document has
`/api/trails` and `/api/trails/{slug}` (not `/trails`), the `200` response schemas reference the
DTOs, and `city` is an enum of the three cities. Test that emission opens no DB connection (run with
an unreachable `DATABASE_URL`).

**B1.11 Migrate entrypoint.** `src/db/migrate.ts` runs drizzle `migrate()` and exits;
`package.json` script `db:migrate`. `docker-entrypoint.sh` (owned by B1): `set -e; node
dist/db/migrate.js; exec node dist/main.js` — a failed migration stops the container.

**B1.12 Production refuses example secrets.** `env.ts` rejects, when `NODE_ENV=production`, any
secret equal to its `.env.example` value or starting with `dev-`/`test-`. Both sides tested. The B3
skeleton deploy therefore needs real random values for every secret (generated on the box), even
before auth exists.

---

## B2 — api-client + web trail list

**Files:** `packages/api-client/{package.json,openapi.json,src/schema.d.ts (generated),src/index.ts,test/contract.test-d.ts}`,
`apps/web/**` (Next.js 16: `src/app/page.tsx`, `src/lib/api.ts`, `src/lib/labels.ts`,
`next.config.ts`), `apps/web/e2e/home.spec.ts`, `apps/web/playwright.config.ts`, and a new
`contract` + `e2e` job in `ci.yml` (separate commit).

1. `pnpm --filter api-client generate` runs `openapi-typescript openapi.json -o src/schema.d.ts`.
   CI job: emit + generate, then `git diff --exit-code packages/api-client` (fails on a stale client).
2. `createApiClient(baseUrl)` on `openapi-fetch`. `contract.test-d.ts` (type-checked by
   `typecheck`): `GET /api/trails` data is `TrailSummary[]`; `// @ts-expect-error` on
   `city: 'Lima'`. Mutation: widen the DTO `city` to `string`, regenerate → the
   `@ts-expect-error` line fails type-check.
3. Home page (server component) fetches with `API_INTERNAL_URL`. Spanish labels from `labels.ts`;
   test every slug has a label and an unknown slug throws. Empty state: "Aún no hay senderos
   publicados.".
4. `next.config.ts`: the `/api/:path*` rewrite to the API exists **only when
   `NODE_ENV === 'development'`**; in production Traefik routes `/api`.
5. e2e: API + web on the B2 test DB, 2 published + 1 draft; 2 names visible, draft absent.
   Mutation: drop the published filter in the API → red.

---

## B3 — Staging deploy of the skeleton (worktree `wt-deploy`, parallel with B4)

**Files:** `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`,
`.github/workflows/deploy-staging.yml`, `docs/operations/deploy.md`, `scripts/verify-image.sh`,
box: `/usr/local/bin/ce-oss-deploy`, `authorized_keys` entry.

1. **Dockerfiles** (multi-stage, `node:24-alpine`, build arg `BUILD_SHA`): build with Turbo,
   `pnpm deploy --filter <app> --prod /out`; runtime stage copies `/out` only (plus
   `docker-entrypoint.sh` for the API), runs as `USER node`, `ENTRYPOINT ["/app/docker-entrypoint.sh"]`.
   Web: Next standalone output; the home page is dynamic (`export const dynamic = 'force-dynamic'`)
   so the build never calls the API. `.dockerignore` excludes `.git`, `**/node_modules`, `**/.env*`,
   `**/test/`, `**/e2e/`.
2. **`verify-image.sh <image>`** checks the **app directory** (`/app`, not `node_modules`):
   - no path matching `test/support|capture-mailer|e2e-main|auth\.cli|\.spec\.|\.e2e\.`;
   - a canary: CI writes `CANARY_<random>` into a dummy `apps/api/.env` before the build;
     `docker save` + grep of **every layer tar** must not find it.
   Runs in CI on both images and on the deployed digest. Mutations: make the runtime stage
   `COPY . .` → the path check goes red; `COPY apps/api/.env` → the canary check goes red.
3. **Coolify** (project `ciudad-enduro-oss`): PostGIS 17-3.5 DB (Docker network only, no public
   port), apps `api` and `web` from the repo with a read-only deploy key, auto-deploy **off**.
   Host `enduro-next.vops.pe`.
4. **Traefik labels:** `web`: `Host(\`enduro-next.vops.pe\`)`. `api`: `Host(\`enduro-next.vops.pe\`)
   && (Path(\`/api\`) || PathPrefix(\`/api/\`))`, higher priority, prefix preserved. Both use the
   existing Cloudflare `ipAllowList` middleware. **Remove any Coolify-generated router** (e.g. an
   sslip.io host) that lacks the middleware.
5. **Deploy access (G5):** a dedicated ed25519 key; its `authorized_keys` line is
   `command="/usr/local/bin/ce-oss-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding`.
   `ce-oss-deploy` reads `SSH_ORIGINAL_COMMAND` and:
   - accepts only a 40-hex SHA;
   - `git fetch` of the public repo into a cache, and **refuses a SHA that is not an ancestor of
     `origin/main`** (a fork commit can never deploy);
   - sets that commit on both Coolify apps, deploys **serially (api first)** under `flock`, polls
     to `finished`;
   - reads `/api/health` and **fails unless `revision` equals the SHA** (a crashed new container
     behind an old one is caught).
   **No `workflow_run`** (a fork PR's CI run can trigger it with fork code). The deploy is a job
   **inside `ci.yml`**: `needs:` every gate job, `if: github.event_name == 'push' && github.ref ==
   'refs/heads/main'`, deploys `github.sha`, uses a GitHub **Environment `staging`** restricted to
   `main` that holds the key, `concurrency: staging-deploy`. Fork PRs never receive secrets.
6. **DNS:** `enduro-next` CNAME, proxied, in Cloudflare.
7. **Live checks (scripted in `docs/operations/deploy.md`, run after each deploy):**
   - `GET https://enduro-next.vops.pe/api/health` → 200; home page lists the seeded trail.
   - `/apiary` and `/api` boundaries: `/apifoo` is served by web (404 page), `/api/health` by api.
   - Direct origin (`curl --resolve enduro-next.vops.pe:443:<box-ip>`) → 403 for `/` and
     `/api/health`.
   - On the box: every Traefik router on both containers lists the ipAllowList middleware;
     `docker port` shows no published host port for api, web or db.
   - `ce-oss-deploy` refuses `ls`, an empty command, a 39-char SHA, and a valid SHA that is not on
     `main` (create a throwaway branch commit to prove it); it accepts the current `main` SHA.
   - A pushed commit to `main` deploys, and `/api/health.revision` equals that SHA.
8. **Operator checklist — merge gate for B4** (B3 owns it, the owner runs the console steps):
   Coolify env for `api` with real random `BETTER_AUTH_SECRET` and `OTP_HMAC_SECRET`; Google OAuth
   client with redirect URI `https://enduro-next.vops.pe/api/auth/callback/google`; Resend sender
   domain verified; Cloudflare rate-limit rule on `POST /api/auth/email-otp/send-verification-otp`.
   B4 does not merge until every item is ticked, because the merge deploys auth to a public host.

---

## B4 — Auth (Better Auth) — security-critical, worktree `wt-auth`, parallel with B3

**Files:** `src/auth/{auth.options.ts,auth.factory.ts,auth.module.ts,mailer.ts,otp-throttle.ts,otp-throttle.hook.ts,otp-hash.ts,auth-paths.ts}`,
`apps/api/scripts/auth-cli.ts` (outside `src/`, never in the image), `test/support/e2e-main.ts` +
`scripts/seed-e2e.ts` (B4 owns them; B5 consumes them), `packages/api-client/**` regeneration for
`/api/me`,
`src/me/me.controller.ts`, `src/db/schema/{auth.ts (CLI-generated, reviewed),otp-send-log.ts}`,
migrations `0002_auth.sql`, `0003_otp_send_log.sql`; modify `main.ts` (`bodyParser: false`),
`app.module.ts`, trails + health controllers (`@AllowAnonymous()`), `schema/trails.ts` (FK);
`apps/api/package.json` (+ `better-auth`, `@thallesp/nestjs-better-auth`, `resend`; dev `auth`).
Tests: `test/auth/{throttle.int,otp.int,mail-paths.int,google.int,guard.int,origin.int,logging.int,ratelimit.int}.spec.ts`,
`test/support/{test-app.ts,capture-mailer.ts,google-jwks.ts}`.

**B4.1 Options + factory + CLI.** `auth.options.ts` exports `buildAuthOptions(deps)` (pure);
`auth.factory.ts` exports `createAuth(deps) = betterAuth(buildAuthOptions(deps))`;
`scripts/auth-cli.ts` exports `auth = createAuth(<dummy deps>)` for the CLI only. Generate:
`pnpm --filter api exec auth generate --config scripts/auth-cli.ts --output src/db/schema/auth.ts`.
`AuthModule.forRootAsync({ useFactory: (db, env, mailer, throttle) => ({ auth: createAuth(...),
disableTrustedOriginsCors: true, bodyParser: { json: { limit: '1mb' } } }) })`.

Options (the full set; anything not listed stays default):

```ts
{
  basePath: '/api/auth',
  baseURL: env.BETTER_AUTH_URL,            // https in staging/prod → Secure + __Secure- cookies
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  user: { additionalFields: { role: { type: 'string', defaultValue: 'rider', input: false } } },
  account: { accountLinking: { enabled: false } },                         // G1
  socialProviders: { google: { clientId, clientSecret,
    mapProfileToUser: (p) => { if (p.email_verified !== true) throw new APIError('FORBIDDEN'); return {}; } } },
  disabledPaths: [
    '/email-otp/request-password-reset', '/forget-password/email-otp', '/email-otp/reset-password',
    '/email-otp/verify-email', '/email-otp/check-verification-otp',
    '/email-otp/change-email', '/email-otp/request-email-change',
    '/sign-up/email', '/sign-in/email', '/update-user', '/change-email', '/delete-user',
  ],
  rateLimit: { enabled: true, storage: 'memory',                            // one container, windows ≤ 60 s
    customRules: { '/email-otp/send-verification-otp': { window: 60, max: 5 } } }, // per IP, before our throttle
  advanced: {
    disableOriginCheck: false,                                              // also in tests
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    backgroundTasks: { handler: (p) => void p.catch(() => {}) },            // respond before mail I/O
  },
  hooks: { before: otpThrottleHook(throttle) },
  plugins: [emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5,
    storeOTP: { hash: async (otp) => hmacSha256(env.OTP_HMAC_SECRET, otp) }, resendStrategy: 'rotate',
    sendVerificationOTP: ({ email, otp }, ctx) => mailer.sendOtp(email, otp, ctx) })],
}
```

The hook also rejects (400, generic body) any `/sign-in/social` request whose body carries
`idToken`: Phase 0 supports only the redirect flow, where the token is merely decoded.
The `email_verified` rejection from `mapProfileToUser` must end as a **redirect** to
`/ingresar?error=google_email_unverified` (via the provider's `errorCallbackURL`), not raw JSON at
the callback URL; the implementer verifies how the callback maps a thrown `APIError` and STOPS if
it cannot redirect.

**Allowlist, not denylist.** `auth-paths.ts` exports the explicit set of enabled auth paths
(`/sign-in/social`, `/callback/:id`, `/get-session`, `/sign-out`, `/email-otp/send-verification-otp`,
`/sign-in/email-otp`, `/ok`, `/error`, …). A test reads every endpoint path from `auth.api` and
asserts `enabled = all − disabledPaths` equals that set exactly. A library upgrade that adds an
endpoint turns the test red until someone decides about it.

The implementer verifies each disabled path name and the `backgroundTasks` / `customRules` /
`mapProfileToUser` signatures against the installed package types **before** writing the tests, and
STOPS if one differs. `/update-user` is disabled because Phase 0 has no profile editing (it would be
a privilege-escalation surface); it returns in Phase 1 with its own tests.

**B4.2 Throttle.** Table `otp_send_log (id bigserial, email_hash text, created_at timestamptz
default now())`, indexes `(email_hash, created_at)`, `(created_at)`. `email_hash` = HMAC-SHA256 of
the lower-cased email with `OTP_HMAC_SECRET`. **All time comparisons use the database clock**
(`now()`), never the JS clock. `tryAcquire(email)` in one transaction with
`pg_advisory_xact_lock(hashtext('otp_send'))`: global rows in the last 24 h ≥ 50 → deny and log
`{event:'otp_global_cap_reached'}` (no email); a row for this hash in the last 60 s → deny; else
insert → allow.

`otpThrottleHook` (matches `/email-otp/send-verification-otp`):
1. Run `formCsrfMiddleware` (from `better-auth/api`) **first**. A hostile origin gets its 403
   here, before any slot is used. (The endpoint's own origin middleware runs after the hook, so
   without this step a cross-origin request would burn the victim's 60-second slot and get 403,
   and no mail would leave.)
2. Validate the body with the **same** schema rules as the endpoint (email format, lowercase, no
   trim). Invalid → return nothing (the endpoint answers its own 400). Must not consume a slot.
3. `type !== 'sign-in'` → return the success shape, send nothing.
4. `tryAcquire` denied → return the success shape.
5. Allowed → put a one-use **send permit** for this email on the request context.
`mailer.sendOtp(email, otp, ctx)` **refuses to send without a matching permit** and logs
`otp_send_without_permit`. The mailer, not the hook, is the enforcement point: if the hook and the
endpoint ever disagree about a body, no unthrottled mail can leave.
The success shape is **captured from the real endpoint** in the test, not hard-coded.

Tests `throttle.int.spec.ts` (HTTP level, real DB; quota windows simulated by inserting backdated
rows with SQL, e.g. `now() - interval '59 seconds'`; **every request sets a unique
`cf-connecting-ip`** so the per-IP limiter never interferes; `beforeEach` truncates
`otp_send_log` and resets the in-memory limiter by building a fresh app):
- hostile `Origin` (no cookie) → 403 and **zero rows** in `otp_send_log`; `WEB_ORIGIN` → 200.
- a direct call of `mailer.sendOtp` without a permit → no mail, `otp_send_without_permit` logged.
- first send → mailer called; repeat with a row at −59 s → not called, status + content-type +
  body bytes equal to the real success; row at −61 s → called.
- another address right after → called (per address).
- `"A@X.pe"` after `"a@x.pe"` → blocked (case); `"a@x.pe "` → 400 from the endpoint and **no row
  inserted**.
- 50 rows in the last 24 h → a new address is not mailed, success-shaped, and the cap event is
  logged; a row at −24 h −1 s does not count.
- `type: 'forget-password'` and `type: 'email-verification'` → success shape, mailer not called,
  no row.
- concurrency, deterministic: open transaction T1 that holds the advisory lock (test helper), fire
  2 requests for one address, release T1 → exactly one mail and two success-shaped 200s.
- `otp_send_log` has no `@` in any column.
- Mutations: drop the cooldown branch; drop the cap branch; drop the advisory lock (the controlled
  concurrency test goes red); store the raw email; let invalid bodies consume a slot; remove the
  `formCsrfMiddleware` step (the hostile-origin zero-rows test goes red); remove the permit check
  in the mailer.

`mail-paths.int.spec.ts`: each disabled path → 404. A mailer whose promise never resolves → the
send still answers 200 within 1 s (background task). Must-not-fire: the hook does not alter
`/sign-in/email-otp` responses.

`ratelimit.int.spec.ts`: two different `cf-connecting-ip` values get separate buckets on
`/sign-in/email-otp` and on the send path (6th send from one IP in 60 s → 429; from another IP →
200); the same value is limited; a spoofed `x-forwarded-for` is ignored. Mutation: remove the send
`customRules` entry → the 6th-send test goes red.

**B4.3 OTP verification** (`otp.int.spec.ts`, `vi.useFakeTimers({ toFake: ['Date'] })` for Better
Auth's TTL, **advanced by at least 1 s between steps** so `createdAt` values differ; every request
with a unique `cf-connecting-ip`, so the per-IP limiter on `/sign-in/email-otp` never answers 429;
capture mailer):
- correct code within 10 min → session cookie (`HttpOnly`, `SameSite=Lax`); at 10 min + 1 s →
  rejected.
- 4 wrong then correct → accepted; 5 wrong then correct → rejected **with the `TOO_MANY_ATTEMPTS`
  error code** (assert the code, not only the status, so a 429 cannot pass the test).
- stored value == `hmacSha256(secret, code)` (parse the `code:attempts` value) and ≠
  `sha256(code)`. Mutations: `storeOTP: 'hashed'` → red; `'plain'` → red.
- a code works once: reuse after success → rejected; two concurrent verifications of one code →
  exactly one session.
- resend rotates: the old code is rejected after a new one is sent.
- Mutations: `expiresIn: 6000`; `allowedAttempts: 50`.

**B4.4 Google — redirect flow** (`google.int.spec.ts`): stub Google's **token endpoint** with
undici `MockAgent`; it returns an ID token (an unsigned-checked JWT is fine, because the redirect
flow only decodes it). Drive the real flow: `POST /api/auth/sign-in/social` → take `state` from the
redirect URL → `GET /api/auth/callback/google?code=…&state=…`.
- verified email, new `sub=G1` → user created, `account.accountId = 'G1'`, redirect to the web.
- same `sub`, changed email → same user.
- `email_verified: false` → **redirect** to `/ingresar?error=google_email_unverified`, no user,
  no account row.
- email-code user `r2@x.pe` exists; Google `sub=G2`, `r2@x.pe` verified → not linked
  (`account not linked` redirect), no new user.
- mismatched or reused `state` → rejected, no rows.
- `POST /sign-in/social` with an `idToken` body → 400, no rows; the same request without
  `idToken` → normal redirect (both sides).
- Mutations: enable `accountLinking` with `trustedProviders`; remove the `email_verified` check;
  remove the `idToken` rejection.
- Google OAuth tokens: `account` stores Google's access/ID tokens in plain text; Phase 0 never
  calls Google APIs after sign-in, so a `databaseHooks.account.create.before` drops
  `accessToken`, `refreshToken` and `idToken` before insert. Test: after sign-in those columns are
  null. Mutation: remove the hook → red.

**B4.5 Guard + `/api/me`** (`guard.int.spec.ts`): `/api/me` 401 without cookie, 200 with one;
`/api/trails` and `/api/health` 200 anonymous; deleted session row → 401; expired session → 401;
OTP sign-in body with `role: 'admin'` → user role `rider`. Mutations: remove `@AllowAnonymous()`
from trails; `role.input: true`.

**B4.6 Origin / CSRF** (`origin.int.spec.ts`, `disableOriginCheck: false` in the test app):
- POST `/api/auth/sign-in/email-otp` **with a `Cookie` header** (the router check only runs with
  cookies) and `Origin: https://evil.example` → 403; same with `WEB_ORIGIN` → passes.
- a `callbackURL` to `https://evil.example` on `/sign-in/social` → rejected; to `WEB_ORIGIN` → ok.
- `/api/me` and `/api/auth/get-session` with `Origin: WEB_ORIGIN` → **no** `Access-Control-Allow-*`
  header at all (same-origin needs none).
- Mutations: `disableOriginCheck: true` → the 403 test red; `disableTrustedOriginsCors: false` →
  the CORS test red (the adapter would answer the trusted origin).

**B4.7 No secrets in logs** (`logging.int.spec.ts`): capture the Nest logger and `console` during a
send, a failed send (Resend stub 500) and a verify; no line contains the code, the session token or
the plaintext email. Mutation: log the OTP in the mailer → red.

**B4.8 The capture mailer is test-only.** `capture-mailer.ts` and `test-app.ts` live under
`apps/api/test/support/`; `tsconfig.build.json` excludes `test/`; nothing in `src/` imports them.
B3's `verify-image.sh` proves no `/test/` path is in the image. (There is no capture endpoint in the
API; e2e in B5 reads codes through a test-only entrypoint `test/support/e2e-main.ts`.)

---

## B5 — Sign-in UI + live auth checks

**Files:** `apps/web/src/app/ingresar/page.tsx`, `src/lib/auth-client.ts` (Better Auth React
client + `emailOTPClient()`, same-origin base URL), `src/components/sign-in/*`,
`apps/web/e2e/sign-in.spec.ts`.

UI: email → "Enviar código" → 6-digit input → signed in; header shows the email from `/api/me`.
"Continuar con Google". Errors are generic ("Código inválido o vencido."). Error messages:
`account not linked` → "Esta cuenta ingresa con código por correo."; `google_email_unverified` →
"Tu correo de Google no está verificado."; 429 → "Demasiados intentos. Espera un minuto.".
e2e runs against B4's `test/support/e2e-main.ts` (API with the capture mailer; Playwright reads the
captured code from the test process through the entrypoint's in-process store, never over HTTP) on
the seed from `scripts/seed-e2e.ts`: sign-in end to end; 5 wrong codes → the
`TOO_MANY_ATTEMPTS` message (not the 429 message), then the right code is rejected. Each attempt
sets its own `cf-connecting-ip` header.

**Live checks on staging (after B3 + B4 merge and deploy):**
- `Set-Cookie` on sign-in has `__Secure-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`.
- A real Resend email arrives; sign-in works; Google sign-in works for a test user.
- Two clients from different IPs are limited separately on `/api/auth/sign-in/email-otp`.
- `test/support` code is absent: `verify-image.sh` on the deployed image digest.
- Cloudflare rate-limit rule on `POST /api/auth/email-otp/send-verification-otp` (per IP) is
  active — the operator signal and first line for the global-cap exhaustion attack.
- **Self-cleaning:** create a user through the real flow, assert rows, delete them, assert zero
  residual in `user`, `session`, `account`, `verification`, `otp_send_log`.

**Phase 0 exit:** the live checks above pass; CI green on `main`; the final adversarial review
(section 7) is closed.

---

## 6. Rungs and review per batch

| Batch | Review |
|-------|--------|
| B0, B1 | opus @ high (spec + security/quality) → fixes → final opus @ xhigh |
| B2 | one review with mutation proof, opus @ xhigh |
| B3 | opus @ high + gpt-6.1-sol @ high (infra blast radius) → final opus @ xhigh |
| B4 | opus @ high + gpt-6.1-sol @ high (auth) → fixes → final opus @ xhigh |
| B5 | one review with mutation proof + the live checks |

Reviewer prompt: "Do not trust the report. Read the code, run the scoped tests, mutate where you
doubt a test, restore. Then try to break one contract nobody tried; three attempts. A plain pass is
acceptable."

## 7. Plan gate status — CLOSED

- Round 1: opus 5.5 @ high (approve with changes) ∥ gpt-6.1-sol @ high (reject pending revision).
- Rev. 2 answered both.
- Final adversarial review: claude-fable-5.2 @ high (owner's choice): approve with changes, two
  blocking (fork deploy via `workflow_run`; slot burned by a cross-origin send). It stated that a
  third full review is unnecessary and a check of the revised B3.5, B4.2 and B4.4 is enough.
- Rev. 3 applies every final-review finding; the orchestrator checked B3.5, B4.2 and B4.4 against
  the package source (origin-check.mjs:101-108, google.mjs:118-121, geometry.js:20-47).

## 8. Accepted deviations (recorded, not hidden)

- **Session tokens are stored unhashed** (Better Auth 1.7.19 has no option). The old app stored a
  SHA-256. Mitigations: DB reachable only on the Docker network, 30-day expiry, revocation by row
  delete, backups encrypted. Revisit when Better Auth offers hashed session tokens.
- **The global cap of 50 codes per 24 h can be exhausted** by an attacker using 50 addresses from
  many IPs (carried-over rule). Mitigations: the built-in per-IP limit (5/60 s), the Cloudflare
  per-IP rule and the `otp_global_cap_reached` log event.

## 9. Gate ledger (round 1)

| Finding | Source | Verdict | Where fixed |
|---------|--------|---------|-------------|
| Other OTP mail paths skip throttle; timing oracle | both | confirmed (routes.mjs:449, 502) | B4.1 disabledPaths, B4.2 hook, backgroundTasks |
| Built-in limiter runs first; decorative concurrency test | both | confirmed | B4.1 customRules, B4.2 controlled concurrency |
| CLI is package `auth`, needs exported instance | both | confirmed | §0, B4.1 |
| Drizzle journal survives `public` drop | both | confirmed | B1.6 fresh database |
| Contract emitter: prefix, response metadata, import-time side effects | both | confirmed | B1.2, B1.10 |
| Linking with trusted Google = takeover; unverified Google pre-creation | both (they differed on on/off) | adjudicated: off + email_verified | G1, B4.4 |
| Shared IP bucket behind Cloudflare | both | confirmed (ip.mjs) | B4.1 ipAddressHeaders, B4.2 test, B5 live |
| `storeOTP: 'hashed'` unsalted; decorative test | both | confirmed | B4.1 HMAC, B4.3 |
| Clock injection impossible | both | confirmed | B4.2 DB clock, B4.3 fake Date |
| Origin check off in tests; adapter CORS on | gpt / opus | confirmed (create-context.mjs:211) | B4.1, B4.6 |
| `useSecureCookies` override | opus | confirmed (cookies/index.mjs:23) | removed; B5 live |
| Session tokens plaintext | opus | confirmed (internal-adapter.mjs:300) | §8 |
| Test mailer reachable in prod | both | confirmed risk | B4.8, B3 verify-image |
| SSH key in a public repo | opus | accepted | G5 forced command |
| Deploy a different revision than CI tested | gpt | accepted | B3.5 head_sha + serial |
| `PathPrefix(/api)` matches `/apiary`; extra Coolify routers | both | accepted | B3.4, B3.7 |
| Image check by inspect is not a file list | gpt | accepted | B3.2 |
| Turbo strict env mode | gpt | accepted | B0.2 |
| Google test must sign ID tokens + JWKS | gpt | confirmed (google.mjs:113) | B4.4 |
| `expectTypeOf` not type-checked | gpt | accepted | §3, B2.2 |
| B2 ∥ B3a collide | both | accepted | G4 new ordering |
| Deploy late | opus | accepted | G6 |
| Cut SRID CHECK + unused indexes | both | accepted | B1.5 |
| `USER node`, `rateLimit` residual, cap signal | opus | accepted | B3.1, B5, §8 |
| Jest instead of Vitest | — | rejected by both | G3 |

## 10. Gate ledger (final review, fable 5.2)

| # | Finding | Verdict | Where fixed |
|---|---------|---------|-------------|
| F1 | `workflow_run` lets a fork PR deploy fork code with the secret | accepted (GitHub semantics) | B3.5: deploy job in `ci.yml` on push to main, Environment, ancestor-of-main check |
| F2 | Cross-origin send burns a slot, no mail; hook/endpoint divergence | confirmed (origin-check.mjs:101-108) | B4.2 CSRF first + mailer permit |
| F3 | Per-IP limiter removed on the send path | accepted | B4.1 customRules 5/60 s |
| F4 | Per-IP limiter breaks attempt tests | accepted | B4.2/B4.3 unique `cf-connecting-ip`, assert `TOO_MANY_ATTEMPTS` |
| F5 | Origin test without cookie; decorative CORS test | confirmed | B4.6 |
| F6 | Redirect flow only decodes the ID token | confirmed (google.mjs:118-121) | §0, B4.1 idToken rejection, B4.4 redirect-flow tests, B5 messages |
| F7 | Drizzle `geometry()` discards the SRID | confirmed (geometry.js:20-47) | §0, B1.4 customType points + SRID tests |
| F8 | Image checks decorative | accepted | B3.2 app-dir paths + canary in every layer |
| F9 | No proof the tested revision is live | accepted | B1.9 revision, B3.5 SHA compare |
| F10 | DB guard test cannot fire; suffix unvalidated | accepted | B1.6 |
| F11 | e2e entrypoint, client regen, operator steps unowned | accepted | B4 files, B3.8 checklist, B1.12 |
| F12 | `disabledPaths` is a denylist | accepted | B4.1 allowlist test |
| F13 | Non-6-digit codes do consume attempts | confirmed | assertion deleted |
| nits | async hash; `exec node`; Google tokens in `account`; `auth.cli` in `src/`; frozen Date; prerender; memory rate-limit storage | accepted | B4.1, B1.11, B4.4, B4.1, B4.3, B3.1, B4.1 |
