# Staging deploy

Staging host: **https://enduro-next.vops.pe** (Cloudflare proxied) on the `vops-infra` box, Coolify
project `ciudad-enduro-oss`, environment `staging`.

## How a deploy happens

1. A push to `main` runs `.github/workflows/ci.yml`.
2. `images` builds both images **once** with plain `docker build --provenance=false` (one image
   manifest, no index) and the labels `org.opencontainers.image.revision=<sha>` and
   `org.opencontainers.image.source`. It runs `scripts/verify-image.sh` (forbidden paths, build-context
   canary) and the smoke run on those exact image IDs, and emits the IDs as job outputs. On a push to
   `main` only, it saves the images as a one-day artifact; pull requests upload nothing and have no
   package permission.
3. When `check`, `contract`, `e2e` and `images` pass, `publish` (push to `main` only) runs. It is the
   only job with `packages: write`, `attestations: write`, `id-token: write` and
   `artifact-metadata: write`, and it checks out nothing. It loads the artifact, **refuses unless each
   loaded image ID equals the ID `images` checked** (before any push), pushes
   `ghcr.io/arkeywave/ciudad-enduro-{api,web}:sha-<sha>`, and proves the pushed manifest is the checked
   image: the runner uses the containerd image store, so the manifest digest must equal the image ID (in
   the classic store it would be the config digest; the job detects the store and fails on an unknown
   one). Then `actions/attest-build-provenance` (pinned by SHA) signs a build provenance attestation for
   each digest and pushes it to the registry.
4. `deploy-staging` runs in the GitHub Environment `staging` (deployment branches: `main` only) with
   one secret, `CE_OSS_DEPLOY_KEY`, and `permissions: {}`. It runs
   `ssh root@104.152.209.8 "<sha> <api-digest> <web-digest>"` with a pinned host key. On the box that key
   can only run `/usr/local/bin/ce-oss-deploy staging` (`restrict,command=...` in
   `/root/.ssh/authorized_keys`); the target is fixed by the key.
5. `ce-oss-deploy` v2 (copy in [`ce-oss-deploy`](ce-oss-deploy)):
   - refuses anything that does not match `^[0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$`;
   - holds `flock /var/cache/ce-oss-deploy/lock.<target>` (one lock per target);
   - fetches `main` of the public repo into `/var/cache/ce-oss-deploy/repo.git` and refuses a SHA that
     is not an ancestor of `origin/main`;
   - **rollback guard:** reads the running api revision from its image's
     `org.opencontainers.image.revision` label. No running container passes; a running image without the
     label is refused unless `ROLLBACK=1`; a SHA that is a strict ancestor of the running one is refused
     unless `ROLLBACK=1` (see [Rollback](#rollback));
   - **preflight, both images before either app changes:** `docker pull <repo>@<digest>`;
     `gh attestation verify oci://<repo>@<digest> --repo ArkeyWave/ciudad-enduro --signer-workflow
     ArkeyWave/ciudad-enduro/.github/workflows/ci.yml --source-ref refs/heads/main --source-digest <sha>
     --deny-self-hosted-runners`; revision label == `<sha>`;
   - per app, api first (the api container migrates the database on start), then web: PATCH
     `docker_registry_image_name` = the repository and `docker_registry_image_tag` = `sha256-<hex>`,
     deploy, and require every running container of the app to run exactly
     `docker image inspect <repo>@<digest> -f {{.Id}}`. A failure stops the script; a failed rolling
     update leaves the old container running;
   - re-checks the origin lock: direct requests to the box for `/` and `/api/health` answer 403,
     every `traefik.http.routers.*.rule` label on both running containers has a `.middlewares`
     label with `cloudflare-only@file`, and `docker port` is empty for both. On failure it stops
     both apps and exits 1;
   - fails unless, within 3 minutes, `https://enduro-next.vops.pe/api/health` answers `revision`
     = the SHA and `/` answers 200 (both retried in the same loop);
   - writes the **promotion record** `/var/lib/ce-oss/promoted/<sha>` (root 600, written by rename):
     `<sha> <api-digest> <web-digest> <utc>`. Production (Phase 1a, P1a-3) deploys only a recorded pair.

What runs where: **no repository build step runs on the box.** Images are built and checked in GitHub
Actions; Coolify pulls them by digest (`Image (…) not found on the server. Pulling it` in the deployment
log, no build). The only code from the repo that runs on the box is the attested image itself. This
closes B3-F1 (the Coolify BuildKit build that ran repo `RUN` steps with host networking).

The Coolify token goes into the `coolify` container on stdin and into a curl config file there;
it never appears in a process argv (`/root/ce-oss/capi` does the same for manual API calls).

There is no `workflow_run` trigger and no Coolify webhook: auto-deploy is off on both apps.

### Trust root of the attestation

The attestation is a Sigstore bundle signed with a short-lived certificate from the **Sigstore
public-good** Fulcio CA, bound to the GitHub Actions OIDC identity of the run (repository, workflow file
`.github/workflows/ci.yml`, ref, commit, GitHub-hosted runner), logged in the public Rekor transparency
log, and stored by GitHub (repository attestations API) and in GHCR next to the image. `gh` verifies it
against the Sigstore public-good trusted root (TUF). Who can make a valid attestation: a workflow run of
`ci.yml` on `refs/heads/main` of `ArkeyWave/ciudad-enduro`; `main` is protected (ruleset `protect-main`:
pull request and the checks `check`, `contract`, `e2e`, `images` required, no force push, no deletion).

`gh attestation verify` needs a GitHub token even for public repos. The box uses a **fine-grained token
with no permissions** (public read only) in `/root/.secrets/ce-oss-gh-attest.env` (root 600,
`GH_TOKEN=...`), passed only in the environment of the `gh` call (binary
`/usr/local/lib/ce-oss/gh/bin/gh`; `/usr/local/lib/ce-oss/gh` is a directory symlink). The owner created
it on 2026-11-10 with **no expiration**: it can read only what is public. **Revoke it (GitHub → Settings →
Developer settings → Fine-grained tokens) if the box is compromised**, then put a new one in the file.
Without a valid token every deploy is refused. A GitHub or Sigstore outage also refuses every deploy,
`ROLLBACK=1` included (fail closed, accepted).

## Pieces on the box

| Piece | Value |
|---|---|
| Coolify app `ce-oss-api-staging` | `c6mm7pwdmoysv0eg2vgwo4bi`, build pack `dockerimage`, image `ghcr.io/arkeywave/ciudad-enduro-api`, tag `sha256-<hex>` (set by each deploy), port 3001, network alias `ce-oss-api-staging`, health check `/api/health` |
| Coolify app `ce-oss-web-staging` | `whfatie8ek3wh09ite3mnqn0`, build pack `dockerimage`, image `ghcr.io/arkeywave/ciudad-enduro-web`, port 3000, `API_INTERNAL_URL=http://ce-oss-api-staging:3001` |
| GHCR packages | `ghcr.io/arkeywave/ciudad-enduro-api`, `…-web`: public, pulled anonymously (the box has no GHCR login) |
| Database | `ciudad-enduro-oss-postgres-staging` (`zsr9gmrfd3sfdthyxxaikmoc`), Docker network only |
| Revision | CI passes `BUILD_SHA=<sha>` (api) and the label `org.opencontainers.image.revision=<sha>` (both images) |
| Deploy script | `/usr/local/bin/ce-oss-deploy` (root 755), v2 |
| gh | `/usr/local/lib/ce-oss/gh/bin/gh`; `/usr/local/lib/ce-oss/gh` → `gh-2.103.3` (release tarball, sha256 checked against the release checksums) |
| Attestation token | `/root/.secrets/ce-oss-gh-attest.env` (root 600), fine-grained, no permissions, no expiration |
| State | `/var/cache/ce-oss-deploy/` (root 700): `repo.git` (main only), `lock.staging` |
| Promotion records | `/var/lib/ce-oss/promoted/<sha>` (root 700 / 600) |
| Deploy key | `ci-deploy@ciudad-enduro-oss` in `/root/.ssh/authorized_keys`, `restrict,command="/usr/local/bin/ce-oss-deploy staging"` |
| API env | Coolify runtime env on the api app; `BETTER_AUTH_SECRET` and `OTP_HMAC_SECRET` were generated on the box; `TURNSTILE_SECRET_KEY` (staging widget, runtime only) |
| Web env | Coolify runtime env on the web app: `API_INTERNAL_URL`, `TURNSTILE_SITE_KEY` (staging widget, runtime only: the server component of `/ingresar` reads it, so one image serves both hosts) |

Images pulled by digest are untagged; Coolify's retention does not remove them. The disk grows slowly
(accepted; the old images help a rollback).

### Traefik labels

Both apps have `is_container_label_readonly_enabled = false`, so Coolify keeps the hand-written
`custom_labels` and generates no router of its own (no sslip.io host). Each app has exactly one
router, and both carry `cloudflare-only@file` (the Cloudflare `ipAllowList` in
`/data/coolify/proxy/dynamic/cloudflare-only.yaml`).

| App | Rule | Priority |
|---|---|---|
| api | ``Host(`enduro-next.vops.pe`) && (Path(`/api`) \|\| PathPrefix(`/api/`))`` | 100 |
| web | ``Host(`enduro-next.vops.pe`)`` | 10 |

`PathPrefix(`/api/`)` with the trailing slash keeps `/apiary` and `/apifoo` on the web app.
The prefix is not stripped: the API serves under `/api`.

**Never set a domain on these apps and never use "Reset to default labels"**: Coolify would
generate a router without the `cloudflare-only` middleware and open the origin.

To change a label, PATCH the complete set (base64) in `custom_labels`, then redeploy and run the
live checks. A `domains` change regenerates labels when the read-only setting is on; leave it off.

## Live checks (run after each deploy)

```bash
H=enduro-next.vops.pe; BOX=104.152.209.8
curl -s https://$H/api/health                                   # 200, revision = deployed SHA
curl -s https://$H/ | grep -o '<h2[^>]*>[^<]*</h2>'             # the seeded trail(s)
curl -s -o /dev/null -w '%{http_code}\n' https://$H/apifoo      # 404 from web (Next page)
curl -s https://$H/apifoo | grep -c '__next'                    # >0: served by web
curl -s -o /dev/null -w '%{http_code}\n' --resolve $H:443:$BOX https://$H/            # 403
curl -s -o /dev/null -w '%{http_code}\n' --resolve $H:443:$BOX https://$H/api/health  # 403
curl -s -o /dev/null -w '%{http_code}\n' https://infra.vops.pe                        # 302
```

On the box:

```bash
for u in c6mm7pwdmoysv0eg2vgwo4bi whfatie8ek3wh09ite3mnqn0; do
  c=$(docker ps --filter "name=^$u-" --format '{{.Names}}' | head -1)
  docker inspect "$c" -f '{{.Config.Image}}'   # ghcr.io/arkeywave/ciudad-enduro-…@sha256:…
  docker inspect "$c" -f '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' | grep 'routers\..*\.middlewares'
  docker port "$c"            # empty: no published host port
done
docker port zsr9gmrfd3sfdthyxxaikmoc   # empty
```

Every `routers.*.middlewares` line must contain `cloudflare-only@file`, and the number of
`.middlewares` lines must equal the number of `.rule` lines.

### `ce-oss-deploy` refusals

The proofs and their results are recorded in the P1a-1 pull request (#7). Every harness runs a copy of
the script whose `capi` is replaced by a logging stub that exits, and the harness aborts unless the stub
applied, so no proof can deploy.

## Rollback

The CI key cannot roll back: `ce-oss-deploy` refuses a SHA that is a strict ancestor of the running
api revision, and sshd passes no `ROLLBACK` variable from the key (`PermitUserEnvironment no`,
`AcceptEnv LANG LC_*`). A redeploy of the running SHA and a newer SHA pass.

Operator procedure, as root on the box:

```bash
# 1. Pick the main commit to go back to and read what it changes in apps/api/drizzle:
#    the database is NOT rolled back; older code must work on the newer schema.
# 2. Take its digests from its promotion record (or from its CI publish job):
cat /var/lib/ce-oss/promoted/<sha>
ROLLBACK=1 SSH_ORIGINAL_COMMAND="<sha> <api-digest> <web-digest>" /usr/local/bin/ce-oss-deploy staging
```

The attestation is verified again: a GitHub or Sigstore outage blocks the rollback too. The next push
to `main` deploys forward again.

## First v2 deploy (done once, P1a-1)

The box script v2, the switch of both apps to `dockerimage` and the new `ci.yml` request format go live
together, under a merge freeze (plan §2, amendment A5):

1. Freeze merges to `main`. Confirm no `main` CI run is active and no `ce-oss-deploy` process runs.
2. Hold the v1 lock (`flock /var/cache/ce-oss-deploy/lock`), install v2 at `/usr/local/bin/ce-oss-deploy`,
   change the key's forced command to `/usr/local/bin/ce-oss-deploy staging`.
3. Switch both apps to `dockerimage` (same uuids; image name set, labels and runtime env unchanged).
   The running containers keep running.
4. Release the lock before the merge (a queued v1 request now reaches v2 and is refused by the regex).
5. Merge P1a-1. `publish` pushes and attests; `deploy-staging` is refused because the
   running images have no revision label (proof of the guard).
6. The operator runs the first deploy with the digests from the publish job:
   `ROLLBACK=1 SSH_ORIGINAL_COMMAND="<sha> <api> <web>" /usr/local/bin/ce-oss-deploy staging`.
7. Re-run the failed `deploy-staging` job (same SHA: passes without `ROLLBACK`), run the live checks,
   release the freeze.

After this, `/usr/local/lib/ce-oss/verify-image.sh` is no longer used on the box (A10: CI runs the
verifier before publish; the digest and the attestation bind the checked image).

## Seed data

The staging database starts empty. One published trail was inserted by hand on 2026-11-10 so the
home page has something to list (`slug = 'staging-demo'`). Run SQL through the DB container:

```bash
docker exec -i zsr9gmrfd3sfdthyxxaikmoc psql -U ciudadenduro_staging -d ciudad_enduro_staging
```

## Follow-ups

- `verify-image.sh`: the "empty /app" check never fails in practice (`find /app` prints `/app`
  itself). Require `/app/package.json` instead (CI only now; no box roll-out needed).

## Operator checklist — merge gate for B4

B4 (auth) must not merge until every item is ticked, because the merge deploys auth to a public host.

- [x] Coolify env on the api app: real random `BETTER_AUTH_SECRET` and `OTP_HMAC_SECRET` (48 chars,
      generated on the box 2026-11-10), `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`.
- [x] Google OAuth client has the redirect URI
      `https://enduro-next.vops.pe/api/auth/callback/google` — done 2026-11-10 (owner).
- [x] Resend sender domain of `EMAIL_FROM` is verified — done 2026-11-10 (owner).
- [x] Cloudflare rate-limit rule on `POST /api/auth/email-otp/send-verification-otp` (rule
      `4cf84c7a…`, 5 requests / 10 s per IP, zone `vops.pe`).
