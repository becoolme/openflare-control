# Operations

## Health

`GET /healthz` is unauthenticated and answers `{"ok":true}`. Everything under
`/api/internal/clusters/<cellId>/*` requires `Authorization: Bearer PLANE_TOKEN`
and answers `Cache-Control: no-store`.

The plane is not on the tenant request path. If it is down, cells keep serving
their last accepted snapshot until its 24 h expiry, then fail closed (they
refuse new work rather than serving an unverified document).

## Signing key

The key is derived from `PLANE_SIGNING_SECRET` (HKDF → Ed25519). Its
`keyId`/`publicKey` are printed at startup and must be present in every
component's `trustedKeys`.

Rotation (no downtime):

1. Pick a new secret and start a second plane (or set the new value after
   step 2; the key must be known before cells verify it).
2. Add the new public key to `trustedKeys` in the cell ConfigMaps and roll
   the pods. Old keys keep verifying; nothing is invalidated yet.
3. Switch `PLANE_SIGNING_SECRET`, restart the plane, and publish once.
4. Remove the old key from `trustedKeys` after the new revision is `APPLIED`.

Never remove a key that signed a snapshot a cell may still hold: a cell only
accepts the keys in its config, and an unknown key fails closed.

## Retention

The plane keeps three kinds of operator data, each with a deployment-level
window (set these in the plane's Deployment/env):

| Env                            | Default         | Data                                                                      |
| ------------------------------ | --------------- | ------------------------------------------------------------------------- |
| `PLANE_LOG_RETENTION_DAYS`     | `7`             | ingested worker logs (fallback request/error source)                      |
| `PLANE_OPS_RETENTION_DAYS`     | `30`            | terminal D1/cell ops — the source of op stats; `PENDING` is never deleted |
| `PLANE_METRICS_RETENTION_DAYS` | `14`            | runtime cell reports (metrics + resource snapshot history)                |
| `PLANE_PUBLICATION_KEEP`       | `20`            | terminal-acked publications per cell                                      |
| `PLANE_RETENTION_SWEEP_MS`     | `21600000` (6h) | background sweep interval; `0` disables it                                |

The plane runs the sweep in-process (unref'd timer). The same policy is
available from cron, with per-run overrides:

```sh
DATABASE_URL=... pnpm --filter openflare-plane exec tsx src/maintain.ts \
  --keep 20 --log-days 7 --ops-days 30 --metrics-days 14
```

`POST /api/v1/maintenance/prune` accepts the same overrides for an on-demand
run. Publication pruning deletes terminal rows beyond the newest N per cell and
never touches `PENDING`/`PARTIAL` rows (the cell may still resolve them).
Reducing a window intentionally deletes older metrics/history; the API returns
counts for each table so the action is observable.

## Upgrades

`pnpm --filter openflare-plane migrate` applies `src/schema.sql`, which is
idempotent (`create table/index if not exists`). Upgrading the plane does not
restart cells. Upgrading cells is a normal Deployment rollout; a new cell
re-pulls the latest desired snapshot and ACKs it. A revision fence ensures a
restored plane database can never re-sign a revision a cell already applied.

## Backups

- Postgres: a normal `pg_dump` is enough. The plane state is small
  (publications, versions, hostnames, vars/secrets). Secrets are stored in
  plain text columns by this reference plane — protect the backup like the
  database itself, or store only references and keep values elsewhere.
- Bundles: back up `PLANE_BUNDLE_DIR` (content-addressed; additive).
- Signing secret: back it up separately; losing it means re-trusting a new key
  on every cell.

## Failure modes

| Symptom                           | Cause                                            | Action                                                |
| --------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| cells report 401                  | token rotated out of sync                        | update `vrt-secrets` `cell-token`, roll the cell      |
| desired 404                       | no publication yet                               | run the seed/publish command                          |
| ACK 409 `VRT_ACK_DIGEST_MISMATCH` | plane re-signed while the cell held an older doc | normal during a publish race; the cell retries        |
| ACK 409 `VRT_ACK_TERMINAL`        | conflicting verdict for a terminal revision      | investigate; the first verdict stands                 |
| bundle 404                        | digest not referenced by a retained publication  | check retention/keep-N and the publication history    |
| snapshots expire on cells         | plane down or renewals stopped                   | restore the plane; publish a new revision within 24 h |
