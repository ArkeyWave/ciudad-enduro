# Phase 1a — CI-built images, OTP abuse protection, production cutover — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (inside the
> orchestrated-delivery loop) to implement this plan batch by batch.

**Goal:** Production runs the new app at `https://enduro.vops.pe` from images that CI built and checked,
deployed by digest, with bot protection on the e-mail code path; staging keeps running at
`https://enduro-next.vops.pe` the same way. No repo code runs on the shared VPS.

**Owner decisions (2026-11-10):**
1. Build images in CI, push to GHCR, deploy by digest (closes ledger B3-F1).
2. Global OTP cap exhaustion: avoid a per-IP daily share if possible (CGNAT in Peru). → Cloudflare
   Turnstile on the send-code endpoint (P1a-2). A per-IP daily share is NOT added.
3. Google consent screen stays in Testing until the owner publishes it (outside this plan).
4. Production host = `enduro.vops.pe`. The new app replaces the old private app there (no real users,
   nothing to migrate). The production DB `ciudad-enduro-oss-postgres` (`k9ysrxe4vuaqge54kkqivfpa`) gets
   wired to the production api.

**Verified facts (2026-11-10):**
- `better-auth@1.7.18` ships `plugins/captcha` with provider `cloudflare-turnstile` and an `endpoints`
  option (`dist/plugins/captcha/constants.d.mts:3`, `types.d.mts:10,77`). The token travels in the
  `x-captcha-response` header (to be confirmed against the source in P1a-2.1).
- Coolify 4.7.3 on vops-infra supports the `dockerimage` build pack (not used on the box yet; all apps
  are `dockerfile`).
- The repo is public, so GHCR packages can be public: the box pulls without registry credentials.
- Current deploy chain: CI `deploy-staging` → forced-command key → `/usr/local/bin/ce-oss-deploy <sha>`
  → Coolify builds from git on the box (`--network host`). Old prod app on enduro.vops.pe is Coolify app
  `ugh9axr8jcdphc5wez3xmg5w` (old repo, CI deploy key retired today).

**Open questions for the plan gate:**
1. Deploy by digest: `image@sha256:…` in the Coolify `dockerimage` app, or `image:<git-sha>` plus a
   digest check after pull? Which one can Coolify 4.7.3 actually express, and which one stops a
   re-tagged image?
2. Can `ce-oss-deploy` keep the same security contract (only a SHA on main, rollback guard, revision
   check, origin-lock check, stop on failure) when it no longer builds, and how does it learn the digest
   for a SHA without trusting the caller? (Proposal: CI writes the digest into an OCI label/annotation
   and the script reads the digest from GHCR by tag `sha-<sha>` and checks the image's
   `org.opencontainers.image.revision` label equals the SHA.)
3. Turnstile: does the captcha plugin run before our `hooks.before` throttle (so a bot burns no slot)?
   Does a missing/invalid token still return a response that does not reveal account existence?
   How do the e2e tests run without Cloudflare (Turnstile test keys `1x00000000000000000000AA` always
   pass, `2x00000000000000000000AB` always fail)?
4. Production cutover order: how to switch enduro.vops.pe from the old app to the new one with no window
   where the host is served without the origin lock, and with a rollback path.
5. Production deploys: manual `workflow_dispatch` on main with a typed confirmation (as the old Layer 3)
   or automatic after staging is green? (Proposal: manual, migration-first is already in the entrypoint.)

---

## Batches

```
P1a-1 CI images → GHCR, staging deploys by digest ──► P1a-3 production apps + cutover
P1a-2 Turnstile on send-code (parallel worktree with P1a-1) ─┘
```

| Batch | Rung | Owns | Parallel |
|-------|------|------|----------|
| P1a-1 CI images on GHCR + digest deploy (staging) | Full + Codex (infra, shared box) | `.github/workflows/ci.yml` image + deploy jobs, `docs/operations/**`, box `ce-oss-deploy`, Coolify staging apps | yes, with P1a-2 |
| P1a-2 Turnstile on the send-code path | Full + Codex (auth) | `apps/api/src/auth/**`, `apps/web/src/app/ingresar/**`, `apps/web/src/lib/auth-client.ts`, e2e | yes, with P1a-1 |
| P1a-3 Production apps + cutover of enduro.vops.pe | Full + Codex (prod, blast radius) | Coolify prod apps, `deploy-production` workflow, `docs/operations/**`, box | no (needs P1a-1 and P1a-2) |

Load rules (unchanged, see memory feedback-local-load-bsod): one heavy local job at a time; P1a-1 runs no
local builds (CI builds); only P1a-2 runs local tests.

---

## P1a-1 — CI images on GHCR, staging deploys by digest

1. **Build + push in CI.** The `images` job (already builds and runs `verify-image.sh` + canary + smoke)
   gains, on push to `main` only: `docker login ghcr.io` with `GITHUB_TOKEN` (`permissions: packages:
   write` on that job only), push `ghcr.io/arkeywave/ciudad-enduro-api:sha-<sha>` and `…-web:sha-<sha>`,
   with OCI labels `org.opencontainers.image.revision=<sha>` and `…source=<repo>`. PR runs build and
   verify but never push. Record the pushed digests as job outputs.
2. **The checked image is the shipped image.** Push the exact image that passed verify-image + smoke
   (no rebuild between check and push). Test: the digest pushed equals the digest of the image that the
   verify step inspected (both printed; a step compares them).
3. **Package visibility:** both GHCR packages public (the box pulls anonymously). No registry secret on
   the box.
4. **Coolify staging apps → `dockerimage` build pack** pointing at the GHCR repo. Labels (custom,
   read-only regeneration off) and runtime env unchanged. Turn off every git-related setting.
5. **`ce-oss-deploy` v2** (forced command unchanged; reinstall with review, verifier-style "installed copy"
   rule kept for any script it runs):
   - input: 40-hex SHA, ancestor-of-main check, rollback guard (unchanged);
   - resolve `sha-<sha>` in GHCR → digest (anonymous registry API); refuse if missing;
   - `docker pull <repo>@<digest>`; refuse unless the image label `revision == <sha>`;
   - run `/usr/local/lib/ce-oss/verify-image.sh` on the pulled image BEFORE deploy;
   - set the Coolify app image to `<repo>@<digest>` (or tag + digest check — gate question 1), deploy
     api then web, each checked right after its deploy (running image digest == expected);
   - revision + home + origin-lock checks (unchanged); stop on failure (unchanged).
6. **Remove the git build path:** Coolify no longer clones the repo; `--network host` builds stop for
   this project. Docs: deploy.md "what runs where" updated; ledger B3-F1 closed.

**Done when:** a push to main deploys staging from GHCR by digest; the box never clones/builds the repo
(Coolify deployment logs show a pull, no `docker build`); all existing live checks still pass; refusal
proofs: unknown SHA, missing tag, label mismatch, tampered tag (digest differs) — each refused with the
app left on the previous image.

## P1a-2 — Cloudflare Turnstile on the send-code path

1. **API:** Better Auth `captcha` plugin, provider `cloudflare-turnstile`, `endpoints:
   ['/email-otp/send-verification-otp']` only (sign-in with a code is already capped at 5 attempts and
   per-IP limited). Secret `TURNSTILE_SECRET_KEY` (env, required in production, test key allowed only
   outside production — same pattern as B1.12).
2. **Ordering:** prove the captcha check runs before our throttle hook — a request without a valid token
   uses no cooldown slot and no cap row (test: 0 rows in `otp_send_log`). If the plugin runs after
   `hooks.before`, STOP and ASK.
3. **No account oracle:** the captcha failure response is identical for existing and new addresses.
4. **Web:** Turnstile widget on `/ingresar` step 1 (site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, managed
   mode, Spanish), token sent in `x-captcha-response`. Spanish message on failure: "No pudimos verificar
   que eres una persona. Intenta de nuevo." CSP/Referrer constraints from B5 unchanged.
5. **Tests:** unit + e2e with the Turnstile test keys (always-pass / always-fail); both sides; mutation
   proofs (remove the plugin → the no-token test goes red; widen `endpoints` to all paths → the sign-in
   e2e goes red because sign-in has no token).
6. **Operator:** create the Turnstile widget for `enduro.vops.pe` and `enduro-next.vops.pe` in Cloudflare
   (owner or orchestrator with a token that has Turnstile edit), keys into `~/.secrets/ciudad-enduro-oss.env`
   and the Coolify runtime env.

**Done when:** staging refuses a send without a valid token (live curl → refused, 0 rows), a browser send
works, CI green, mutation table complete. Plan §8 cap-exhaustion entry updated: Turnstile is the control;
no per-IP daily share.

## P1a-3 — Production apps and the cutover of enduro.vops.pe

1. **Coolify prod apps** `ce-oss-api-prod`, `ce-oss-web-prod` in the `production` environment of project
   `ciudad-enduro-oss`, `dockerimage` build pack, the prod DB (`k9ysrxe4vuaqge54kkqivfpa`), runtime-only
   secrets generated on the box (new values, not staging's), `BETTER_AUTH_URL = WEB_ORIGIN =
   https://enduro.vops.pe`, Google client (same client; add the prod redirect URI — owner), Resend key,
   Turnstile prod keys. Custom labels with `cloudflare-only@file`, label regeneration off, no domain field.
2. **Production deploy:** `.github/workflows/deploy-production.yml`, `workflow_dispatch` on `main` only,
   typed confirmation `DEPLOY-PROD`, GitHub Environment `production` (main only, holds a SECOND forced-command
   key bound to `ce-oss-deploy-prod`, or one script with a fixed target per key — gate question), refuses
   unless the SHA already deployed green to staging. Same checks as staging (digest, label, verifier,
   revision, origin lock, rollback guard).
3. **Cutover** (gate question 4; proposal):
   a. deploy the new prod apps with routers on a temporary internal host only (not public), verify by
      `curl --resolve` through Traefik with the origin lock;
   b. in one Coolify/Traefik change, move `Host(enduro.vops.pe)` from the old app's labels to the new
      apps' labels (old app stopped in the same step); verify public 200 + direct 403 within a minute;
   c. rollback = start the old app and restore its labels (kept, not deleted, for 7 days);
   d. after 7 days with no rollback: delete the old Coolify app, its old staging app/DB clone, and the
      old repo's remaining deploy workflows.
4. **Live checks on production** (same list as Phase 0 §11, with a new test address; self-cleaning).

**Done when:** https://enduro.vops.pe serves the new app from GHCR by digest; production live checks pass;
the old app is stopped with a documented rollback; the production deploy is manual and gated.

---

## Review plan

| Stage | Reviewers |
|-------|-----------|
| This plan (gate) | opus 5.5 @ high ∥ gpt-6.1-sol @ high, then final claude-fable-5.2 @ high (owner's Phase 0 choice) |
| P1a-1, P1a-3 | opus @ high + gpt-6.1-sol @ high → fixes → final opus @ xhigh |
| P1a-2 | opus @ high + gpt-6.1-sol @ high → fixes → final opus @ xhigh |
