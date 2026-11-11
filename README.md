# Ciudad Enduro

Open-source platform to discover and share urban MTB / enduro trails in Peru (Chimbote, Nuevo Chimbote, Trujillo).

**Read [docs/progress.md](docs/progress.md) first:** what works, what is in flight, what waits on a decision.

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
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret of the widget for this host (see Turnstile below) |

`BETTER_AUTH_URL` and `WEB_ORIGIN` must be bare origins (`https://enduro-next.vops.pe`, no path
and no trailing slash). Production refuses example and `dev-`/`test-` secrets, `http://` values for
those two, any `BETTER_AUTH_TRUSTED_ORIGINS`, and Cloudflare's Turnstile test secrets
(`1x`/`2x`/`3x…AA`). Auth request bodies are limited to 16 KiB. The client IP comes from `cf-connecting-ip`
only (Cloudflare sets it), so rate limits are per client behind the proxy.

#### Turnstile (e-mail code send)

`POST /api/auth/email-otp/send-verification-otp` needs a Cloudflare Turnstile token in the
`x-captcha-response` header (Better Auth `captcha` plugin, this path only). The API accepts a token
only for the hostname of `WEB_ORIGIN` and the action `send_code`, and each token once. A missing
token gets 400 `MISSING_RESPONSE`, a refused one 403 `VERIFICATION_FAILED`; when siteverify is
unreachable (10 s timeout) the API answers 500 `UNKNOWN_ERROR` and sends nothing. The check runs
before the CSRF check and the throttle, so a refused send uses no cooldown slot and no cap row.
No environment variable turns the check off or points it at another siteverify URL.

Use one widget per host (`enduro-next.vops.pe`, `enduro.vops.pe`): the API secret is
`TURNSTILE_SECRET_KEY`, the web site key is `TURNSTILE_SITE_KEY`. The `.env.example` files hold
Cloudflare's always-pass test keys. Cloudflare reports hostname `example.com` and no action for
their tokens, so the local API refuses them: to send a code locally, create a separate dev widget,
add `localhost` to it under Hostname Management
([Cloudflare docs](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/);
Cloudflare advises separate widgets per environment and no local hostnames on production keys,
[testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)), and put its keys in
`apps/api/.env` and `apps/web/.env.local`. Google sign-in needs no token.

The API sends the client IP (`cf-connecting-ip`) to siteverify as `remoteip`, IPv6 as the full
address: Cloudflare defines it as
["the visitor's IP address"](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
Only Better Auth's per-IP rate limiter groups IPv6 by /64. In local development the request has no
`cf-connecting-ip`, so Better Auth falls back to `127.0.0.1` (`@better-auth/core` `utils/ip.mjs:217`)
and sends that as `remoteip`.

`/ingresar` must stay a full page load (a plain `<a href>`, not `next/link`): `next/script` does not
retry a failed `api.js` load on a client-side re-mount (plan §7, A11 follow-up).

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
stubbed with undici `MockAgent`. Captcha tokens are checked against a local siteverify stub
(`test/support/turnstile-stub.ts`, injected through the `TURNSTILE_SITEVERIFY_URL` provider); it
accepts `stub~<action>~<hostname>~<nonce>` once and refuses a token it has seen. Each request
sends its own `cf-connecting-ip`, because Better Auth's in-memory rate limiter is shared by every
app in the process.

### API client (`packages/api-client`)

The typed client is generated from the API contract. After an API change:

```bash
pnpm --filter api openapi:emit           # write packages/api-client/openapi.json
pnpm --filter api-client generate        # write packages/api-client/src/schema.d.ts
```

Commit both files. CI fails when they differ from what the API emits.

### Web (`apps/web`)

```bash
cp apps/web/.env.example apps/web/.env.local   # API_INTERNAL_URL, TURNSTILE_SITE_KEY
pnpm --filter api-client build                 # the web imports its runtime from dist/
pnpm --filter api dev                          # the web reads trails from the API
pnpm --filter web dev                          # http://localhost:3000
```

`pnpm dev` from the root builds `api-client` first (the `dev` task depends on `^build`).
In development, `next dev` rewrites `/api/*` to the API. In production Traefik routes `/api`.

Pages: `/` (trail list) and `/ingresar` (sign-in by e-mail code or Google). `/ingresar` reads
`TURNSTILE_SITE_KEY` per request (not `NEXT_PUBLIC_`, so one image serves every host) and fails
without it. The Turnstile widget stays mounted for both steps; every send, "Enviar otro código"
and a retry included, uses a new token, and the widget resets after each send. The web calls the auth
API with `fetch()` on the same origin and must not set `Referrer-Policy: no-referrer` (some browsers
then send `Origin: null`, which the API refuses).

For the sign-in e2e, `apps/api/test/support/e2e-main.ts` starts the API with OTP codes written to
`E2E_CODES_FILE` (one JSON line per mail) instead of Resend. It refuses to run unless
`NODE_ENV=test`.

E2E tests (Playwright) start the e2e API from source on port 3101, the web production build on
port 3102, and a front proxy on port 3100 that routes `/api` to the API and the rest to the web,
like Traefik. The browser uses port 3100 only. Ports 3103 and 3104 hold a second web server and an
API that never answers, for the error-page test. The tests read OTP codes from the file in
`e2e/codes.ts` and send their own `cf-connecting-ip` per auth request. `e2e/turnstile.ts` routes
Cloudflare's widget script to a stub widget, and the e2e API checks its tokens against the
in-process siteverify stub, so the suite never calls Cloudflare. They recreate and seed
`ciudad_enduro_test_<TEST_DB_SUFFIX>` on localhost.

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

## Deploy

Pushes to `main` deploy to staging at https://enduro-next.vops.pe. See [docs/operations/deploy.md](docs/operations/deploy.md).

## License

MIT
