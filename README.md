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

Endpoints: `GET /api/health`, `GET /api/trails?city=`, `GET /api/trails/:slug`.

API tests need the dev database (`pnpm db:up`). The test setup creates and migrates
`ciudad_enduro_test_<TEST_DB_SUFFIX>` (default `main`) on `localhost` or `127.0.0.1` only. Use a
different `TEST_DB_SUFFIX` per worktree.

```bash
pnpm --filter api test                                   # all API tests
pnpm --filter api exec vitest run test/env.spec.ts -t "production"   # one file, one test
```

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
