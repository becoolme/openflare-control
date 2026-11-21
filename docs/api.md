# Cell API

This is the scoped cell channel. For operator/product CRUD (cells, workers,
versions, vars/secrets/hostnames, bundles, publish, ops, logs) see
[management-api.md](management-api.md).

All routes are under `/api/internal/clusters/<cellId>/vrt` and require
`Authorization: Bearer <PLANE_TOKEN>` unless noted. Responses are
`Cache-Control: no-store`. Typed errors use
`{"data":null,"error":{"code":"...","message":"..."}}`.
`<cellId>` must equal the cell id configured on the cell (`VRT_CELL_ID`); it is
never taken from a request body.

| Method | Path                | Purpose                                                             |
| ------ | ------------------- | ------------------------------------------------------------------- |
| GET    | `/healthz`          | liveness (no auth)                                                  |
| GET    | `/desired`          | latest signed `compute.desired` envelope                            |
| POST   | `/desired/ack`      | record the cell's verdict for one revision                          |
| GET    | `/render-inputs`    | vars and secret values for this cell                                |
| GET    | `/bundles/{sha256}` | bundle bytes (only if a retained publication references the digest) |
| GET    | `/d1-ops`           | pending D1 ops (reference plane: empty)                             |
| POST   | `/d1-ops/ack`       | D1 op results (reference plane: accepted, none applied)             |
| GET    | `/cell-ops`         | pending generic cell ops (reference plane: empty)                   |
| POST   | `/cell-ops/ack`     | cell-op results (reference plane: accepted, none applied)           |
| POST   | `/logs`             | worker log batches (reference plane: accepted, dropped)             |

## `GET /desired`

Returns the stored signed envelope verbatim (the cell verifies these exact
bytes). `404 VRT_DESIRED_NOT_FOUND` when the cell has never been published to.

```json
{
  "version": 1,
  "canonicalVersion": 1,
  "kind": "compute.desired",
  "scope": "cell:prod-cell-1",
  "revision": 42,
  "issuedAt": "2026-11-21T00:00:00.000Z",
  "expiresAt": "2026-11-21T01:00:00.000Z",
  "keyId": "0123456789abcdef01234567",
  "payloadDigest": "<sha256 of canonical payload>",
  "payload": { "schemaVersion": 1, "cellId": "prod-cell-1", "revision": 42, "tenants": [] },
  "signature": "<base64 Ed25519>"
}
```

## `POST /desired/ack`

Body (`.strict()`, unknown fields are a malformed ack):

```json
{
  "revision": 42,
  "payloadDigest": "<64 hex>",
  "envelopeDigest": "<64 hex over the canonical signed envelope>",
  "fenceRevision": 42,
  "status": "APPLIED",
  "reason": "tenant-failed",
  "capabilities": { "cron": true, "assets": true, "kv": true },
  "tenantFailures": [{ "tenant": "t1", "workerIds": ["w1"], "code": "switch-failed" }],
  "podsApplied": true
}
```

- `payloadDigest`/`envelopeDigest` must match the stored publication →
  otherwise `409 VRT_ACK_DIGEST_MISMATCH`.
- Unknown revision → `404 VRT_ACK_UNKNOWN_REVISION`.
- Terminal revisions accept an identical replay (`200`) and refuse a different
  verdict (`409 VRT_ACK_TERMINAL`).
- `capabilities` replaces the stored set (absent leaves it untouched).
- `tenantFailures` are diagnostics, bounded and sanitized; they never carry
  authority by themselves.

Response: `{"data":{"revision":42,"ackStatus":"APPLIED","ackedAt":"..."}}`.

## `GET /render-inputs`

```json
{
  "fingerprint": "<sha256 of the tenant map>",
  "tenants": { "t1": { "vars": { "GREETING": "hi" }, "secrets": { "API_KEY": "..." } } }
}
```

Only tenants with a serving VRT worker on this cell appear. Values leave the
plane only over the authenticated channel; they are never part of `desired`.

## `GET /bundles/{sha256}`

Serves `application/octet-stream` for a digest referenced by one of the cell's
retained publications. Unreferenced and absent digests are both `404` (no
existence oracle). Bundles above `PLANE_MAX_BUNDLE_BYTES` (default 128 MiB) are
refused with `413`.

## Status codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| 400  | malformed JSON / schema                                  |
| 401  | missing or wrong bearer token                            |
| 404  | unknown cluster, revision, digest, or no publication yet |
| 409  | digest mismatch or terminal ACK conflict                 |
| 413  | payload or bundle over the configured limit              |
| 500  | plane fault (logged; body stays opaque)                  |
| 501  | a port method the reference plane does not implement yet |
