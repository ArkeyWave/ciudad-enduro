# Progress

Last updated: 2026-11-11

Read this file first. It tells you what works, what is in flight and what waits on a decision.
Capabilities and their proofs are in [features.json](features.json). The backlog is in
[GitHub Issues](https://github.com/ArkeyWave/ciudad-enduro/issues) and on the
[project board](https://github.com/users/ArkeyWave/projects/1). Feature ideas and votes are in
[Discussions → Ideas](https://github.com/ArkeyWave/ciudad-enduro/discussions/categories/ideas).

## Done

**Phase 0 — foundation (2026-11-10).** Plan: [phase-0-foundation](plans/2026-11-10-phase-0-foundation.md) §11.

- Monorepo, CI gates `check`, `contract`, `e2e`, `images` (#1).
- API core: env, PostGIS database, trails endpoints, OpenAPI contract (#2).
- Typed api-client and the web trail list (#3).
- Staging deploy from CI to https://enduro-next.vops.pe (#4).
- Auth: Better Auth with e-mail code and Google, OTP throttle, per-IP limit, guard (#5).
- Sign-in UI, session header, Spanish error page (#6).
- Live checks with the owner: all passed, 0 residual rows (plan §11).

**Phase 1a — partial.** Plan: [phase-1a-production](plans/2026-11-10-phase-1a-production.md) (§7 binding).

- P1a-2: Cloudflare Turnstile on the e-mail code send (#8). Staging live checks (A7) passed on PC and
  phone (IPv6), 0 residual rows.
- `main` protected by the ruleset `protect-main` (PR + required checks, no force push) (A6).
- P1a-1: CI-built images on GHCR with build attestations; staging deploys by digest through
  `ce-oss-deploy` (#7, A5 switch done).
- P1a-3 part 1: production apps prepared (not deployed), `ce-oss-deploy` v3 with the `production`
  target, the `Deploy production` workflow with the owner as required reviewer (#21; v3 installed on
  the box 2026-11-11).

**Phase 1b-min — GPX trails on staging (2026-11-11).** Plan: [phase-1b-min-gpx-trails](plans/2026-11-11-phase-1b-min-gpx-trails.md).

- Admin GPX import, draft/publish, distance, gain/loss and elevation profile (#19).
- Trail page with the Leaflet map and the elevation profile; `/rutas/nueva` upload (#20).
- The header fits a 390 px phone screen (#45).
- Agent gates: named agents, review rubric, the L2 guard hook that blocks pushes to `main` and agent
  production dispatch (plan [agents-gates-ux-standard](plans/2026-11-10-agents-gates-ux-standard.md)).

## This week

- **Production:** `enduro.vops.pe` runs the new app since 2026-11-11 (cutover with a rehearsed
  rollback, daily on-box DB dump with a proven restore). Still open: the off-box R2 copy (A8, owner keys).
- **Rider routes + owner approval** (riders upload GPX → "En revisión" → owner publishes one by one).
- **UI redesign layer 1** (#13): the approved "Night Rider" prototype on the screens the API already
  supports (Explorar list + map, Detalle, Importar GPX, Ingresar) — PR #51; rider pages wait for PR #50.
- **Elevation calibration (D11)**: one real ride GPX with the device's distance and gain, before the
  first real trails are imported (owner rides 2026-11-15).

## Next

- Import and publish the owner's first real trails in production.
- Redesign later layers: Retos, Ranking, Perfil, Comunidad, Negocios, Grabar GPS, React Native.
- Phase 1b: media & GPX (#12), 3D trail view trial (Fable vs Opus).
- Phase 0 follow-ups: early OAuth errors → `onAPIError.errorURL`; a "back" action on the code step;
  Cloudflare Email Obfuscation on the staging host.

## Open decisions

| Decision | Owner | Blocks |
|----------|-------|--------|
| Cloudflare R2 bucket + S3 keys for the off-box prod DB backup (A8) | owner | P1a-3 |
| Publish the Google consent screen (now in Testing) | owner | public Google sign-in |
| Session tokens stored unhashed (Better Auth has no option) — accepted, revisit on upgrade | — | — |
| Global OTP cap can be exhausted; Turnstile reduces it, no per-IP daily share (CGNAT) — accepted 2026-11-10 | — | — |
