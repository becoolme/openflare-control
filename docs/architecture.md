# Architecture

## Layers

```
tenant request ─▶ Traefik ─▶ vrt-host (per cell pod)
                                │  workerd processes, one per tenant
                                │  vrt-provider sidecar (KV/R2/queues/rate limits)
                                └─ cell-controller: pulls signed desired, ACKs
                                        ▲
                                        │ HTTPS + scoped bearer token
                                   openflare-plane (this repo)
                                        │
                                   Postgres (plane state)
                                   S3/FS (bundles, assets)
```

The plane is **not** on the tenant request path. It publishes signed desired
state, serves bundle bytes, and stores ACKs. A cell keeps serving its last
accepted snapshot until it expires (24 h protocol maximum).

## Package boundary

`openflare-control` contains only what both compositions must agree on:

- `cellContract` / `cellSync`: ACK and desired wire shapes, the ACK state
  machine (`recordDesiredAck`, `latestDesiredEnvelope`), diagnostics.
- `computeDesired` / `snapshotSigner` / `canonicalSnapshot`: the desired
  document and the exact bytes a cell verifies.
- `vrtStorePort` / `bundleStorePort` / `domainTypes`: the persistence and
  object-store contracts.
- `storeConformance`: the cases any store must pass.

Everything else (HTTP glue, auth, quota policy, console, billing) stays in
the composition. That is deliberate: a ports-injected router would need a
dozen adapter seams longer than the routes themselves.

## Data model (reference plane)

`plane_cells` (revision counter + capabilities), `plane_workers`,
`plane_versions` (content-addressed, idempotent by
`(worker, bundleSha256, bindingsFingerprint)`), `plane_publications`
(unique `(cell, revision)`, ack state machine), `plane_vars`, `plane_secrets`,
`plane_hostnames`, `plane_bundle_objects`, `plane_cell_ops`, `plane_d1_ops`.

`runCellTransaction` takes `SELECT ... FOR UPDATE` on the cell row, so revision
allocation and publication are serialized exactly like the Prisma store.

## Failure behaviour

- Unknown/expired desired → the cell keeps its last snapshot until expiry,
  then fails closed (refuses new work).
- ACK digest or revision mismatch → typed 409; the cell retries.
- Bundle fetch for an unreferenced digest → 404, indistinguishable from
  absent (no existence oracle).
- Signing failures never publish: the transaction rolls back, the previous
  revision keeps serving.
