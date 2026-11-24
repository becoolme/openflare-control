# Operations

## Health

`GET /healthz` is unauthenticated and answers `{"ok":true}`. Everything under
`/api/internal/clusters/<cellId>/*` requires `Authorization: Bearer
<cell-token>` — a per-cell credential issued (and rotated) by the admin-only
`POST /api/v1/cells/:cellId/token` endpoint; only the sha256 is stored.
Answers carry `Cache-Control: no-store`.

The plane is not on the tenant request path. If it is down, cells keep serving
their last accepted snapshot until its 24 h expiry, then fail closed (they
refuse new work rather than serving an unverified document).

## Transport security (TLS)

The plane and console speak plain HTTP. Everything on the wire is sensitive:
bearer tokens authenticate the plane's cell and management APIs, the console's
HTTP Basic credential gates its proxied management surface, and the cell
channel's render-inputs carries worker **secrets in cleartext** by design (cells
must inject them as bindings). Therefore:

- **Loopback and cluster-internal hops are fine without TLS.** The compose
  defaults bind the published plane/console/Postgres ports to `127.0.0.1`;
  pod-to-pod traffic inside one trust domain stays on the cluster network.
- **Any hop leaving the host/cluster boundary must be TLS-terminated** — a
  reverse proxy or ingress in front of the plane/console, or a service mesh
  doing mTLS. Never expose a bearer- or Basic-authenticated endpoint over
  plaintext HTTP to a shared network: the credential grants full access to
  anyone who sniffs it.
- `*_BIND=0.0.0.0` on the compose ports is the deliberate opt-out — use it
  only behind a TLS terminator or on a fully trusted network.

## Secrets at rest

`PLANE_SECRETS_KEY` (at least 32 characters) roots the AES-256-GCM cipher for
`plane_secrets.value`. It is required at boot and must not be derived from or
rotated with the signing key: a signing-key rotation would otherwise make every
stored secret unreadable. Pre-encryption plaintext rows are re-sealed on their
first `render-inputs` read.

## Signing key

The key is derived from `PLANE_SIGNING_SECRET` (HKDF → Ed25519). Its
`keyId`/`publicKey` are printed at startup and must be present in every
component's `trustedKeys`. The secret must be at least 32 characters and
the floor is enforced at boot — an existing deployment upgraded to a
release with this check refuses to start until the secret is lengthened
(a new secret produces a new key, so follow the rotation steps below).

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

| Env                            | Default         | Data                                                                                                                                    |
| ------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PLANE_LOG_RETENTION_DAYS`     | `7`             | ingested worker logs (fallback request/error source)                                                                                    |
| `PLANE_OPS_RETENTION_DAYS`     | `30`            | terminal D1/cell ops — the source of op stats; unexpired `PENDING` is never deleted; expired `PENDING` is reclaimed after a 1-day grace |
| `PLANE_METRICS_RETENTION_DAYS` | `14`            | runtime cell reports (metrics + resource snapshot history)                                                                              |
| `PLANE_ASSET_RETENTION_DAYS`   | `7`             | unreferenced asset manifests/objects (referenced ones are never deleted)                                                                |
| `PLANE_PUBLICATION_KEEP`       | `20`            | terminal-acked publications per cell                                                                                                    |
| `PLANE_RETENTION_SWEEP_MS`     | `21600000` (6h) | background sweep interval; `0` disables it                                                                                              |

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
counts for each table (`expiredD1OpsDeleted`/`expiredCellOpsDeleted` cover
deadline-passed ops that can never be dispatched) so the action is observable.

## Upgrades

The plane applies `src/schema.sql` at boot by default
(`PLANE_MIGRATE_ON_BOOT=0` disables it for least-privilege DB roles); the
schema is idempotent (`create table/index if not exists`), and
`pnpm --filter openflare-plane migrate` remains the out-of-band path.
Upgrading the plane does not restart cells. Upgrading cells is a normal Deployment rollout; a new cell
re-pulls the latest desired snapshot and ACKs it. A revision fence ensures a
restored plane database can never re-sign a revision a cell already applied.

## Backups

- Postgres: a normal `pg_dump` is enough. The plane state is small
  (publications, versions, hostnames, vars/secrets). Worker secrets are
  encrypted at rest, but the database still contains their ciphertext — protect
  the backup like the database itself.
- `PLANE_SECRETS_KEY`: back it up separately. It is independent of the signing
  secret. Losing it means every worker secret must be re-entered; rotating it
  requires re-encrypting the values first.
- Bundles: back up `PLANE_BUNDLE_DIR` (content-addressed; additive).
- Signing secret: back it up separately; losing it means re-trusting a new key
  on every cell.

## Failure modes

| Symptom                           | Cause                                            | Action                                                |
| --------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| cells report 401                  | token rotated out of sync                        | update `vrt-secrets` `cell-token`, roll the cell      |
| render-inputs 500                 | `PLANE_SECRETS_KEY` changed or lost              | restore the key; otherwise re-enter every secret      |
| desired 404                       | no publication yet                               | run the seed/publish command                          |
| ACK 409 `VRT_ACK_DIGEST_MISMATCH` | plane re-signed while the cell held an older doc | normal during a publish race; the cell retries        |
| ACK 409 `VRT_ACK_TERMINAL`        | conflicting verdict for a terminal revision      | investigate; the first verdict stands                 |
| bundle 404                        | digest not referenced by a retained publication  | check retention/keep-N and the publication history    |
| snapshots expire on cells         | plane down or renewals stopped                   | restore the plane; publish a new revision within 24 h |
