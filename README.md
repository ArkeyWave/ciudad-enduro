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

### Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
