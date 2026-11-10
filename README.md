# Ciudad Enduro

Open-source platform to discover and share urban MTB / enduro trails in Peru (Chimbote, Nuevo Chimbote, Trujillo).

## Stack

- **API:** NestJS + PostgreSQL / PostGIS
- **Web:** Next.js
- **CMS:** Payload CMS (editorial content only)
- **Auth:** Better Auth (email code + Google)
- **Storage:** Cloudflare R2
- **Email:** Resend
- **Hosting:** Coolify (self-hosted)

## Development

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- pnpm 12.18.0: run `corepack enable`, and corepack uses the version in `package.json`
- Docker (for the local PostGIS database)

### Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up        # PostGIS 17-3.5 on localhost:5434, database ciudad_enduro
```

### API (`apps/api`)

```bash
cp apps/api/.env.example apps/api/.env   # the API loads this file itself
pnpm --filter api db:migrate             # apply migrations to the dev database
pnpm --filter api dev                    # http://localhost:3001/api/health
pnpm --filter api openapi:emit           # write packages/api-client/openapi.json
```

Endpoints: `GET /api/health`, `GET /api/trails?city=`, `GET /api/trails/:slug`, `GET /api/me`
(needs a session), and Better Auth under `/api/auth/*` (allowlist in `src/auth/auth-paths.ts`).

#### Auth environment (`apps/api/.env`)

| Variable | Use |
|----------|-----|
| `BETTER_AUTH_SECRET` | Signs cookies and state; 32+ characters |
| `BETTER_AUTH_URL` | Public base URL; `https://` turns on `Secure` and `__Secure-` cookies |
| `WEB_ORIGIN` | The only trusted origin (CSRF, callback URLs) |
| `OTP_HMAC_SECRET` | HMAC key for stored OTP codes and the throttle's address hashes; 32+ characters |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sender of the OTP mails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client; redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google` |

Production refuses example and `dev-`/`test-` secrets. The client IP comes from `cf-connecting-ip`
only (Cloudflare sets it), so rate limits are per client behind the proxy.

After a Better Auth upgrade, regenerate the auth tables and review the diff:

```bash
cd apps/api
npx auth generate --config scripts/auth-cli.ts --output src/db/schema/auth.ts
pnpm db:generate
```

API tests need the dev database (`pnpm db:up`). The test setup creates and migrates
`ciudad_enduro_test_<TEST_DB_SUFFIX>` (default `main`) on `localhost` or `127.0.0.1` only. Use a
different `TEST_DB_SUFFIX` per worktree.

```bash
pnpm --filter api test                                   # all API tests
pnpm --filter api exec vitest run test/env.spec.ts -t "production"   # one file, one test
TEST_DB_SUFFIX=<worktree> pnpm --filter api exec vitest run test/auth/   # the auth suite
```

The auth tests (`apps/api/test/auth/`) run the real API on the test database. Mail goes to a
capturing transport (`test/support/capture-mailer.ts`); Google's token endpoint and Resend are
stubbed with undici `MockAgent`. Each request sends its own `cf-connecting-ip`, because Better
Auth's in-memory rate limiter is shared by every app in the process.

### API client (`packages/api-client`)

The typed client is generated from the API contract. After an API change:

```bash
pnpm --filter api openapi:emit           # write packages/api-client/openapi.json
pnpm --filter api-client generate        # write packages/api-client/src/schema.d.ts
```

Commit both files. CI fails when they differ from what the API emits.

### Web (`apps/web`)

```bash
cp apps/web/.env.example apps/web/.env.local   # API_INTERNAL_URL=http://localhost:3001
pnpm --filter api-client build                 # the web imports its runtime from dist/
pnpm --filter api dev                          # the web reads trails from the API
pnpm --filter web dev                          # http://localhost:3000
```

`pnpm dev` from the root builds `api-client` first (the `dev` task depends on `^build`).
In development, `next dev` rewrites `/api/*` to the API. In production Traefik routes `/api`.

For the sign-in e2e, `apps/api/test/support/e2e-main.ts` starts the API with OTP codes written to
`E2E_CODES_FILE` (one JSON line per mail) instead of Resend. It refuses to run unless
`NODE_ENV=test`.

E2E tests (Playwright) start the API from source on port 3101 and the web production build on
port 3100. They recreate and seed `ciudad_enduro_test_<TEST_DB_SUFFIX>` on localhost.

```bash
pnpm --filter web exec playwright install chromium   # once
pnpm turbo run build --filter=web                    # e2e serves the production build
TEST_DB_SUFFIX=<worktree> pnpm --filter web test:e2e
```

### Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Package contract

Every package under `apps/` and `packages/` defines the scripts `lint`, `typecheck`, `test` and
`build`. Turbo silently skips a package that lacks one, so a missing script means a missing gate.
A package that lints lists `eslint` and `typescript` in its own `devDependencies` (the shared
config in `@ciudad-enduro/config` does not link their binaries into other packages).

## License

MIT
