# Phase 0 Foundation — Implementation Plan (rev. 2)

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

**Revision 2** folds in the plan gate (opus 5.5 @ high ∥ gpt-6.1-sol @ high, 2026-11-10). Every
claim below marked *verified* was read in the published package source by at least one reviewer
and spot-checked by the orchestrator. The gate ledger is in section 9.

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
- **Google provider** verifies a signed ID token against Google's JWKS (google.mjs:113-155).
  Account linking with `trustedProviders` skips the `email_verified` check (link-account.mjs).
- **CLI** (`auth@1.7.19`) needs a config file that **exports an instance** (`auth` or default); it
  emits a Drizzle schema that drizzle-kit 0.31.11 accepts (gpt-6.1-sol generated it end to end).
  With `rateLimit.storage: 'database'` it also emits a `rateLimit` table.
- **Drizzle 0.45** has native `geometry(point, srid)`; no geography, no LineString. The migration
  journal lives in schema **`drizzle`** (`drizzle.__drizzle_migrations`), not `public`.
- **Swagger in preview mode** (`NestFactory.create(AppModule, { preview: true })`) skips DI
  instantiation but **not** import-time code; it reads the global prefix from the app instance;
  response schemas need `@ApiOkResponse({ type })` — `@ApiProperty` alone does not attach them.
- **Vitest + unplugin-swc** works with Nest 12 DI and Swagger (gpt-6.1-sol probe; removing
  decorator metadata made it fail). Keep Vitest; add a small metadata smoke test.

## 1. Decisions taken at the gate

| # | Question | Decision | Why |
|---|----------|----------|-----|
| G1 | Account linking | **Off.** Google sign-in additionally requires `email_verified === true`. An email-code user who taps Google gets a clear "Ingresa con tu código de correo" message. | Linking with trusted providers skips the verification check (takeover). Without the `email_verified` rule, an attacker pre-creates the user with Google and keeps access after the owner signs in by code — this applies even with linking off. Google warns a verified third-party address may no longer belong to the account holder. |
| G2 | Throttle placement | `hooks.before`, on **every** remaining mail path; unused mail paths disabled; built-in limiter **off for the send path only** (our throttle replaces it with success-shaped answers); mail sent in the background so every path returns before email I/O. | Both reviewers reproduced the bypass and the limiter ordering. |
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

**B1.4 Geo types.** Points: native `geometry('start_point', { type: 'point', mode: 'xy', srid: 4326 })`
(`x` = lng). Path: `customType` with `dataType() = 'geometry(LineString, 4326)'` and a **write-only**
`toDriver` (`SRID=4326;LINESTRING(lng lat, …)`); its `data` type documents writes only. Reads always
select `ST_AsGeoJSON(path)::json`.

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
1. Build the URL from `DATABASE_URL` + `ciudad_enduro_test_${TEST_DB_SUFFIX ?? 'main'}`.
2. **Refuse** unless the host is `localhost`/`127.0.0.1`/the CI service host and the database
   name starts with `ciudad_enduro_test_`.
3. `DROP DATABASE IF EXISTS … WITH (FORCE)`, `CREATE DATABASE`, `CREATE EXTENSION postgis`, run all
   migrations. (A fresh database removes the `drizzle` journal too.)
Spec files truncate their tables in `beforeEach`; `fileParallelism: false` for `*.int.spec.ts`.
Test: pointing `DATABASE_URL` at a non-test name makes global setup throw before any statement.

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

**B1.9 Health.** `GET /api/health` → `{status:'ok', db:'ok'}`; DB down → 503 `db:'down'`. Both sides.

**B1.10 Contract emitter.** `emit-openapi.ts`: `NestFactory.create(AppModule, { preview: true,
logger: false })` → `configureApp` → `SwaggerModule.createDocument` → write
`packages/api-client/openapi.json` with sorted keys. `openapi.spec.ts` asserts the document has
`/api/trails` and `/api/trails/{slug}` (not `/trails`), the `200` response schemas reference the
DTOs, and `city` is an enum of the three cities. Test that emission opens no DB connection (run with
an unreachable `DATABASE_URL`).

**B1.11 Migrate entrypoint.** `src/db/migrate.ts` runs drizzle `migrate()` and exits;
`package.json` script `db:migrate`. Used by the container entrypoint in B3.

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

1. **Dockerfiles** (multi-stage, `node:24-alpine`): build with Turbo, `pnpm deploy --filter <app>
   --prod /out`; runtime stage copies `/out` only, runs as `USER node`. API `CMD`:
   `node dist/db/migrate.js && node dist/main.js`. Web: Next standalone output.
   `.dockerignore` excludes `.git`, `**/node_modules`, `**/.env*`, `CLAUDE.md`, `AGENTS.md`,
   `.claude/`, `.codex/`, `docs/`, `**/test/`, `**/e2e/`.
2. **`verify-image.sh <image>`**: `docker create` + `docker export | tar -t` → fail if any path
   matches `CLAUDE.md|AGENTS.md|\.claude/|\.env|/test/|\.spec\.|\.e2e`; also fail if the image
   **history** contains a canary string planted in a dummy `.env` at build time. Runs in CI on both
   images. Mutation: remove `CLAUDE.md` from `.dockerignore` (with a dummy `CLAUDE.md` present) →
   the script fails.
3. **Coolify** (project `ciudad-enduro-oss`): PostGIS 17-3.5 DB (Docker network only, no public
   port), apps `api` and `web` from the repo with a read-only deploy key, auto-deploy **off**.
   Host `enduro-next.vops.pe`.
4. **Traefik labels:** `web`: `Host(\`enduro-next.vops.pe\`)`. `api`: `Host(\`enduro-next.vops.pe\`)
   && (Path(\`/api\`) || PathPrefix(\`/api/\`))`, higher priority, prefix preserved. Both use the
   existing Cloudflare `ipAllowList` middleware. **Remove any Coolify-generated router** (e.g. an
   sslip.io host) that lacks the middleware.
5. **Deploy access (G5):** a dedicated ed25519 key; its `authorized_keys` line is
   `command="/usr/local/bin/ce-oss-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding`.
   `ce-oss-deploy` reads `SSH_ORIGINAL_COMMAND`, accepts only a 40-hex SHA, sets that commit on both
   Coolify apps, triggers the deploys **serially (api first)** under `flock`, polls to `finished`.
   GitHub secret: that key only. Workflow: on `workflow_run` of CI **success** on `main`, deploy
   `github.event.workflow_run.head_sha` (the exact tested revision). `concurrency:` one staging
   deploy at a time.
6. **DNS:** `enduro-next` CNAME, proxied, in Cloudflare.
7. **Live checks (scripted in `docs/operations/deploy.md`, run after each deploy):**
   - `GET https://enduro-next.vops.pe/api/health` → 200; home page lists the seeded trail.
   - `/apiary` and `/api` boundaries: `/apifoo` is served by web (404 page), `/api/health` by api.
   - Direct origin (`curl --resolve enduro-next.vops.pe:443:<box-ip>`) → 403 for `/` and
     `/api/health`.
   - On the box: every Traefik router on both containers lists the ipAllowList middleware;
     `docker port` shows no published host port for api, web or db.
   - `ce-oss-deploy` refuses `ls`, an empty command and a 39-char SHA.

---

## B4 — Auth (Better Auth) — security-critical, worktree `wt-auth`, parallel with B3

**Files:** `src/auth/{auth.options.ts,auth.factory.ts,auth.cli.ts,auth.module.ts,mailer.ts,otp-throttle.ts,otp-throttle.hook.ts,otp-hash.ts}`,
`src/me/me.controller.ts`, `src/db/schema/{auth.ts (CLI-generated, reviewed),otp-send-log.ts}`,
migrations `0002_auth.sql`, `0003_otp_send_log.sql`; modify `main.ts` (`bodyParser: false`),
`app.module.ts`, trails + health controllers (`@AllowAnonymous()`), `schema/trails.ts` (FK);
`apps/api/package.json` (+ `better-auth`, `@thallesp/nestjs-better-auth`, `resend`; dev `auth`).
Tests: `test/auth/{throttle.int,otp.int,mail-paths.int,google.int,guard.int,origin.int,logging.int,ratelimit.int}.spec.ts`,
`test/support/{test-app.ts,capture-mailer.ts,google-jwks.ts}`.

**B4.1 Options + factory + CLI.** `auth.options.ts` exports `buildAuthOptions(deps)` (pure);
`auth.factory.ts` exports `createAuth(deps) = betterAuth(buildAuthOptions(deps))`; `auth.cli.ts`
exports `auth = createAuth(<dummy deps>)` for the CLI only (never imported by `src/`). Generate:
`pnpm --filter api exec auth generate --config src/auth/auth.cli.ts --output src/db/schema/auth.ts`.
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
  rateLimit: { enabled: true, storage: 'database',
    customRules: { '/email-otp/send-verification-otp': false } },           // our throttle owns it
  advanced: {
    disableOriginCheck: false,                                              // also in tests
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    backgroundTasks: { handler: (p) => void p.catch(() => {}) },            // respond before mail I/O
  },
  hooks: { before: otpThrottleHook(throttle) },
  plugins: [emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5,
    storeOTP: { hash: (otp) => hmacSha256(env.OTP_HMAC_SECRET, otp) }, resendStrategy: 'rotate',
    sendVerificationOTP: ({ email, otp }) => mailer.sendOtp(email, otp) })],
}
```

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
1. Validate the body with the **same** schema rules as the endpoint (email format, lowercase, no
   trim). Invalid → return nothing (the endpoint answers its own 400). Must not consume a slot.
2. `type !== 'sign-in'` → return the success shape, send nothing.
3. `tryAcquire` denied → return the success shape.
The success shape is **captured from the real endpoint** in the test, not hard-coded.

Tests `throttle.int.spec.ts` (HTTP level, real DB; quota windows simulated by inserting backdated
rows with SQL, e.g. `now() - interval '59 seconds'`):
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
  concurrency test goes red); store the raw email; let invalid bodies consume a slot.

`mail-paths.int.spec.ts`: each disabled path → 404. A mailer whose promise never resolves → the
send still answers 200 within 1 s (background task). Must-not-fire: the hook does not alter
`/sign-in/email-otp` responses.

`ratelimit.int.spec.ts`: two different `cf-connecting-ip` values get separate buckets on
`/sign-in/email-otp`; the same value is limited; a spoofed `x-forwarded-for` is ignored.

**B4.3 OTP verification** (`otp.int.spec.ts`, `vi.useFakeTimers({ toFake: ['Date'] })` for Better
Auth's TTL; capture mailer):
- correct code within 10 min → session cookie (`HttpOnly`, `SameSite=Lax`); at 10 min + 1 s →
  rejected.
- 4 wrong then correct → accepted; 5 wrong then correct → rejected.
- stored value == `hmacSha256(secret, code)` (parse the `code:attempts` value) and ≠
  `sha256(code)`. Mutations: `storeOTP: 'hashed'` → red; `'plain'` → red.
- a code works once: reuse after success → rejected; two concurrent verifications of one code →
  exactly one session.
- resend rotates: the old code is rejected after a new one is sent.
- a non-6-digit code → rejected without consuming an attempt (assert attempts unchanged).
- Mutations: `expiresIn: 6000`; `allowedAttempts: 50`.

**B4.4 Google** (`google.int.spec.ts`): `google-jwks.ts` generates an RSA key, serves a JWKS and
the token endpoint through undici `MockAgent`, and signs ID tokens.
- verified email, new `sub=G1` → user created, `account.accountId = 'G1'`.
- same `sub`, changed email → same user.
- `email_verified: false` → no user, no account row.
- email-code user `r2@x.pe` exists; Google `sub=G2`, `r2@x.pe` verified → not linked (Better Auth
  `account not linked` error) and no new user.
- bad signature, wrong `aud`, wrong `iss`, mismatched OAuth `state` → rejected, no rows.
- Mutations: enable `accountLinking` with `trustedProviders`; remove the `email_verified` check.

**B4.5 Guard + `/api/me`** (`guard.int.spec.ts`): `/api/me` 401 without cookie, 200 with one;
`/api/trails` and `/api/health` 200 anonymous; deleted session row → 401; expired session → 401;
OTP sign-in body with `role: 'admin'` → user role `rider`. Mutations: remove `@AllowAnonymous()`
from trails; `role.input: true`.

**B4.6 Origin / CSRF** (`origin.int.spec.ts`, `disableOriginCheck: false` in the test app):
POST `/api/auth/sign-in/email-otp` with `Origin: https://evil.example` → 403; with `WEB_ORIGIN` →
passes; a `callbackURL` to `https://evil.example` → rejected; `/api/me` with a hostile `Origin`
returns no `Access-Control-Allow-Origin`. Mutation: `disableOriginCheck: true` → red;
`disableTrustedOriginsCors: false` → the CORS test red.

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
"Continuar con Google". Errors are generic ("Código inválido o vencido."). On Google's
`account not linked`: "Esta cuenta ingresa con código por correo." e2e runs against
`test/support/e2e-main.ts` (API with the capture mailer): sign-in end to end; 5 wrong codes →
generic error, then the right code is rejected.

**Live checks on staging (after B3 + B4 merge and deploy):**
- `Set-Cookie` on sign-in has `__Secure-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`.
- A real Resend email arrives; sign-in works; Google sign-in works for a test user.
- Two clients from different IPs are limited separately on `/api/auth/sign-in/email-otp`.
- `test/support` code is absent: `verify-image.sh` on the deployed image digest.
- Cloudflare rate-limit rule on `POST /api/auth/email-otp/send-verification-otp` (per IP) is
  active — the operator signal and first line for the global-cap exhaustion attack.
- **Self-cleaning:** create a user through the real flow, assert rows, delete them, assert zero
  residual in `user`, `session`, `account`, `verification`, `otp_send_log`, `rateLimit`.

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

## 7. Plan gate status

- Round 1: opus 5.5 @ high (approve with changes) ∥ gpt-6.1-sol @ high (reject pending revision).
- This revision answers both. **Final adversarial plan review: claude-fable-5.2 @ high** (owner's
  choice, 2026-11-10), independent of round 1.

## 8. Accepted deviations (recorded, not hidden)

- **Session tokens are stored unhashed** (Better Auth 1.7.19 has no option). The old app stored a
  SHA-256. Mitigations: DB reachable only on the Docker network, 30-day expiry, revocation by row
  delete, backups encrypted. Revisit when Better Auth offers hashed session tokens.
- **The global cap of 50 codes per 24 h can be exhausted** by an attacker using 50 addresses
  (carried-over rule). Mitigations: the Cloudflare per-IP rule and the `otp_global_cap_reached` log
  event.

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
