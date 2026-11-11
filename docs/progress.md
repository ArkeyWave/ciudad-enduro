# Progress

Last updated: 2026-11-10

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

## This week

- **P1a-1** CI-built images on GHCR with attestations, staging deploys by digest — PR #7, issue #9.
  CI green, refusal proofs done. Next: review chain (opus @ high ∥ gpt-6.1-sol @ high → final
  opus @ xhigh), then the A5 switch with a merge freeze.

## Next

- **P1a-3** production apps and the cutover of `enduro.vops.pe` — issue #10. Starts after P1a-1.
- **Phase 1b** (each needs a plan and a gate first): trails & geo (#11), media & GPX (#12),
  UI redesign (#13).
- Phase 0 follow-ups: early OAuth errors → `onAPIError.errorURL`; a "back" action on the code step;
  Cloudflare Email Obfuscation on the staging host.

## Open decisions

| Decision | Owner | Blocks |
|----------|-------|--------|
| Cloudflare R2 bucket + S3 keys for the off-box prod DB backup (A8) | owner | P1a-3 |
| Publish the Google consent screen (now in Testing) | owner | public Google sign-in |
| Session tokens stored unhashed (Better Auth has no option) — accepted, revisit on upgrade | — | — |
| Global OTP cap can be exhausted; Turnstile reduces it, no per-IP daily share (CGNAT) — accepted 2026-11-10 | — | — |
