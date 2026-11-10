# Changelog

## [Unreleased] - 2026-11-10

### Added
- Phase 0 foundation design: stack decisions, layout, schema, API, carried-over security rules (`docs/architecture/phase-0-foundation.md`).
- Repository scaffold: README, MIT license, `.gitignore` that keeps AI-assistant files out of the public repo.
- Monorepo skeleton: pnpm 12.18.0 workspace, Turborepo 2.11.10, TypeScript 6.0.3, Node 24; shared tsconfig base and ESLint flat config in `packages/config`.
- Local PostGIS 17-3.5 dev database (`docker-compose.dev.yml`, host port 5434) started with `pnpm db:up`.
- CI workflow (`.github/workflows/ci.yml`): install, lint, typecheck, test against a PostGIS service, build.
