# Staging deploy

Staging host: **https://enduro-next.vops.pe** (Cloudflare proxied) on the `vops-infra` box, Coolify
project `ciudad-enduro-oss`, environment `staging`.

## How a deploy happens

1. A push to `main` runs `.github/workflows/ci.yml`.
2. When `check`, `contract`, `e2e` and `images` pass, the `deploy-staging` job runs in the GitHub
   Environment `staging` (deployment branches: `main` only). It holds one secret,
   `CE_OSS_DEPLOY_KEY`.
3. The job runs `ssh root@104.152.209.8 <sha>` with a pinned host key. On the box, that key can only
   run `/usr/local/bin/ce-oss-deploy` (`restrict,command=...` in `/root/.ssh/authorized_keys`).
4. `ce-oss-deploy` (copy in [`ce-oss-deploy`](ce-oss-deploy)):
   - refuses anything that is not one 40-hex SHA;
   - fetches `main` of the public repo into `/var/cache/ce-oss-deploy/repo.git` and refuses a SHA
     that is not an ancestor of `origin/main` (a fork or branch commit cannot deploy);
   - holds `flock /var/cache/ce-oss-deploy/lock` (directory `700`);
   - refuses a SHA that is a strict ancestor of the running api commit (a rollback) unless an
     operator on the box sets `ROLLBACK=1` (see [Rollback](#rollback));
   - refuses the commit, **before any deploy**, when its `scripts/verify-image.sh` differs from
     the reviewed copy installed at `/usr/local/lib/ce-oss/verify-image.sh`;
   - deploys **api first** (the api container migrates the database on start), then web. Right
     after each app's own deploy, it requires the running container to be exactly
     `<app-uuid>:<sha>` and runs the installed verifier on that image; when the image check
     fails, it stops that app through the Coolify API and exits 1. A failed web deploy therefore
     never leaves an unchecked api image live;
   - re-checks the origin lock: direct requests to the box for `/` and `/api/health` answer 403,
     every `traefik.http.routers.*.rule` label on both running containers has a `.middlewares`
     label with `cloudflare-only@file`, and `docker port` is empty for both. On failure it stops
     both apps and exits 1;
   - fails unless, within 3 minutes, `https://enduro-next.vops.pe/api/health` answers `revision`
     = the SHA and `/` answers 200 (both retried in the same loop).

What runs where: `ce-oss-deploy` itself runs no file from the repo on the host. The Coolify build
does run repo code: the Dockerfile `RUN` steps and the build tools (pnpm, turbo, tsc, next) run in
a BuildKit container with host networking (`--network host`, `--add-host` entries for the box
databases). This risk is accepted for staging and recorded in the plan (section 8).

The Coolify token goes into the `coolify` container on stdin and into a curl config file there;
it never appears in a process argv (`/root/ce-oss/capi` does the same for manual API calls).

There is no `workflow_run` trigger and no Coolify webhook: auto-deploy is off on both apps.

## Pieces on the box

| Piece | Value |
|---|---|
| Coolify app `ce-oss-api-staging` | `c6mm7pwdmoysv0eg2vgwo4bi`, `apps/api/Dockerfile`, port 3001, network alias `ce-oss-api-staging`, health check `/api/health` |
| Coolify app `ce-oss-web-staging` | `whfatie8ek3wh09ite3mnqn0`, `apps/web/Dockerfile`, port 3000, `API_INTERNAL_URL=http://ce-oss-api-staging:3001` |
| Database | `ciudad-enduro-oss-postgres-staging` (`zsr9gmrfd3sfdthyxxaikmoc`), Docker network only |
| Revision | Coolify passes `SOURCE_COMMIT` (setting "include source commit in build"); the API Dockerfile bakes it as `BUILD_SHA` |
| Deploy script | `/usr/local/bin/ce-oss-deploy` (root 755) |
| Image verifier | `/usr/local/lib/ce-oss/verify-image.sh` (root 755), the reviewed copy of `scripts/verify-image.sh` |
| State | `/var/cache/ce-oss-deploy/` (root 700): `repo.git` (main only), `lock` |
| Deploy key | `ci-deploy@ciudad-enduro-oss` in `/root/.ssh/authorized_keys` |
| API env | Coolify runtime env on the api app; `BETTER_AUTH_SECRET` and `OTP_HMAC_SECRET` were generated on the box |

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
  docker inspect "$c" -f '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' | grep 'routers\..*\.middlewares'
  docker port "$c"            # empty: no published host port
done
docker port zsr9gmrfd3sfdthyxxaikmoc   # empty
```

Every `routers.*.middlewares` line must contain `cloudflare-only@file`, and the number of
`.middlewares` lines must equal the number of `.rule` lines.

### `ce-oss-deploy` refusals (proved 2026-11-10 with the real key)

```bash
K=~/.secrets/ciudad-enduro-oss_deploy_key
ssh -i $K -o IdentitiesOnly=yes root@104.152.209.8 ls                 # refused: expected one 40-hex commit SHA
ssh -i $K -o IdentitiesOnly=yes root@104.152.209.8 ''                 # refused (same)
ssh -i $K -o IdentitiesOnly=yes root@104.152.209.8 <39 hex chars>     # refused (same)
ssh -i $K -o IdentitiesOnly=yes root@104.152.209.8 '<main sha>; id'   # refused (same)
ssh -i $K -o IdentitiesOnly=yes root@104.152.209.8 <branch sha>       # refused: <sha> is not on main
ssh -i $K -o IdentitiesOnly=yes -N -L 15999:127.0.0.1:8000 root@...   # forward: administratively prohibited
```

## Roll out a new image verifier

A change to `scripts/verify-image.sh` blocks every deploy until the box has the same file. This is
on purpose: the deploy key must not be able to run new code as root.

1. Review the change in its PR, then merge it. The deploy job of that merge fails with
   `differs from the installed /usr/local/lib/ce-oss/verify-image.sh`.
2. On the box, install the reviewed file from `main` and check it:
   ```bash
   C=/var/cache/ce-oss-deploy/repo.git
   git -C $C fetch -q https://github.com/ArkeyWave/ciudad-enduro.git '+refs/heads/main:refs/remotes/origin/main'
   git -C $C show origin/main:scripts/verify-image.sh > /tmp/verify-image.sh
   less /tmp/verify-image.sh            # read it: it runs as root
   install -o root -g root -m 755 /tmp/verify-image.sh /usr/local/lib/ce-oss/verify-image.sh
   ```
3. Re-run the failed deploy job in GitHub Actions.

A change to `docs/operations/ce-oss-deploy` is installed the same way at `/usr/local/bin/ce-oss-deploy`.

## Seed data

The staging database starts empty. One published trail was inserted by hand on 2026-11-10 so the
home page has something to list (`slug = 'staging-demo'`). Run SQL through the DB container:

```bash
docker exec -i zsr9gmrfd3sfdthyxxaikmoc psql -U ciudadenduro_staging -d ciudad_enduro_staging
```

## Rollback

The CI key cannot roll back: `ce-oss-deploy` refuses a SHA that is a strict ancestor of the running
api commit, and sshd passes no `ROLLBACK` variable from the key (`PermitUserEnvironment no`,
`AcceptEnv LANG LC_*`). A redeploy of the running SHA and a newer SHA pass. A running commit that
was never on `main` (a hand deploy of a branch) cannot be ordered, so the guard lets any SHA pass.

Operator procedure, as root on the box:

```bash
# 1. Pick the main commit to go back to and read what it changes in apps/api/drizzle:
#    the database is NOT rolled back; older code must work on the newer schema.
# 2. Its scripts/verify-image.sh must equal /usr/local/lib/ce-oss/verify-image.sh, or the
#    script refuses (install that commit's verifier first, see above, and put it back after).
ROLLBACK=1 SSH_ORIGINAL_COMMAND=<sha> /usr/local/bin/ce-oss-deploy
```

The image `<app-uuid>:<sha>` is reused when it still exists on the box. The next push to `main`
deploys forward again.

## Follow-ups

- `verify-image.sh`: the "empty /app" check never fails in practice (`find /app` prints `/app`
  itself). Require `/app/package.json` instead. This changes the verifier, so it needs a verifier
  roll-out (section above) in the same change.
- Build images in CI, push them to GHCR, and deploy by digest, so the box never runs repo build
  steps (plan section 8; Phase 1, owner decision pending).

## Operator checklist — merge gate for B4

B4 (auth) must not merge until every item is ticked, because the merge deploys auth to a public host.

- [x] Coolify env on the api app: real random `BETTER_AUTH_SECRET` and `OTP_HMAC_SECRET` (48 chars,
      generated on the box 2026-11-10), `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`.
- [x] Google OAuth client has the redirect URI
      `https://enduro-next.vops.pe/api/auth/callback/google` — done 2026-11-10 (owner).
- [x] Resend sender domain of `EMAIL_FROM` is verified — done 2026-11-10 (owner).
- [x] Cloudflare rate-limit rule on `POST /api/auth/email-otp/send-verification-otp` (rule
      `4cf84c7a…`, 5 requests / 10 s per IP, zone `vops.pe`).
