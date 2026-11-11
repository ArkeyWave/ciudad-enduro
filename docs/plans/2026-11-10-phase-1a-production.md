# Phase 1a — CI-built images, OTP abuse protection, production cutover — Implementation Plan (rev. 3, gate closed)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (inside the
> orchestrated-delivery loop) to implement this plan batch by batch.

**Goal:** Production runs the new app at `https://enduro.vops.pe` from images that CI built, checked,
attested and pushed once, deployed by digest, with Turnstile on the e-mail code path; staging keeps
running at `https://enduro-next.vops.pe` the same way. **No repository build step executes on the VPS**
(application code obviously runs there).

**Owner decisions (2026-11-10):** (1) build images in CI → GHCR → deploy by digest (closes B3-F1);
(2) no per-IP daily OTP share; Cloudflare Turnstile instead; (3) Google consent screen stays in Testing
until the owner publishes it; (4) production host = `enduro.vops.pe`, replacing the old private app.

**Revision 2** applies the plan gate (opus 5.5 @ high ∥ gpt-6.1-sol @ high, both "approve with changes",
four blocking items each, the same four). Ledger in §6.

## 0. Verified facts

- **Coolify 4.7.3 deploys by digest:** set `docker_registry_image_name` = repository and
  `docker_registry_image_tag` = `sha256-<64hex>`; `generate_image_names()` turns it into
  `repo@sha256:<hex>` (`ApplicationDeploymentJob.php:845-846, 1677-1679`). Coolify **pulls again at
  deploy time** (`:1917-1920`), so a "tag + digest check" scheme is unsafe — always digest.
- The create endpoint stores a digest as name `repo@sha256` + hex tag (`ApplicationsController.php:2690-2696`):
  use one form only — plain repository name, tag `sha256-<hex>`, PATCHed on every deploy.
- Images pulled by digest are untagged; Coolify's per-app retention does not remove them
  (`CleanupDocker.php:313-318`) — slow disk growth, accepted (helps rollback).
- The box uses the **containerd snapshotter** (`io.containerd.snapshotter.v1`): image IDs differ from
  the CI runner's classic store. Compare identities with `docker image inspect <repo>@<digest>`.
- **better-auth 1.7.18 captcha plugin** (`plugins/captcha`): router order is disabledPaths → per-IP
  limiter → plugin `onRequest` (captcha) → origin middleware → our `hooks.before`
  (`dist/api/index.mjs:167-183`). A failed token therefore uses **no cooldown slot and no cap row**
  (one per-IP limiter slot, acceptable). Header `x-captcha-response` (`captcha/index.mjs:36`). Responses
  are account-independent: 400 `MISSING_RESPONSE`, 403 `VERIFICATION_FAILED`, 500 `UNKNOWN_ERROR` when
  siteverify is unreachable (**fails closed**, 10 s timeout) (`captcha/index.mjs:38-79`,
  `verify-handlers/cloudflare-turnstile.mjs:7-44`). Options `allowedHostnames`, `expectedAction`,
  `siteVerifyURLOverride` exist (`types.d.mts:11,28-39`; `index.mjs:44`).
- `NEXT_PUBLIC_*` values are inlined at `next build`; a runtime env cannot change them.
- Cloudflare Turnstile test **secrets**: `1x0000000000000000000000000000000AA` (pass),
  `2x0000000000000000000000000000000AA` (fail), `3x0000000000000000000000000000000AA` (spent); test
  secrets accept only `XXXX.DUMMY.TOKEN.XXXX`. With test keys the browser still loads `api.js` and the
  API still calls siteverify.
- The production DB `k9ysrxe4vuaqge54kkqivfpa` has **no scheduled backup** (only two other DBs do).
- The old app's stored `custom_labels` already carry `cloudflare-only@file` on both routers.
- GitHub Free allows Environment required reviewers on **public** repos.

## 1. Gate decisions

| # | Question | Decision |
|---|----------|----------|
| G1 | Digest or tag | Digest only (`sha256-<hex>` tag field). |
| G2 | Where the digest comes from | From the main-only CI deploy job, passed over the forced command (`<sha> <api-digest> <web-digest>`, strict regex). The script never resolves a tag. Plus a **GitHub artifact attestation** (build provenance) per image, verified on the box before anything runs: repo `ArkeyWave/ciudad-enduro`, signer workflow `.github/workflows/ci.yml` on `refs/heads/main`, source digest == `<sha>`. One mechanism only (no cosign). |
| G3 | Staging → production | Staging, after its live checks pass, writes a root-owned promotion record `<sha> <api-digest> <web-digest>`. Production deploys only a recorded pair; the prod forced command takes only a SHA and reads the digests from that record. |
| G4 | Production trigger | `workflow_dispatch` on `main`, GitHub Environment `production` with the owner as **required reviewer**, branch policy main only ("prevent self-review" off — single maintainer). No typed confirmation (the Environment approval is the gate). |
| G5 | Keys | One reviewed script `ce-oss-deploy`; the target is fixed per key in `authorized_keys` (`command="/usr/local/bin/ce-oss-deploy staging"` / `… production"`). The caller can never choose the target. The prod key lives only in Environment `production`. |
| G6 | Site key | Read `TURNSTILE_SITE_KEY` (no `NEXT_PUBLIC_`) in the dynamic server component of `/ingresar` and pass it as a prop. One image serves both hosts. |
| G7 | Cutover | Private check on the Docker network, then a bounded maintenance window: stop old → confirm gone → expose new with complete locked labels → verify. Rollback is the exact reverse. No "temporary internal host". |

---

## 2. Batches and order

```
P1a-1 CI images + attestations + digest deploy (staging) ─┐
                                                          ├─► P1a-3 production apps + cutover
P1a-2 Turnstile (parallel worktree)  ─────────────────────┘
```

| Batch | Rung | Owns |
|-------|------|------|
| P1a-1 | Full + Codex | `.github/workflows/ci.yml` (images/publish/deploy jobs **except** env lines owned by P1a-2), `docs/operations/**`, box `ce-oss-deploy`, Coolify staging apps |
| P1a-2 | Full + Codex | `apps/api/src/auth/**`, `apps/api/src/config/env.ts`, `apps/web/src/app/ingresar/**`, `apps/web/src/components/sign-in/**`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/auth-errors.ts`, `apps/web/e2e/**`, and **only the env lines** in `ci.yml` (smoke-run env, e2e test keys) |
| P1a-3 | Full + Codex | Coolify prod apps, `.github/workflows/deploy-production.yml`, prod backup schedule, `docs/operations/**` (after P1a-1 merged) |

**Merge order and freeze (both reviewers):** the box script v2, the Coolify switch to `dockerimage`, and
the new `ci.yml` argument format go live together. Procedure: (1) P1a-2 may merge first only after its
operator checklist (staging Turnstile keys in Coolify) is done; (2) for P1a-1, freeze merges to main,
hold the deploy flock on the box, install script v2, switch both staging apps, merge P1a-1, verify its
deploy, release the freeze. A merge during the freeze is refused by procedure (owner informed).

Load rules: one heavy local job at a time; P1a-1 builds in CI only; agents use `rg`, never `grep -r`.

---

## P1a-1 — CI images, attestations, digest deploy (staging)

1. **Build once, check, push the same bytes.** `images` job (PR + main): plain `docker build` (no
   buildx export, no `build-push-action`), OCI labels `org.opencontainers.image.revision=<sha>` and
   `…source` set at build time; record the local image ID; run verify-image, canary, smoke on that ID.
   PR runs stop here and have **no** `packages: write`.
2. **`publish` job** (`if: push && main`, `needs: images` and every gate job): the only job with
   `packages: write`, `attestations: write`, `id-token: write`; runs **no repo code** (no checkout of
   scripts beyond what is needed, no `pnpm`). It loads the checked images (docker save artifact from
   `images`, `actions/upload-artifact` → `download-artifact`), tags `ghcr.io/arkeywave/ciudad-enduro-
   {api,web}:sha-<sha>`, pushes, captures the **manifest digests**, and proves identity: `docker
   manifest inspect <repo>@<digest> | jq -r .config.digest` == the checked image's config digest (assert
   the runner's image store type first). Then `actions/attest-build-provenance` on each digest
   (`push-to-registry: true`). Outputs: both digests.
3. **Packages public**; the box pulls anonymously.
4. **Staging apps → `dockerimage`** (same uuids; prove the conversion on staging; git settings off;
   labels and runtime env unchanged).
5. **`ce-oss-deploy` v2** (`command="… staging"` fixed in `authorized_keys`; reinstalled with review):
   - args: `<sha> <api-digest> <web-digest>`, regex `^[0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$`;
     `<sha>` ancestor of `origin/main`;
   - **preflight both images before touching either app:** `docker pull <repo>@<digest>`; `gh attestation
     verify oci://<repo>@<digest> --repo ArkeyWave/ciudad-enduro --signer-workflow
     ArkeyWave/ciudad-enduro/.github/workflows/ci.yml --source-ref refs/heads/main --source-digest <sha>`
     (gh CLI on the box, read-only token-less public verification; pin gh version); label
     `revision == <sha>`; installed verifier on the pulled image;
   - **rollback guard rewritten:** the running revision comes from the running container image's
     `org.opencontainers.image.revision` label (refuse if absent); strict-ancestor check +
     `ROLLBACK=1` operator override unchanged;
   - PATCH `docker_registry_image_tag=sha256-<hex>` per app; deploy api → check (running container's
     image ID == `docker image inspect <repo>@<digest> -f {{.Id}}`) → verify → stop on failure; then web;
   - revision + home + origin-lock checks unchanged; stop on failure unchanged;
   - **on success write the promotion record** `/var/lib/ce-oss/promoted/<sha>` (root 600:
     `<sha> <api-digest> <web-digest> <utc>`).
6. **Docs:** deploy.md "what runs where" (no repo build on the box), B3-F1 closed, the attestation trust
   root (Sigstore public-good / GitHub) recorded.

**Done when:** a push to main deploys staging by digest with a verified attestation; Coolify logs show a
pull and no build; refusal proofs (all with the apps left on the previous image): unknown SHA, digest
not matching the attestation, attestation from another workflow/ref, label mismatch, web image invalid
(api untouched — preflight), running image older than requested (rollback guard).

## P1a-2 — Cloudflare Turnstile on the send-code path

1. **API:** captcha plugin, `provider: 'cloudflare-turnstile'`, `endpoints: ['/email-otp/send-verification-otp']`,
   `allowedHostnames: [new URL(WEB_ORIGIN).hostname]`, `expectedAction: 'send_code'`. Env
   `TURNSTILE_SECRET_KEY` required; production rejects the Cloudflare dummy secrets (1x/2x/3x…AA) — the
   `dev-`/`test-` prefix rule does not catch them. Tests construct the plugin with
   `siteVerifyURLOverride` → a local stub (no production bypass exists in env).
2. **Ordering proof over HTTP** (fresh IP, eligible address): rejected/missing token → 0 rows in
   `otp_send_log`, no mail; accepted → 1 row, 1 mail. Provider unreachable (stub down) → 500, 0 rows.
3. **Web:** `/ingresar` server component reads `TURNSTILE_SITE_KEY` and passes it to `SignInForm`
   (G6). Widget in managed mode, Spanish, `action: 'send_code'`. **A fresh token for every send**,
   including "Enviar otro código" and retries; reset after each send; handle expire/error. Messages
   mapped **by `code`**, not status: `MISSING_RESPONSE`/`VERIFICATION_FAILED` → "No pudimos verificar que
   eres una persona. Intenta de nuevo."; `UNKNOWN_ERROR` → generic.
4. **Tests:** unit/integration with the siteverify stub (missing, rejected, accepted, timeout); e2e with a
   stubbed widget script (route interception) so CI does not depend on Cloudflare; an e2e that really
   resends. Mutations: remove the plugin; widen `endpoints` to all paths (sign-in e2e red); drop
   `allowedHostnames`; reuse a token on resend.
5. **`ci.yml` env lines** (owned here): smoke run gets dummy Turnstile values allowed outside production;
   e2e gets the stub.
6. **Operator checklist before merge:** two widgets (one per host: `enduro-next.vops.pe`, `enduro.vops.pe`),
   staging secret + site key in the staging api/web runtime env, prod values stored in
   `~/.secrets/ciudad-enduro-oss.env` for P1a-3.
7. **Plan §8 (phase 0) update:** cap exhaustion **reduced, not closed** (captcha-solving services exist);
   no per-IP daily share.

## P1a-3 — Production apps and the cutover of enduro.vops.pe

1. **Backup first:** scheduled backup for the prod DB (daily, retention ≥ 7) configured and one backup
   proven restorable into a scratch DB before the cutover.
2. **Prod apps** `ce-oss-api-prod`, `ce-oss-web-prod` (`dockerimage`, production environment, prod DB).
   **Separate credentials:** new DB credentials, `BETTER_AUTH_SECRET`, `OTP_HMAC_SECRET`, Resend key
   (sending-only, prod), Turnstile prod widget/secret. **Shared by decision:** the Google OAuth client
   (accepted: shared rotation/compromise scope; add redirect `https://enduro.vops.pe/api/auth/callback/google`
   — owner). `BETTER_AUTH_URL = WEB_ORIGIN = https://enduro.vops.pe`. Custom labels with
   `cloudflare-only@file` prepared but **`traefik.enable=false` for the first deploy**.
3. **Prod deploy workflow** `deploy-production.yml`: `workflow_dispatch` on main, Environment
   `production` (required reviewer = owner), input = SHA; SSH with the prod key
   (`command="/usr/local/bin/ce-oss-deploy production"`); the script reads the digests from the
   promotion record (refuses a SHA without one), re-verifies the attestations, and runs the same checks.
4. **First deploy, private:** with `traefik.enable=false`, check `/api/health` revision and the home page
   from the `coolify` network (`docker run --rm --network coolify curlimages/curl …`).
5. **Cutover (maintenance window, minutes):** precondition: the L2 guard with R12 is live and its
   must-deny tests are green ([deploy.md, residual risk](../operations/deploy.md#residual-risk-the-owners-local-gh-token)).
   a. save the old app's config; verify its routers carry `cloudflare-only@file`;
   b. stop the old app; confirm its container is gone;
   c. enable the new apps' locked labels and deploy;
   d. verify: public 200 + revision, direct origin 403, every router has the middleware, no host ports,
      and the set of containers that `docker ps` lists (running, restarting, paused) with ``Host(`enduro.vops.pe`)`` == {new api, new web};
   e. **rollback** (exact reverse): stop the new apps → confirm gone → start the old app with its stored
      labels → same checks. Rehearse once inside the window (the old repo's pull key must still work;
      the old images survive on the box).
6. **Production live checks** = Phase 0 §11 list, with a new test address; self-cleaning.
7. **Retirement** after 7 days without rollback (named trigger): delete the old Coolify app, the old
   staging app + DB clone, and the old repo's deploy workflows.

**Done when:** https://enduro.vops.pe serves the new app by digest with verified attestations; production
live checks pass; backup restorable; the old app stopped with a rehearsed rollback.

---

## 5. Review plan

| Stage | Reviewers |
|-------|-----------|
| This plan | rev. 1: opus @ high ∥ gpt-6.1-sol @ high (done). rev. 2: final claude-fable-5.2 @ high (approve with changes → rev. 3). Gate CLOSED. |
| P1a-1, P1a-2, P1a-3 | opus @ high + gpt-6.1-sol @ high → fixes → final opus @ xhigh |

## 6. Gate ledger (rev. 1 → rev. 2)

| Finding | Source | Where fixed |
|---------|--------|-------------|
| Tag resolution lets a `packages: write` holder ship any image | both (blocking) | G2, P1a-1.1-2, P1a-1.5 |
| Prod could run a different build than staging checked | both | G3, P1a-3.3 |
| `NEXT_PUBLIC_*` site key cannot serve one image on two hosts | both | G6, P1a-2.3 |
| Cutover not executable; dark launch through Traefik only gives 403 | both | G7, P1a-3.4-5 |
| Rollback guard silently off with digests (`${live##*:}` → 64 hex) | both | P1a-1.5 |
| Checked-vs-shipped identity compared the wrong values | both | P1a-1.2 |
| Preflight both images before changing either app | gpt | P1a-1.5 |
| P1a-2 needs files P1a-1 owned; switch must be atomic | opus (blocking) | §2 ownership + freeze |
| Fresh token per send incl. resend; map by code | gpt / opus | P1a-2.3 |
| Turnstile test secrets; tests still call Cloudflare | both | §0, P1a-2.1, 2.4 |
| Separate widgets/`allowedHostnames`; reject dummy secrets in prod | both | P1a-2.1, 2.6 |
| Prod DB has no backup | opus | P1a-3.1 |
| Credential separation explicit; Google client shared by decision | gpt | P1a-3.2 |
| Cut: tag lookup, internal host, typed confirm, second script, self-digest label | both | removed |
| Verifier `--network none --cap-drop ALL` | opus nit | follow-up (needs verifier roll-out) |

## 7. Rev. 3 amendments — BINDING (they replace any conflicting text above)

From the final review (claude-fable-5.2 @ high, approve with changes, 3 blocking).

**A1 (blocking) — attestation credential (G2, P1a-1.5).** `gh attestation verify` requires auth even for
public repos (only `--bundle` skips it: cli `pkg/cmd/attestation/verify/verify.go:245`). Use a
fine-grained GitHub token with **zero permissions** (public read only), stored root 600 at
`/root/.secrets/ce-oss-gh-attest.env`, exported as `GH_TOKEN` for the verify call only. Record its expiry
as a named trigger in deploy.md and the vops-infra skill. Add `--deny-self-hosted-runners`. A GitHub or
Sigstore outage blocks every deploy including `ROLLBACK=1` (fail closed, accepted, documented).

**A2 (blocking) — private first prod deploy (P1a-3.3-4).** Add an operator-only `PRIVATE=1` (same pattern
as `ROLLBACK=1`; the CI key cannot set env). It requires `traefik.enable=false` on both containers and
replaces the public revision/home/origin checks with the same checks against the container IPs (host
`curl`, no `curlimages/curl`). Step 5c then runs the normal script.

**A3 (blocking) — rollback is `docker stop` / `docker start` of the old container (P1a-3.5).** A Coolify
start queues a deployment that resolves `master@HEAD` and builds from source
(`ApplicationsController.php:4942-4966`, `ApplicationDeploymentJob.php:1753-1800`). Cutover:
`docker stop <old container>` (not a Coolify stop). Rollback: stop the new apps, then
`docker start <old container>` (labels, env and image are kept; exited app containers survive cleanup,
`CleanupDocker.php:252-254`). Rehearse once before the window. Disable the old repo's remaining
workflows at the cutover (its router rule would take every non-/api path).

**A4 — non-circular identity (P1a-1.2).** `images` emits the checked image ID as a job output; `publish`
compares the loaded image ID to that output **before** pushing. Build with `--provenance=false` (single
manifest, no index); assert the runner's image store type and use the config digest (classic store) or the
manifest digest (containerd store) accordingly. No artifact upload on PR runs.

**A5 — first v2 deploy procedure (§2 freeze).** (1) Confirm no main run is active. (2) After the first
publish, set both GHCR packages public (web UI), then re-run the deploy job. (3) The running images have
no revision label: the guard treats "no running container" as pass and "running container without the
label" as refuse unless `ROLLBACK=1`; the operator runs the first v2 deploy with it. (4) Release the
flock before the merge, so no queued v1 run continues with the old script.

**A6 — protect `main` (before P1a-1).** Ruleset: no force push, no deletion, pull request required, CI
checks `check`, `contract`, `e2e`, `images` required. The attestation policy trusts `ci.yml` on
`refs/heads/main`, so main must not be pushable around CI.

**A7 — Turnstile proof against Cloudflare (P1a-2).** Dummy secrets return hostname `example.com` and no
action, so stubs never prove `allowedHostnames` or `expectedAction`. Add a staging live check: a real
widget send passes; a request without a token gets 400 and writes 0 rows. The siteverify stub refuses a
token it has already seen (otherwise the resend mutation stays green). P1a-2 is done when these live
checks pass, CI is green and the mutation table is complete. Ownership adds `apps/api/test/**`,
`apps/web/playwright.config.ts` and the `.env.example` files.

**A8 — backup off-box (P1a-3.1).** The Coolify backup is local and plain. Add an S3-compatible off-box
target on Cloudflare R2 (a dedicated bucket, not `cde-media`; R2 encrypts at rest) for the prod DB, and
prove a restore from R2 into a scratch DB. Correct Phase 0 §8 ("backups encrypted") to the real state.

**A9 — small items.** Pin `actions/attest-build-provenance` by SHA and grant `artifact-metadata: write`
(or set `create-storage-record: false`). `deploy-production.yml` passes the SHA input via `env` and checks
its regex before the secret is used. One lock per target; write the promotion record via rename. The
host check matches the router rule for enduro.vops.pe as a fixed string.

**A11 — fixed: the captcha gets the full IPv6; the limiter keeps /64 (P1a-2 fix round 2).** Better
Auth's `getIP` normalizes IPv6 to its /64 (`@better-auth/core` `dist/utils/ip.mjs:105`, `ipv6Subnet`
default 64), and the captcha plugin sent that network address as siteverify `remoteip`. Cloudflare
defines `remoteip` as "The visitor's IP address"
(https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), and community
reports (Jan 2025) tie `invalid-input-response` to a wrong `remoteip`; a /64 network address is
never the rider's address. The first proposal (keep /64, accepted deviation) is withdrawn. Fix: the
plugin's `onRequest` gets a copy of the options with `ipv6Subnet: 128`
(`apps/api/src/auth/auth.options.ts`), so `remoteip` is the full address; the per-IP limiter still
keys IPv6 by /64. Tests: `captcha.int.spec.ts` (IPv6 → full address), `ratelimit.int.spec.ts` (two
addresses in one /64 share one bucket).

**Follow-up — `/ingresar` must stay a full page load.** `Turnstile.tsx:72`: `next/script` does not
cache a failed script load, so a client-side re-mount of `/ingresar` after a failed `api.js` load
would show neither the widget nor the alert. Until an e2e covers client-side navigation to
`/ingresar`, every link to it is a plain `<a href>` (no `next/link`, no `router.push`).

**A10 — cut.** The box-side verify-image run and the "installed verifier == repo verifier" rule are
removed: the digest identity plus the attestation already bind the checked image (CI still runs
verify-image before publish). The verifier `--network none` follow-up is therefore closed. No
`curlimages/curl`; no artifact upload on PR runs.
