# Phase 0 Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (inside the
> orchestrated-delivery loop) to implement this plan batch by batch.

**Goal:** A monorepo where a Next.js web app lists published trails from a NestJS + PostGIS API
through a generated typed client, and a rider signs in with an email code or Google through
Better Auth, deployed to a staging host on Coolify behind the Cloudflare origin lock.

**Architecture:** pnpm + Turborepo monorepo. `apps/api` (NestJS 12, Drizzle, Better Auth) owns all
data and auth. `apps/web` (Next.js 16) is a client of the API only. One domain: Traefik routes
`/api/*` to the API container and the rest to the web container, so auth cookies are first-party
and there is no CORS.

**Tech stack (verified on npm 2026-11-10):** Node 24.18, pnpm 12.18, turbo 2.11, TypeScript
**6.0.3** (pinned, see D13), @nestjs/core 12.4, @nestjs/swagger 12.1, drizzle-orm 0.45.4,
drizzle-kit 0.31, better-auth 1.7.19 (CLI: the `auth` bin of the same package — the old
`@better-auth/cli` is deprecated), @thallesp/nestjs-better-auth 2.8.0, next 16.4, vitest 5.1,
@playwright/test 1.65, zod 4.6, pg 8.23, resend 6.37, openapi-typescript 7.13, openapi-fetch 0.17,
unplugin-swc 2.0 + @swc/core 1.16 (Vitest needs SWC for Nest decorator metadata).

Design reference: `docs/architecture/phase-0-foundation.md` (decisions D1–D16).

---

## 0. Verified facts vs open questions

**Verified by reading the published packages (2026-11-10):**

- `@thallesp/nestjs-better-auth@2.8.0` peers: `@nestjs/core ^11.1.6 || ^12`, `better-auth >=1.5 <2`,
  `typescript ^5.9.2 || ^6`, `express ^5.1`. It registers a **global** `AuthGuard`: every route is
  protected unless marked `@AllowAnonymous()` or `@OptionalAuth()`. It requires
  `NestFactory.create(AppModule, { bodyParser: false })` and re-adds parsers for non-auth routes via
  `AuthModule.forRoot({ auth, bodyParser: {...} })`. Session via `@Session() session: UserSession`.
- Better Auth `emailOTP` options: `sendVerificationOTP({ email, otp, type }, ctx)`, `otpLength`,
  `expiresIn` (seconds, default 300), `allowedAttempts` (default 3), `storeOTP`
  (`"plain" | "hashed" | "encrypted" | custom`, default **plain**), `resendStrategy`
  (`"rotate" | "reuse"`), `disableSignUp`, plugin `rateLimit { window, max }`.
- Better Auth core options: `rateLimit { customRules, storage: "memory" | "database" |
  "secondary-storage" }`, `hooks.before` / `hooks.after` (`AuthMiddleware`).
- Drizzle 0.45 `pg-core` has a native `geometry({ type: 'point', mode: 'xy' | 'tuple', srid })`
  column. It has **no** `geography` column and no LineString type.

**Consequence for D4:** store `geometry(Point, 4326)` (native Drizzle type) and
`geometry(LineString, 4326)` (Drizzle `customType`), and cast to `::geography` in distance queries
(meters). A GiST index on the `::geography` expression keeps `ST_DWithin` fast. This replaces the
`geography` columns in the design doc.

**Open questions for the plan gate (reviewers must answer):**

1. Better Auth account linking: `accountLinking: { enabled: true, trustedProviders: ['google'] }`
   links a Google sign-in to an existing email-code user with the same verified email. Is that a
   takeover risk here, or should linking be off (Google `sub` and email-code users stay separate)?
2. Throttle placement: a `hooks.before` on `/email-otp/send-verification-otp` that short-circuits
   with a success-shaped response when the per-address cooldown or the global daily cap fires.
   Is the hook the right layer, and can its response be made byte-identical to a real success?
3. Is SWC + Vitest the right test setup for NestJS 12 decorators, or is Jest (the Nest default)
   less risky?
4. Batch B2 (auth) and batch B3a (contract + web list) run in parallel worktrees after B1. Both add
   dependencies (`pnpm-lock.yaml`). Is "regenerate the lockfile at merge" enough, or must one batch
   own all dependency additions?

---

## 1. Batches and parallelism

```
B0 skeleton ──► B1 API core ──┬──► B2 auth (worktree wt-auth) ─────┬──► B3b sign-in UI ──► B4 deploy
                              └──► B3a contract + web list (wt-web) ┘
```

| Batch | Rung | Owner of shared files | Parallel? |
|-------|------|------------------------|-----------|
| B0 Monorepo skeleton + CI | Full (foundation) | root `package.json`, lockfile, CI | no |
| B1 API core: DB, schema, trails | Full (foundation) | `apps/api/src/db/**`, migrations | no |
| B2 Auth (Better Auth + security rules) | **Full + Codex** (security) | auth schema + migration, `apps/api/package.json` | yes, with B3a |
| B3a Contract + web trail list | Standard | `packages/api-client/**`, `apps/web/**` | yes, with B2 |
| B3b Web sign-in UI | Standard | `apps/web/src/app/(auth)/**` | no (needs B2 + B3a) |
| B4 Deploy to staging | Full + Codex (infra, blast radius) | `Dockerfile`s, `.github/workflows/**` | no |

**Shared-file rules (all batches):**
- Only B0 edits the root `package.json` and `turbo.json`. Later batches edit only their own
  workspace `package.json`.
- `pnpm-lock.yaml` conflicts are resolved by the orchestrator at merge with `pnpm install`, then the
  full gate re-runs. No batch hand-edits the lockfile.
- Only one batch at a time owns `apps/api/src/db/schema/**` and `apps/api/drizzle/**`. B2 owns
  them while it runs; B3a must not touch them.
- Migrations are generated (`drizzle-kit generate`), committed, and never edited after merge.

---

## 2. Global rules for every implementer and reviewer prompt

- TDD: write the failing test, run it red, implement, run it green, commit.
- **Mutation proof:** every test for a rule (security, constraint, filter) must be shown red once
  by breaking the code on purpose. Record "mutation → test that went red" in the PR body. A claim
  in a comment, docblock or CHANGELOG with no test that fails when the claim breaks is deleted.
- Test both sides of every decision: one case where the rule must fire, one where it must not.
- Scoped runs: `pnpm --filter <pkg> exec vitest run <file> -t "<name>"`. Full gate once, at the
  end of the batch. Type-check first, alone; tests only after it is clean. Write long output to a
  file once, then search the file.
- No mocks for the database. Integration tests use the real PostGIS from `docker-compose.dev.yml`
  (local) or the CI service container.
- STOP and ASK on unexpected state (wrong branch, a dependency peer conflict, a spec contradiction).
- Comments in English. UI strings in Spanish (es-PE).
- Commit trailer: `Co-Authored-By: ArkeyWave <kennedy.monzon@gmail.com>`.
- Never commit secrets. `.env.example` lists every variable with a dummy value.

---

## B0 — Monorepo skeleton + CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.nvmrc` (`24`),
  `.editorconfig`, `.gitattributes` (`* text=auto eol=lf`), `.env.example`,
  `docker-compose.dev.yml`, `packages/config/{package.json,tsconfig.base.json,eslint.config.mjs}`,
  `.github/workflows/ci.yml`.
- Modify: `README.md` (dev setup section), `CHANGELOG.md`.

**Task B0.1 — workspace root**

`package.json` (root):

```json
{
  "name": "ciudad-enduro",
  "private": true,
  "packageManager": "pnpm@12.18.0",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "db:up": "docker compose -f docker-compose.dev.yml up -d --wait"
  },
  "devDependencies": { "turbo": "2.11.10", "typescript": "6.0.3" }
}
```

`pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
`turbo.json`: tasks `build` (dependsOn `^build`, outputs `dist/**`, `.next/**` minus cache),
`dev` (persistent, no cache), `lint`, `typecheck` (dependsOn `^build`), `test` (dependsOn `^build`).

**Task B0.2 — local database**

`docker-compose.dev.yml`: service `db`, image `postgis/postgis:17-3.5`, port `5434:5432` (5432 and
5433 are taken on this machine), healthcheck `pg_isready`, volume `ce_pgdata`. Two databases created
by an init script: `ciudad_enduro` and `ciudad_enduro_test`, both with `CREATE EXTENSION postgis`.

Verify: `pnpm db:up` then
`docker compose -f docker-compose.dev.yml exec db psql -U postgres -d ciudad_enduro_test -c "select postgis_version()"`
→ prints `3.5 ...`.

**Task B0.3 — shared config**

`packages/config/tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2023`,
`module NodeNext`, `moduleResolution NodeNext`, `skipLibCheck`. Nest needs
`experimentalDecorators` + `emitDecoratorMetadata`: set them in `apps/api/tsconfig.json` only.
ESLint flat config with `typescript-eslint` recommended-type-checked.

**Task B0.4 — CI skeleton**

`.github/workflows/ci.yml` on `push` to `main` and `pull_request`:
`pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`.
Service `postgis/postgis:17-3.5` with health check, `DATABASE_URL` pointing to it. Node 24 via
`actions/setup-node` with `cache: pnpm`.

**Done when:** `pnpm install && pnpm lint && pnpm typecheck` pass with zero packages doing work,
CI runs green on a PR, `pnpm db:up` brings PostGIS up.

---

## B1 — API core: config, database, trails

**Files:**
- Create: `apps/api/{package.json,tsconfig.json,nest-cli.json,vitest.config.ts,drizzle.config.ts}`
- Create: `apps/api/src/main.ts`, `src/app.module.ts`, `src/config/env.ts`,
  `src/db/{db.module.ts,db.ts,schema/index.ts,schema/trails.ts,types/geo.ts}`,
  `src/trails/{trails.module.ts,trails.controller.ts,trails.service.ts,dto/trail.dto.ts}`,
  `src/health/health.controller.ts`
- Create: `apps/api/drizzle/0000_*.sql` (generated), `apps/api/drizzle/0001_trail_constraints.sql`
  (custom: check constraints + GiST index)
- Test: `apps/api/test/{setup-db.ts,env.spec.ts,trails.int.spec.ts,trail-constraints.int.spec.ts}`

**Task B1.1 — env validation (fail fast)**

`src/config/env.ts` parses `process.env` with zod 4: `NODE_ENV`, `PORT` (default 3001),
`DATABASE_URL` (url, protocol `postgres:` or `postgresql:`), `WEB_ORIGIN` (url),
`BETTER_AUTH_SECRET` (min 32 chars), `BETTER_AUTH_URL` (url), `RESEND_API_KEY`, `EMAIL_FROM`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OTP_HMAC_SECRET` (min 32). Export `loadEnv()`.

Test `env.spec.ts`:
- valid object → returns typed env.
- `BETTER_AUTH_SECRET` of 31 chars → throws, and the error names the key **without printing the
  value** (assert the thrown message does not contain the secret string).
- missing `DATABASE_URL` → throws.

**Task B1.2 — geo column types**

`src/db/types/geo.ts`:

```ts
import { customType } from 'drizzle-orm/pg-core';

export type LngLat = { lng: number; lat: number };

// geometry(LineString, 4326); read as GeoJSON-ish array of [lng, lat].
export const lineString = customType<{ data: [number, number][]; driverData: string }>({
  dataType() {
    return 'geometry(LineString, 4326)';
  },
  toDriver(coords) {
    const wkt = coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
    return `SRID=4326;LINESTRING(${wkt})`;
  },
});
```

Points use the native `geometry('start_point', { type: 'point', mode: 'xy', srid: 4326 })`
(`x` = lng, `y` = lat). Reads of `path` use `ST_AsGeoJSON(path)` in the select, never the raw
driver value (the driver returns hex EWKB).

**Task B1.3 — trails schema**

`src/db/schema/trails.ts`: table `trails` with `id uuid pk default gen_random_uuid()`,
`slug text unique not null`, `name text not null`, `description text not null default ''`,
`city` pgEnum (`Chimbote`, `Nuevo Chimbote`, `Trujillo`), `department` pgEnum (`Ancash`,
`La Libertad`), `difficulty` pgEnum (`facil`, `intermedio`, `dificil`), `type` pgEnum
(`descenso`, `cross_country`, `urbano`), `status` pgEnum (`draft`, `published`, `hidden`)
default `draft`, `start_point` geometry point not null, `end_point` geometry point null,
`path` lineString null, `distance_m integer null`, `elevation_gain_m integer null`,
`author_id text null` (FK to `user.id` added in B2), `created_at`, `updated_at` timestamptz.

Enum values are ASCII slugs; the web maps them to Spanish labels. (The old app stored Spanish
labels with accents in the DB; that coupled UI copy to the schema.)

`0001_trail_constraints.sql` (custom migration, `drizzle-kit generate --custom`):

```sql
-- Peru bounding box. A swapped lat/lng lands outside it and fails loudly.
ALTER TABLE trails ADD CONSTRAINT trails_start_in_peru
  CHECK (ST_X(start_point) BETWEEN -81.4 AND -68.6 AND ST_Y(start_point) BETWEEN -18.4 AND 0.1);
ALTER TABLE trails ADD CONSTRAINT trails_end_in_peru
  CHECK (end_point IS NULL OR (ST_X(end_point) BETWEEN -81.4 AND -68.6 AND ST_Y(end_point) BETWEEN -18.4 AND 0.1));
ALTER TABLE trails ADD CONSTRAINT trails_srid
  CHECK (ST_SRID(start_point) = 4326 AND (path IS NULL OR ST_SRID(path) = 4326));
CREATE INDEX trails_start_geog_gist ON trails USING gist ((start_point::geography));
CREATE INDEX trails_status_city ON trails (status, city);
```

Test `trail-constraints.int.spec.ts` (real DB, migrated fresh in `setup-db.ts`):
- insert with `start_point` lng −78.52, lat −9.09 → succeeds.
- insert with swapped axes (x −9.09, y −78.52) → rejects with `trails_start_in_peru`.
- insert with `end_point` outside Peru → rejects with `trails_end_in_peru`.
- insert with `end_point` null → succeeds.
- **Mutation:** delete the `trails_start_in_peru` statement, re-migrate, the swapped-axes test goes
  red. Restore.

`test/setup-db.ts`: drops and re-creates the `public` schema of `ciudad_enduro_test`, runs
`CREATE EXTENSION IF NOT EXISTS postgis`, runs all migrations with drizzle's `migrate()`. Each spec
file truncates the tables it uses in `beforeEach`. Vitest `fileParallelism: false` for `*.int.spec.ts`
(one shared database).

**Task B1.4 — trails endpoints**

`GET /api/trails?city=<city>` → published trails only, ordered by `created_at desc`, response
`TrailSummaryDto[]` (`id, slug, name, city, difficulty, type, start: {lat, lng}, distanceM`).
`GET /api/trails/:slug` → `TrailDetailDto` (summary + `description, end, path: [lng,lat][] | null,
elevationGainM`), 404 when the trail is missing **or not published** (same response for both).
`city` validated against the enum; an invalid value → 400.

`main.ts`: `app.setGlobalPrefix('api')`, `ValidationPipe({ whitelist: true, transform: true })`,
listen on `env.PORT`. (`bodyParser: false` arrives in B2.)

Test `trails.int.spec.ts` (Nest app via `@nestjs/testing` + supertest, real DB):
- seeds 1 published Chimbote, 1 published Trujillo, 1 draft Chimbote.
- `GET /api/trails` → 2 items, no draft.
- `GET /api/trails?city=Chimbote` → 1 item.
- `GET /api/trails?city=Lima` → 400.
- `GET /api/trails/<draft-slug>` → 404, body identical to `GET /api/trails/nope`.
- `start` comes back as `{ lat: -9.09, lng: -78.52 }` (not swapped).
- **Mutations:** drop the `status = 'published'` filter → the draft tests go red; swap x/y in the
  mapper → the coordinate test goes red.

**Task B1.5 — health**

`GET /api/health` → `{ status: 'ok', db: 'ok' }` after `select 1`; `503` with `db: 'down'` when the
query fails. Test both sides (point the app at a closed port for the down case).

**Done when:** all B1 tests green with the mutations recorded; `pnpm --filter api dev` serves
`/api/trails` against the local DB.

---

## B2 — Auth (Better Auth) — security-critical, worktree `wt-auth`

**Files:**
- Create: `apps/api/src/auth/{auth.ts,auth.module.ts,mailer.ts,otp-throttle.ts,otp-throttle.hook.ts}`,
  `src/me/me.controller.ts`, `src/db/schema/auth.ts` (generated by `pnpm exec auth generate`
  then reviewed), `src/db/schema/otp-send-log.ts`
- Modify: `src/main.ts` (`bodyParser: false`), `src/app.module.ts`, `src/trails/trails.controller.ts`
  (`@AllowAnonymous()`), `src/health/health.controller.ts` (`@AllowAnonymous()`),
  `src/db/schema/trails.ts` (FK `author_id → user.id`)
- Create: migrations `0002_auth.sql` (generated), `0003_otp_send_log.sql`
- Test: `test/auth-otp.int.spec.ts`, `test/auth-throttle.int.spec.ts`, `test/auth-guard.int.spec.ts`,
  `test/auth-google.int.spec.ts`, `test/auth-logging.int.spec.ts`

**Task B2.1 — Better Auth instance**

`src/auth/auth.ts` builds the instance with a factory so tests inject the mailer and the clock:

```ts
export function createAuth(deps: { db: Db; env: Env; mailer: Mailer; throttle: OtpThrottle }) {
  return betterAuth({
    basePath: '/api/auth',
    baseURL: deps.env.BETTER_AUTH_URL,
    secret: deps.env.BETTER_AUTH_SECRET,
    trustedOrigins: [deps.env.WEB_ORIGIN],
    database: drizzleAdapter(deps.db, { provider: 'pg', schema: authSchema }),
    user: { additionalFields: { role: { type: 'string', defaultValue: 'rider', input: false } } },
    socialProviders: {
      google: { clientId: deps.env.GOOGLE_CLIENT_ID, clientSecret: deps.env.GOOGLE_CLIENT_SECRET },
    },
    account: { accountLinking: { enabled: false } }, // see open question 1
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      useSecureCookies: deps.env.NODE_ENV === 'production',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    hooks: { before: otpThrottleHook(deps.throttle) },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        resendStrategy: 'rotate',
        sendVerificationOTP: ({ email, otp }) => deps.mailer.sendOtp(email, otp),
      }),
    ],
  });
}
```

`input: false` on `role` means a client cannot set its own role at sign-up.

**Task B2.2 — throttle (cooldown + global cap)**

Table `otp_send_log (id bigserial, email_hash text not null, created_at timestamptz default now())`,
index on `(email_hash, created_at)` and on `(created_at)`. `email_hash` = HMAC-SHA256 of the
lower-cased, trimmed email with `OTP_HMAC_SECRET` (no plaintext emails in the log).

`OtpThrottle.tryAcquire(email, now)` in one transaction with
`pg_advisory_xact_lock(hashtext('otp_send'))`:
1. global count in the last 24 h ≥ 50 → `{ allowed: false }`;
2. a row for this `email_hash` in the last 60 s → `{ allowed: false }`;
3. else insert a row → `{ allowed: true }`.

The advisory lock makes the check-and-insert atomic under concurrent requests (two parallel sends
for one address cannot both pass the cooldown).

`otpThrottleHook`: `createAuthMiddleware` that matches path `/email-otp/send-verification-otp`,
calls `tryAcquire`, and when not allowed returns **the same status and JSON body that a real send
returns**. The exact success shape is captured from the real endpoint in a test (not hard-coded
from memory).

Tests `auth-throttle.int.spec.ts` (clock injected):
- first send for `a@x.pe` → mailer called once.
- second send for `a@x.pe` 59 s later → mailer **not** called; status + body equal to the first
  response (deep-equal on body, equal status, same `content-type`).
- send for `a@x.pe` 61 s later → mailer called.
- send for `b@x.pe` 1 s after `a@x.pe` → mailer called (cooldown is per address).
- `A@X.pe ` (case + space) right after `a@x.pe` → blocked (normalization).
- 50 sends to 50 addresses → all mailed; the 51st (new address) → not mailed, success-shaped.
- after 24 h + 1 s the cap frees one slot.
- 10 concurrent sends for one address → the mailer is called exactly once.
- `otp_send_log` contains no plaintext email (select all, assert no row contains `@`).
- **Mutations:** remove the cooldown branch; remove the cap branch; remove the advisory lock (the
  concurrency test must go red — run it 20 times in a loop to make the race visible); store the
  raw email instead of the HMAC.

**Task B2.3 — OTP verification rules**

Tests `auth-otp.int.spec.ts` (mailer fake captures the code; clock injected):
- correct code within 10 min → session cookie set (`HttpOnly`, `SameSite=Lax`).
- correct code at 10 min + 1 s → rejected.
- 5 wrong codes then the correct one → rejected (attempts exhausted); 4 wrong then correct →
  accepted.
- the code in the DB is not the plaintext (`storeOTP: 'hashed'`): read the `verification` row,
  assert the stored value ≠ the mailed code.
- a new send rotates the code: the old code is rejected after a resend.
- **Mutations:** `expiresIn: 6000`; `allowedAttempts: 50`; `storeOTP: 'plain'`.

**Task B2.4 — Google keyed on `sub`, no silent linking**

Test `auth-google.int.spec.ts` with Google's token/userinfo endpoints stubbed at the HTTP layer
(`undici` `MockAgent`), never by mocking Better Auth internals:
- first Google sign-in with `sub=G1, email=r@x.pe` → user created, `account.accountId = 'G1'`.
- second sign-in, same `sub`, **changed email** → same user (keyed on `sub`).
- an email-code user `r2@x.pe` exists; Google sign-in with `sub=G2, email=r2@x.pe` → **does not**
  attach to that user (linking off) — assert the result follows the plan-gate answer to question 1.
- **Mutation:** enable `accountLinking` → the linking test goes red.

**Task B2.5 — guard and `/api/me`**

`GET /api/me` (protected) → `{ id, email, name, role }`.
Tests `auth-guard.int.spec.ts`:
- `/api/me` without a cookie → 401; with a valid session → 200.
- `/api/trails` and `/api/health` without a cookie → 200 (anonymous allowed).
- a revoked session (delete the `session` row) → 401.
- a sign-up body that sends `role: 'admin'` → the created user has role `rider`.
- **Mutations:** remove `@AllowAnonymous()` from trails → its test goes red; set `role.input: true`
  → the role test goes red.

**Task B2.6 — never log codes or tokens**

`Mailer` wraps Resend; on failure it logs `{ event: 'otp_send_failed', emailHash }` only.
Test `auth-logging.int.spec.ts`: capture Nest logger + `console` during a send, a failed send
(Resend stub returns 500) and a verify; assert no captured line contains the code, the session
token, or the plaintext email. **Mutation:** add `logger.log(otp)` in the mailer → red.

**Done when:** all B2 tests green, every mutation recorded, Codex cross-vendor review closed.

---

## B3a — API contract + web trail list — worktree `wt-web` (parallel with B2)

**Files:**
- Create: `apps/api/src/openapi.ts` (builds the document without starting the server),
  `apps/api/scripts/emit-openapi.ts` → writes `packages/api-client/openapi.json`
- Create: `packages/api-client/{package.json,src/index.ts,src/schema.d.ts (generated)}`
- Create: `apps/web/**` (Next.js 16, App Router, `src/app/page.tsx`, `src/lib/api.ts`,
  `src/lib/labels.ts`, `next.config.ts` with `rewrites` `/api/:path*` → `API_INTERNAL_URL` for
  local dev only)
- Test: `packages/api-client/test/contract.spec.ts`, `apps/web/src/lib/labels.test.ts`,
  `apps/web/e2e/home.spec.ts`
- Modify: `.github/workflows/ci.yml` (add the stale-client check and Playwright job) — **B0 owns CI;
  B3a adds two jobs only, in a separate commit, so the merge is trivial.**

**Task B3a.1 — emit the contract.** DTO classes carry `@ApiProperty`. `emit-openapi.ts` creates the
Nest app with `NestFactory.create(AppModule, { logger: false, preview: true })`, builds the Swagger
document, writes `openapi.json` with sorted keys. `pnpm --filter api openapi` runs it.
`pnpm --filter api-client generate` runs `openapi-typescript openapi.json -o src/schema.d.ts`.

CI check: run both, then `git diff --exit-code packages/api-client` → fails when the committed
client is stale.

**Task B3a.2 — typed client.** `packages/api-client/src/index.ts` exports
`createApiClient(baseUrl, init?)` built on `openapi-fetch` with `paths` from `schema.d.ts`.
Test `contract.spec.ts`: type-level test (`expectTypeOf`) that `GET /api/trails` returns
`TrailSummary[]` and that `city` only accepts the three cities.

**Task B3a.3 — home page.** Server component calls `GET /api/trails` through the client with
`API_INTERNAL_URL` (server side). Renders name, city, Spanish difficulty label. Empty state:
"Aún no hay senderos publicados.". `labels.ts` maps enum slugs to Spanish; test every slug maps to a
non-empty label and an unknown slug throws.

**Task B3a.4 — e2e smoke.** Playwright starts API + web against the test DB seeded with 2
published + 1 draft trail; asserts the 2 names are visible and the draft name is not.
**Mutation:** remove the published filter in the API → the e2e goes red.

**Done when:** the stale-client check fails on a deliberate DTO change and passes after
regeneration; e2e green.

---

## B3b — Web sign-in UI (after B2 and B3a merge)

**Files:** `apps/web/src/app/ingresar/page.tsx`, `src/lib/auth-client.ts` (Better Auth React
client with `emailOTPClient()`, `baseURL` = same origin), `src/components/sign-in/*`,
`apps/web/e2e/sign-in.spec.ts`.

Flow: email field → "Enviar código" → 6-digit input → signed in → header shows the email from
`/api/me`. "Continuar con Google" button. Error copy is generic ("Código inválido o vencido.") and
never says whether the email exists.

e2e (API in test mode with the capturing mailer exposed only when `NODE_ENV=test` through a
test-only module that is **not registered** in production — a test asserts the module is absent
from the production `AppModule` graph):
- email code sign-in end to end → header shows the email.
- wrong code 5 times → generic error, then the right code is still rejected.

---

## B4 — Deploy to staging (Coolify) — infra, blast radius

**Files:** `apps/api/Dockerfile`, `apps/web/Dockerfile` (multi-stage, `node:24-alpine`,
`pnpm deploy --filter <app> --prod`), `.dockerignore` (excludes `.git`, `node_modules`, `**/.env*`,
`CLAUDE.md`, `AGENTS.md`, `.claude/`, docs), `.github/workflows/deploy-staging.yml`,
`docs/operations/deploy.md`.

Steps:
1. Coolify: new project `ciudad-enduro-oss`, PostGIS 17-3.5 database (Docker network only), app
   `api` and app `web` from the repo (deploy key, read-only), host `enduro-next.vops.pe`.
2. Traefik labels: `web` router `Host(enduro-next.vops.pe)`; `api` router
   `Host(enduro-next.vops.pe) && PathPrefix(/api)` with higher priority. Both carry the existing
   Cloudflare `ipAllowList` middleware.
3. DNS: `enduro-next` proxied (orange cloud) in Cloudflare.
4. `deploy-staging.yml`: on push to `main` after CI green → SSH tunnel to the DB → `pnpm --filter api
   db:migrate` (host guard: refuse any host but the tunnel) → trigger both Coolify deploys → poll
   to `finished` → verify: `GET https://enduro-next.vops.pe/api/health` = 200, direct origin with
   `--resolve` = 403 for both routers.
5. Secrets: only `VOPS_INFRA_SSH_KEY` in GitHub; app env in Coolify; DB URL + Coolify token in
   `/root/.secrets/ciudad-enduro-oss.env` on the box (600).

**Done when (Phase 0 exit):**
- `https://enduro-next.vops.pe` lists trails from the API; email-code sign-in works with a real
  Resend email; Google sign-in works for a test user.
- Origin lock: public 200, direct origin 403, on both routers.
- `docker image inspect` / a file listing of both images shows no `CLAUDE.md`, `.claude/`, `.env`.
- Self-cleaning live check: create a test user through the real flow, assert the DB rows, delete
  them, assert zero residual rows (`user`, `session`, `verification`, `otp_send_log`).

---

## 3. Review plan

| Stage | Reviewer | Effort |
|-------|----------|--------|
| This plan (gate) | opus design validator ∥ gpt-6.1-sol cross-vendor | high ∥ high |
| B0, B1 | opus spec + security/quality, then final | high, final xhigh |
| B2 | opus spec + security/quality, **Codex**, final | high, Codex high, final xhigh |
| B3a, B3b | one review with mutation proof | xhigh (final) |
| B4 | opus + **Codex**, final | high, Codex high, final xhigh |

Reviewer prompt includes: "Do not trust the report. Read the code, run the scoped tests, mutate
where you doubt a test, restore. Then try to break one contract nobody tried; three attempts. A
plain pass is acceptable."
