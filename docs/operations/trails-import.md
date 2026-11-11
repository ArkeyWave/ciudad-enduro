# Trail import (GPX)

How the owner gets a ride from the device to a published trail. Plan:
[`docs/plans/2026-11-11-phase-1b-min-gpx-trails.md`](../plans/2026-11-11-phase-1b-min-gpx-trails.md).

Only an account with `role = 'admin'` can upload, edit, publish or hide a trail. There is no API to
change a role; an operator sets it once per environment with SQL (step 1).

## 1. Make the owner an admin (once per environment)

The owner signs in once on the environment first (e-mail code or Google), so that the account row
exists. Then run the SQL in that environment's database.

**Staging** (`enduro-next.vops.pe`), as root on `vops-infra`:

```bash
docker exec -i zsr9gmrfd3sfdthyxxaikmoc psql -U ciudadenduro_staging -d ciudad_enduro_staging
```

**Production** (`enduro.vops.pe`, after P1a-3): open the production database of the Coolify project
`ciudad-enduro-oss` (environment `production`). Read its container name, user and database name in
Coolify, then:

```bash
docker exec -i <production-db-container> psql -U <user> -d <database>
```

In `psql`, the same SQL for both environments:

```sql
UPDATE "user" SET role = 'admin' WHERE email = '<owner e-mail>' RETURNING id, email, role;
```

The result must show exactly one row. Zero rows: the owner has not signed in on this environment yet.
The change applies to the next request; the owner does not sign in again. To take the role away:
`UPDATE "user" SET role = 'rider' WHERE email = '<owner e-mail>';`

## 2. Prepare the GPX file

1. **Trim the start and the end** (privacy, plan D12). Cut the first and the last part of the ride
   so that the track starts and ends away from home. The published path shows every stored point.
   Do this in a GPX editor (for example gpx.studio) and export a new file. The API stores the
   uploaded file as it is, so trim before the upload.
2. **One continuous segment.** The API accepts exactly one `<trk>` with one non-empty `<trkseg>`.
   Some devices write a new segment after each pause; the API then answers `GPX_MULTI_SEGMENT`.
   Merge the segments into one segment in the GPX editor, check the joins on the map (a join draws a
   straight line across the pause), and export again.
3. The file must be UTF-8, at most 10 MiB and at most 100 000 points, and every point must be inside
   Peru. Elevation counts only when every point has an `<ele>`; otherwise the trail has no gain, loss
   or profile.

## 3. Upload, check, publish

1. On the web, open "Nueva ruta" (`/rutas/nueva`, admin only), choose the file and fill in name, city,
   difficulty, type and description. The trail is stored as a **draft**: only an admin sees it.
2. Check the draft page: the map, the distance, the gain and loss, the profile.
3. Publish it ("Publicar"). "Ocultar" hides it again; there is no delete in the API.

Error codes of the upload (HTTP 400 unless stated):

| Code | Meaning |
|------|---------|
| `GPX_INVALID` | Not UTF-8, a DOCTYPE, malformed XML, root is not `gpx`, or a point without a valid `lat`/`lon` |
| `GPX_EMPTY` | Fewer than 2 points, or a total distance of 0 |
| `GPX_TOO_LARGE` | More than 100 000 points (a file above 10 MiB gets HTTP 413) |
| `GPX_MULTI_SEGMENT` | More than one track or more than one non-empty segment (step 2.2) |
| `GPX_OUT_OF_AREA` | A point outside Peru |
| `SLUG_EMPTY` | The name has no letter or digit |
| `GPX_DUPLICATE` (409) | This exact file is already imported; the response gives its `slug` |
| `SLUG_TAKEN` (409) | The name and its suffixes `-2` … `-5` are all taken; choose another name |

## 4. Calibration on staging (before the first production import, plan D11)

1. Import one earlier real ride on staging.
2. Compare with the device: distance within 3 %, gain within 10 %. The device totals are a
   comparison, not the truth.
3. Gain too high: raise `ELEVATION_THRESHOLD_M` in `apps/api/src/trails/gpx/metrics.ts` (up to 10 m),
   deploy, and import again. Still too high: a median spike filter (a code change). Distance off by
   more than 3 %: a minimum-step filter (a code change).
4. Delete the staging import (step 5) before each new import of the same file: the same file twice
   answers `GPX_DUPLICATE`.
5. Freeze the algorithm before the production import of the Sunday rides.

## 5. Delete a trail on staging

There is no delete endpoint. On staging only, in `psql` (step 1):

```sql
DELETE FROM trails WHERE slug = '<slug>' RETURNING id;
-- The source row goes with it (ON DELETE CASCADE). Both counts must be 0:
SELECT (SELECT count(*) FROM trails WHERE slug = '<slug>') AS trails,
       (SELECT count(*) FROM trail_sources WHERE trail_id = '<id from above>') AS sources;
```

In production an admin hides a trail instead.
