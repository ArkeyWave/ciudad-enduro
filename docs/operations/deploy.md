# Deploy (staging and production)

Staging host: **https://enduro-next.vops.pe** (Cloudflare proxied) on the `vops-infra` box, Coolify
project `ciudad-enduro-oss`, environment `staging`. Production: see [Production](#production)
(host `enduro.vops.pe`, environment `production`; not live yet).

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
5. `ce-oss-deploy` v3 (copy in [`ce-oss-deploy`](ce-oss-deploy); the box runs v2 until the P1a-3
   install, see [Install v3](#install-v3-after-the-merge)):
   - refuses anything that does not match `^[0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$`;
   - **detaches the run from the SSH session** and streams its log back
     ([Detached run](#how-a-production-deploy-happens), same code path for both targets);
   - holds `flock /var/cache/ce-oss-deploy/lock.<target>` (one lock per target);
   - fetches `main` of the public repo into `/var/cache/ce-oss-deploy/repo.git` under `lock.cache` and
     refuses a SHA that is not an ancestor of `origin/main`;
   - **rollback guard:** reads the api revision from the `org.opencontainers.image.revision` label of
     the image of the **newest api container in any state** (`docker ps -a --latest`), so a stopped or
     restarting api still counts; an image without the label is refused unless `ROLLBACK=1`. A Coolify
     stop removes the containers (`StopApplication`: `docker rm -f`, `removeContainers` defaults to true
     and the API stop passes no value), so with **no api container at all** the lower bound is the
     newest promotion record in `/var/lib/ce-oss/promoted/`, by the UTC date in the record (field 4,
     not the file mtime); no record either passes (the first v2 deploy). A bound that is not a commit
     on `main`, and a SHA that is a strict ancestor of the bound, are refused unless `ROLLBACK=1` (see
     [Rollback](#rollback));
   - **preflight, both images before either app changes:** `docker pull <repo>@<digest>`;
     `gh attestation verify oci://<repo>@<digest> --repo ArkeyWave/ciudad-enduro --signer-workflow
     ArkeyWave/ciudad-enduro/.github/workflows/ci.yml --source-ref refs/heads/main --source-digest <sha>
     --deny-self-hosted-runners`; revision label == `<sha>`;
   - refuses unless both apps have build pack `dockerimage` (any other build pack would ignore the digest
     and build from source on the box);
   - **checks before the first change** ([Production step 5](#how-a-production-deploy-happens)): both
     apps have the read-only label setting off, and no other container claims
     ``Host(`enduro-next.vops.pe`)`` (refused, no Coolify call);
   - per app, api first (the api container migrates the database on start), then web: PATCH
     `docker_registry_image_name` = the repository and `docker_registry_image_tag` = `sha256-<hex>`,
     deploy, and require every running container of the app to run exactly
     `docker image inspect <repo>@<digest> -f {{.Id}}`. The script records the app's running image IDs
     before the deploy and checks in two passes, so the order of the IDs does not matter: any image that
     is neither the pulled one nor a recorded one is unchecked, so the script stops the app and exits 1;
     then, if a recorded image still runs, the rolling update failed and the old container stays
     (exit 1). A deployment UUID that is not alphanumeric is refused before it reaches SQL;
   - re-checks the origin lock: direct requests to the box for `/` and `/api/health` answer 403,
     every `traefik.http.routers.*.rule` label on both running containers has a `.middlewares`
     label with `cloudflare-only@file`, `docker port` is empty for both, and the containers that claim
     the host are exactly the two apps' own (the same host check as before the change). On failure it
     stops both apps and exits 1 ("public checks failed; both apps stopped");
   - fails unless, within 3 minutes, `https://enduro-next.vops.pe/api/health` answers `revision`
     = the SHA and `/` answers 200 (both retried in the same loop);
   - writes the **promotion record** `/var/lib/ce-oss/promoted/<sha>` (root 600, written by rename):
     `<sha> <api-digest> <web-digest> <utc>`. Production (Phase 1a, P1a-3) deploys only a recorded pair.

What runs where: **no repository build step runs on the box.** Images are built and checked in GitHub
Actions; the preflight pulls them by digest, and Coolify starts the pulled image. Evidence per deploy:
the Coolify deployment log says `Starting deployment of ghcr.io/arkeywave/ciudad-enduro-<app>@sha256:<hex>`
and has no build step, and the script prints `<app>: finished, running <repo>@<digest>`:

```bash
docker exec coolify-db psql -U coolify -d coolify -tAc \
  "select logs from application_deployment_queues where deployment_uuid='<deployment uuid>'" |
  grep -oE 'Starting deployment of [^ ]+|Building docker image|docker build' | sort | uniq -c
# expected: 1 "Starting deployment of ghcr.io\/…@sha256:…" (the log is JSON: "/" shows as "\/"),
# no "Building docker image" and no "docker build" line (a v1 build log has both)
```

The only code from the repo that runs on the box is the attested image itself. This closes B3-F1 (the
Coolify BuildKit build that ran repo `RUN` steps with host networking).

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
pull request and the checks `check`, `contract`, `e2e`, `images` required, no force push, no deletion,
**no bypass actors**: the admin bypass was removed on 2026-11-11, so nobody pushes to `main` around CI).

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
| Deploy script | `/usr/local/bin/ce-oss-deploy` (root 755), v2; v3 (adds `production` and `PRIVATE=1`) is installed after the P1a-3 merge ([Install v3](#install-v3-after-the-merge)) |
| gh | `/usr/local/lib/ce-oss/gh/bin/gh`; `/usr/local/lib/ce-oss/gh` → `gh-2.103.3` (release tarball, sha256 checked against the release checksums) |
| Attestation token | `/root/.secrets/ce-oss-gh-attest.env` (root 600), fine-grained, no permissions, no expiration |
| State | `/var/cache/ce-oss-deploy/` (root 700): `repo.git` (main only), `lock.staging`, `lock.production` (one lock per target), `lock.cache` (the shared `repo.git` fetch) |
| Run logs | `/var/lib/ce-oss/logs/<target>-<sha>-<utc>-<random>.log` (root 700 / 600, v3): one per run, last line `END exit=<code>` |
| Promotion records | `/var/lib/ce-oss/promoted/<sha>` (root 700 / 600), written by staging only |
| Production records | `/var/lib/ce-oss/production/<sha>` (root 700 / 600), the lower bound of the production rollback guard |
| Deploy key | `ci-deploy@ciudad-enduro-oss` in `/root/.ssh/authorized_keys`, `restrict,command="/usr/local/bin/ce-oss-deploy staging"` |
| Prod deploy key | `ci-deploy-prod@ciudad-enduro-oss` (`SHA256:HQJnfKsK8W0kuC8tGhjKYwuQgoZ/Y8zkDyZEonzCY/A`), same options with `command="/usr/local/bin/ce-oss-deploy production"`; private half only in the Environment `production` secret `CE_OSS_PROD_DEPLOY_KEY` |
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

The CI key cannot roll back: `ce-oss-deploy` refuses a SHA that is a strict ancestor of the lower
bound, and sshd passes no `ROLLBACK` variable from the key (`PermitUserEnvironment no`,
`AcceptEnv LANG LC_*`). The bound is the revision label of the image of the **newest api container in
any state**; with no api container at all (a Coolify stop removes them), it is the **newest promotion
record** (by the UTC date in the record). A bound that is not on `main` is refused too. A redeploy of the
bound SHA and a newer SHA pass.

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
together, under a merge freeze (plan §2, amendment A5). The freeze is the ruleset `freeze-main`
(id 26997912, plan agents-gates-ux §6 R8). **The orchestrator runs every ruleset command**; the operator
on the box runs the rest.

1. Freeze merges to `main` (orchestrator):
   - once, before the first freeze: rehearse it. Open a throwaway PR (an empty or docs-only commit).
     With the ruleset still disabled, wait until its checks are green and
     `gh pr view <N> --json mergeStateStatus -q .mergeStateStatus` prints `CLEAN` (so a refusal can only
     come from the freeze). Then set the ruleset active (`… -f enforcement=active`, below): `gh pr merge
     <N> --merge` must be refused, and the message must name the repository rule. Disable the ruleset
     again and close the PR without a merge. Check that auto-merge is off:
     `gh api repos/ArkeyWave/ciudad-enduro -q .allow_auto_merge` prints `false`;
   - freeze: `gh api -X PUT repos/ArkeyWave/ciudad-enduro/rulesets/26997912 -f enforcement=active`.

   Then confirm no `main` CI run is active (`gh run list --branch main -s in_progress`) and no
   `ce-oss-deploy` process runs (`pgrep -af ce-oss-deploy` prints nothing). Confirm the staging
   containers:
   ```bash
   docker ps -a --filter name=^c6mm7pwdmoysv0eg2vgwo4bi- --filter name=^whfatie8ek3wh09ite3mnqn0- \
     --format '{{.Names}} {{.Image}} {{.Status}}'
   ```
   Expected: exactly two lines, the Coolify containers of the current deploy (`<uuid>-<timestamp>`,
   image `<uuid>:<main sha>`, `Up …`); no other container and no harness container. On 2026-11-11 it
   printed `whfatie8ek3wh09ite3mnqn0-20261111T020438 whfatie8ek3wh09ite3mnqn0:21e98cb… Up 39 minutes`
   and `c6mm7pwdmoysv0eg2vgwo4bi-20261111T020014 c6mm7pwdmoysv0eg2vgwo4bi:21e98cb… Up 41 minutes (healthy)`.
2. In one root shell on the box, hold both locks, install v2 and fix the forced command. v1 uses
   `lock`, v2 uses `lock.staging`; the two never block each other, so hold both:
   ```bash
   cd /root/ce-oss
   exec 8>/var/cache/ce-oss-deploy/lock;          flock 8   # waits for a running v1 deploy
   exec 7>/var/cache/ce-oss-deploy/lock.staging;  flock 7   # no v2 deploy during the switch
   rm -f ce-oss-deploy.v2
   # One chain: nothing is installed unless the download is the reviewed file, and the forced
   # command changes only after a verified install.
   curl -fsSL -o ce-oss-deploy.v2 \
     https://raw.githubusercontent.com/ArkeyWave/ciudad-enduro/1e6d7ce6d3196193b0f5eb1a0fd3aa0e206b137e/docs/operations/ce-oss-deploy &&
     echo '23d7a9d7c172f2c12b5056c1e271004ac1af1e477ffd209582e1fe4106d8bd47  ce-oss-deploy.v2' | sha256sum -c &&
     install -o root -g root -m 755 ce-oss-deploy.v2 /usr/local/bin/ce-oss-deploy &&   # new inode
     echo '23d7a9d7c172f2c12b5056c1e271004ac1af1e477ffd209582e1fe4106d8bd47  /usr/local/bin/ce-oss-deploy' | sha256sum -c &&
     cp -p /root/.ssh/authorized_keys /root/.ssh/authorized_keys.pre-v2 &&
     sed -i 's|command="/usr/local/bin/ce-oss-deploy" \(.*ci-deploy@ciudad-enduro-oss\)$|command="/usr/local/bin/ce-oss-deploy staging" \1|' /root/.ssh/authorized_keys &&
     grep -c 'command="/usr/local/bin/ce-oss-deploy staging" .*ci-deploy@ciudad-enduro-oss$' /root/.ssh/authorized_keys  # 1
   pgrep -af ce-oss-deploy   # nothing; a waiting v1 process would continue on the old inode: stop and ask
   ```
   If any command of the chain fails, stop and ask (keep the locks until the orchestrator decides, or
   release them with `exec 8>&- 7>&-`).
   The URL pins the commit that last changed the script, and the sha256 is that file's. **When a later
   commit changes `docs/operations/ce-oss-deploy`, update both values here** (the reviewed merge head
   must carry the same file).
3. Switch both apps to `dockerimage` (same uuids; image name set; labels and runtime env unchanged)
   with **Coolify's own model save in tinker**. The Coolify 4.7.3 API cannot do it: `PATCH
   /applications/<uuid>` with `build_pack: dockerimage` answers 422 `The selected build pack is
   invalid.` (the update validates against the `BuildPackTypes` enum, which has no `dockerimage`; the
   API sets `dockerimage` only when it creates an app from an image). Proved on 2026-11-11.

   What the save changes (`Application::saving`, the only update hook): on a change away from
   `dockerfile` it clears `dockerfile`, `dockerfile_location`, `dockerfile_target_build` and sets
   `custom_healthcheck_found = false`; nothing else. What the `dockerimage` deploy reads:
   `docker_registry_image_name` and `docker_registry_image_tag` (`sha256-<hex>` → `<repo>@sha256:<hex>`;
   empty → `latest`), plus the same settings as before (ports, health check, `custom_labels`, network
   aliases, runtime env, destination). It reads no git field and no registry credential (the packages are
   public). The tag stays empty here: every v2 deploy PATCHes the name and the tag (an API PATCH of
   those two fields is valid). Do not deploy or restart the apps between this step and step 6, or Coolify
   would pull `:latest`.
   ```bash
   cd /root/ce-oss; umask 077
   # Backup of both full rows, for a rollback.
   docker exec coolify-db psql -U coolify -d coolify -tAc "select row_to_json(a) from applications a
     where uuid in ('c6mm7pwdmoysv0eg2vgwo4bi','whfatie8ek3wh09ite3mnqn0') order by id" > a5-apps-before.json
   # Per app, api first: switch, then the after-check (query below) before the next app.
   docker exec coolify php artisan tinker --execute="\$a = \App\Models\Application::where('uuid', 'c6mm7pwdmoysv0eg2vgwo4bi')->firstOrFail(); \$a->build_pack = 'dockerimage'; \$a->docker_registry_image_name = 'ghcr.io/arkeywave/ciudad-enduro-api'; \$a->save();"
   docker exec coolify php artisan tinker --execute="\$a = \App\Models\Application::where('uuid', 'whfatie8ek3wh09ite3mnqn0')->firstOrFail(); \$a->build_pack = 'dockerimage'; \$a->docker_registry_image_name = 'ghcr.io/arkeywave/ciudad-enduro-web'; \$a->save();"
   ```
   Before and after each switch, run this query; the running containers keep running:
   ```bash
   for u in c6mm7pwdmoysv0eg2vgwo4bi whfatie8ek3wh09ite3mnqn0; do
     docker exec coolify-db psql -U coolify -d coolify -tAc "select a.build_pack, a.docker_registry_image_name,
       md5(a.custom_labels), s.is_container_label_readonly_enabled, a.git_repository, a.git_branch, a.git_commit_sha,
       (select md5(string_agg(e.key||e.value, ',' order by e.key, e.is_preview)) from environment_variables e
         where e.resourceable_id = a.id and e.resourceable_type like '%Application'),
       a.ports_exposes, a.health_check_path
       from applications a join application_settings s on s.application_id = a.id where a.uuid = '$u'"
   done
   ```
   Expected after: `dockerimage`, the GHCR repository, and unchanged label md5, readonly flag `f`, git
   fields, env md5, ports and health check path; the v1 containers still run; public `/api/health` 200;
   no new row in `application_deployment_queues`.

   **Rollback of one app** (only when its after-check fails): put back the fields the save changed, from
   the backup, without the saving hook, then check with the query:
   ```bash
   j=$(jq -c --arg u <uuid> 'select(.uuid == $u) | {build_pack, docker_registry_image_name,
     docker_registry_image_tag, dockerfile, dockerfile_location, dockerfile_target_build,
     custom_healthcheck_found}' a5-apps-before.json)
   docker exec coolify php artisan tinker --execute="\$a = \App\Models\Application::where('uuid', '<uuid>')->firstOrFail(); \$a->forceFill(json_decode(base64_decode('$(printf '%s' "$j" | base64 -w0)'), true)); \$a->saveQuietly();"
   ```

   Record of 2026-11-11: the API PATCH was refused (422) while both locks were held, the shell
   stopped, and the locks were released with it; nothing had changed in Coolify. The tinker switch then
   ran at 04:19 UTC (script `/root/ce-oss/a5-step3-tinker.sh`, log `a5-step3.log`): both apps `dockerimage`,
   every other value unchanged, no deployment queued, origin lock 403/403, public 200.
4. Release both locks before the merge: `exec 8>&- 7>&-`. A queued v1 request now reaches v2 and is
   refused by the regex; a v2 request is refused while either app is not `dockerimage`.
5. Merge P1a-1 (orchestrator), with the freeze off only for this merge:
   ```bash
   gh api -X PUT repos/ArkeyWave/ciudad-enduro/rulesets/26997912 -f enforcement=disabled
   gh pr merge 7 --merge
   gh api -X PUT repos/ArkeyWave/ciudad-enduro/rulesets/26997912 -f enforcement=active   # at once
   ```
   `publish` pushes and attests; `deploy-staging` is refused because the running images have no revision
   label (proof of the guard).
6. The operator runs the first deploy with the digests from the publish job, detached from the SSH
   session, and follows the log:
   ```bash
   setsid -f env ROLLBACK=1 SSH_ORIGINAL_COMMAND="<sha> <api-digest> <web-digest>" \
     /usr/local/bin/ce-oss-deploy staging < /dev/null > /root/ce-oss/first-v2.log 2>&1
   tail -f /root/ce-oss/first-v2.log    # ends with "promoted: …", "FAIL …" or "refused: …"
   ```
   Check the Coolify log of both deployments (section "What runs where").
7. Re-run the failed `deploy-staging` job (same SHA: passes without `ROLLBACK`) and run the live checks.
   Then the orchestrator releases the freeze:
   `gh api -X PUT repos/ArkeyWave/ciudad-enduro/rulesets/26997912 -f enforcement=disabled`.

After this, `/usr/local/lib/ce-oss/verify-image.sh` is no longer used on the box (A10: CI runs the
verifier before publish; the digest and the attestation bind the checked image).

## Production

Host **`enduro.vops.pe`** (today it still serves the old app; the cutover is plan P1a-3.5). Coolify
project `ciudad-enduro-oss`, environment `production` (`e04m00q08bl1d6yop2rsfdgr`). Created on
2026-11-11; **not deployed yet**.

| Piece | Value |
|---|---|
| Coolify app `ce-oss-api-prod` | `ith1im25jwpamnvthlikfglq`, build pack `dockerimage`, image `ghcr.io/arkeywave/ciudad-enduro-api`, port 3001, network alias `ce-oss-api-prod`, health check `/api/health`, no domain, auto-deploy off |
| Coolify app `ce-oss-web-prod` | `gwn5ys9bnjvn7fasm6egvxw4`, build pack `dockerimage`, image `ghcr.io/arkeywave/ciudad-enduro-web`, port 3000, `API_INTERNAL_URL=http://ce-oss-api-prod:3001`, no domain, auto-deploy off |
| Labels | `is_container_label_readonly_enabled = false`; hand-written `custom_labels` with the routers of the staging table for ``Host(`enduro.vops.pe`)`` (api priority 100, web 10, both `cloudflare-only@file`) and **`traefik.enable=false`** until the cutover |
| Database | `ciudad-enduro-oss-postgres` (`k9ysrxe4vuaqge54kkqivfpa`), app role `ciudadenduro_app` (no superuser, owner of `ciudad_enduro`); the container superuser `ciudadenduro` is not in the app env |
| API env | `NODE_ENV=production`, `PORT=3001`, `BETTER_AUTH_URL = WEB_ORIGIN = https://enduro.vops.pe`, `DATABASE_URL` (app role), `BETTER_AUTH_SECRET` and `OTP_HMAC_SECRET` (new, generated on the box), `TURNSTILE_SECRET_KEY` (prod widget), `GOOGLE_CLIENT_ID/SECRET` (shared with staging by decision), `EMAIL_FROM`. **`RESEND_API_KEY` is missing**: a prod sending-only key from the owner |
| Web env | `API_INTERNAL_URL`, `TURNSTILE_SITE_KEY` (prod widget) |
| Secrets | Coolify and the owner's machine only (`~/.secrets/ciudad-enduro-oss.env`, `PROD_*`); no copy on the box |
| Backup | **none yet** (plan P1a-3.1, A8: daily, off-box on Cloudflare R2, restore proved before the cutover) |

### How a production deploy happens

1. The owner opens Actions → **Deploy production** → Run workflow on `main` and types the 40-hex
   SHA of a `main` commit that staging deployed.
2. `preflight` (no secret, `actions: read`, `contents: read`) refuses unless the input is 40 hex, the
   compare API says `main` contains the SHA (`identical` or `ahead`), a `ci.yml` run of the push of
   that SHA to `main` succeeded, and its `deploy-staging` job (latest attempt) succeeded.
3. `deploy` needs `preflight` and runs in the Environment **`production`**: required reviewer
   `ArkeyWave`, prevent self-review off (single maintainer), administrators cannot bypass, deployment
   branches `main` only. Its only secret is `CE_OSS_PROD_DEPLOY_KEY`; a step without the secret
   checks the SHA regex again before the step that holds it. It runs
   `ssh root@104.152.209.8 "<sha>"` with the pinned host key.
4. On the box the key can only run `/usr/local/bin/ce-oss-deploy production`. The request is the SHA
   alone (`^[0-9a-f]{40}$`). The run is **detached from the SSH session** (below). It takes
   `lock.production`, reads the digests from the staging promotion record
   `/var/lib/ce-oss/promoted/<sha>` (refuses a SHA without one, and a record whose first field is not
   the SHA), and then runs the same steps as staging: SHA on `main` (the shared `repo.git` fetch holds
   `lock.cache`), rollback guard, preflight of both images (pull, attestation verified again, label),
   build pack `dockerimage`, the checks before the first change (below), api then web by digest,
   running image check, origin lock, live revision and home page on `https://enduro.vops.pe`.
5. **Checks before the first change** (both targets): both apps have
   `is_container_label_readonly_enabled = f` (otherwise Coolify would generate its own labels and
   ignore the stored ones), and in public mode no container that `docker ps` lists (running,
   restarting or paused) other than the apps' own carries the fixed string ``Host(`<host>`)`` in a
   label (an old app must be stopped first; refused, no Coolify call). After the deploys the origin
   check requires the same again: the containers that claim the host are the apps' own containers
   that `docker ps` lists, and the image check of each deploy has already required every one of
   them to run the new image (an old image in any listed state fails: "the old image … still runs").
   On a failure there: "public checks failed; both apps stopped".
6. On success it writes `/var/lib/ce-oss/production/<sha>` (same format, by rename). The production
   rollback guard reads these records, not the staging ones, when no prod api container exists.

**Detached run (both targets, one code path).** The caller's process checks the request, starts the
run with `setsid` in its own session, its output in `/var/lib/ce-oss/logs/<target>-<sha>-<utc>-<random>.log`
(`mktemp`, a random suffix before `.log`; root 700 / 600), streams that log back (`tail --pid`) and exits with the run's code, read from the
last line `END exit=<code>` (the line before it is `recorded: …`, `PRIVATE=1: no promotion record`,
`FAIL …` or `refused: …`; when a command fails under `set -e` without a message of the script, the
line before is that command's own error output, or nothing, and the code is not 0). A cancelled CI job or a dropped SSH connection stops only the stream: the
run continues to its end and its log keeps the result. sshd passes no `CE_OSS_RUN` from a key, so a
caller cannot skip the detach. Read a run's result later with `tail -3 /var/lib/ce-oss/logs/<file>`.

### `PRIVATE=1` (first deploy, before the cutover)

Operator only, as root on the box (sshd passes no variable from a CI key). The script detaches
itself; a dropped session does not stop it:

```bash
PRIVATE=1 SSH_ORIGINAL_COMMAND="<sha>" /usr/local/bin/ce-oss-deploy production
# prints "run <pid>, log /var/lib/ce-oss/logs/production-<sha>-<utc>-<random>.log", then the log; the last
# line is "END exit=<code>"
```

- Before any change, both apps must store exactly one `traefik.enable` label, `=false`, in
  `custom_labels`, and have the read-only label setting off; otherwise the script refuses.
- Right after **each** app's deploy (api first), every running container of that app must carry
  `traefik.enable=false`, publish no host port, be on the `coolify` network and answer on its IP
  there from the host: api `http://<ip>:3001/api/health` revision = SHA, web `http://<ip>:3000/`
  200 (retried for 3 minutes). The public origin-lock and live checks do not run.
- **Any failure after the first change stops both apps** (exit trap): a failed check, a failed or
  cancelled Coolify deployment, a timeout, a die in either deploy.
- Production writes its record; a `PRIVATE=1` staging deploy writes no promotion record.

The cutover then enables the locked labels (`traefik.enable=true`, a complete `custom_labels`
PATCH) and runs the normal deploy (plan P1a-3.5c, amendments A2, A3).

### Rollback (production)

The same guard as staging. As root on the box, for a `main` commit that has a staging promotion
record: `ROLLBACK=1 SSH_ORIGINAL_COMMAND="<sha>" /usr/local/bin/ce-oss-deploy production`.

### Residual risk: the owner's local `gh` token

The `gh` CLI on the owner's machine is logged in as `ArkeyWave` (the required reviewer) with the
`repo` and `workflow` scopes. A local agent with that token could dispatch `deploy-production.yml`
and approve its pending deployment through the API: the Environment cannot tell the owner from an
agent that holds the owner's token. **Rule: agents never call `gh workflow run deploy-production*`
and never call the `pending_deployments` API; only the owner dispatches and approves, in the GitHub
UI.** What still holds without the rule: a dispatch can deploy only a `main` commit that staging
deployed and promoted (preflight + promotion record), and a rollback needs `ROLLBACK=1` on the box.

**Precondition of the cutover (P1a-3.5):** the L2 guard with rule R12 (agents may not dispatch
`deploy-production*` or call `pending_deployments`) is live on the owner's machine **and its
must-deny tests are green**. Until both are true, the cutover does not start; record the guard
version and the test run in the P1a-3 cutover PR.

### Install v3 (after the merge)

v3 is reviewed in the P1a-3 pull request and installed after its merge, with both target locks held
(no deploy may run on a half-installed file). Same chain as the v2 install (step 2 of "First v2
deploy"); the forced commands already name their targets, so `authorized_keys` does not change.
**Pin the MERGE commit**, not a PR commit: after the merge, set `<merge>` to the merge commit on
`main` and check that the file there has the sha256 below (the reviewed head must carry the same file):

```bash
cd /root/ce-oss
exec 7>/var/cache/ce-oss-deploy/lock.staging; flock 7
exec 6>/var/cache/ce-oss-deploy/lock.production; flock 6
pgrep -af 'ce-oss-deploy (staging|production)'   # nothing: a waiting run would continue on the old inode
rm -f ce-oss-deploy.v3
curl -fsSL -o ce-oss-deploy.v3 \
  https://raw.githubusercontent.com/ArkeyWave/ciudad-enduro/<merge>/docs/operations/ce-oss-deploy &&
  echo 'fee830e5fa73feb263f409e3956104dcb7d6fddec3ecdfb5bfe58876384b2e3e  ce-oss-deploy.v3' | sha256sum -c &&
  install -o root -g root -m 755 ce-oss-deploy.v3 /usr/local/bin/ce-oss-deploy &&
  echo 'fee830e5fa73feb263f409e3956104dcb7d6fddec3ecdfb5bfe58876384b2e3e  /usr/local/bin/ce-oss-deploy' | sha256sum -c
exec 7>&- 6>&-
ls -A /var/lib/ce-oss/production 2>/dev/null   # nothing: no stray record may bound the prod guard
```

The sha256 (fee830e5fa73feb263f409e3956104dcb7d6fddec3ecdfb5bfe58876384b2e3e) is that of `docs/operations/ce-oss-deploy` at the reviewed head (in the P1a-3 PR;
update it with every review fix). After the install, write the merge commit into this section in a
docs commit. Until v3 is installed, the prod key is refused (`unknown target 'production'`).

### Post-merge steps (P1a-3 part 1)

1. Install v3 (above) and run the staging live checks after the next push to `main`.
2. **Dispatch once with a refused SHA** (the owner, in the GitHub UI): Actions → Deploy production →
   Run workflow on `main` with a SHA that `preflight` refuses (for example a PR head that is not on
   `main`). Expected: `preflight` fails, `deploy` is **skipped** (no approval request, no SSH). Record
   the run URL in the P1a-3 PR.

### `ce-oss-deploy` v3 proofs

Harness `/root/ce-oss/v3-test/` (copy of the v2 harness: `capi` is a stub in every row; stand-in
containers carry `traefik.enable=false` and publish no public port; `HARNESS_KEEP=1` keeps a run's
files for the detach row). Results and mutations are in the P1a-3 pull request. The preflight logic
has its own test with a fake `gh`: `scripts/test-deploy-production-preflight.sh` (`--step` prints the
step to mutate, `--run FILE` runs the cases on a mutated copy).

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
