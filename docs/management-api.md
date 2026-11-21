# Management API

The reference plane exposes two API families:

- **cell API** (`/api/internal/clusters/<cell>/vrt/...`) — the scoped channel a
  cell-controller polls ([api.md](api.md));
- **management API** (`/api/v1/...`) — everything an operator or product
  control plane needs to create/read/update/delete resources and drive
  operations over HTTP.

The management API makes the seed/deploy/maintain CLIs optional: the same
state can be produced and inspected over HTTP.

## Auth and shape

- `Authorization: Bearer <PLANE_ADMIN_TOKEN>`; when unset the plane falls back
  to `PLANE_TOKEN` (single-token deployments).
- Every response is `Cache-Control: no-store`.
- Success: `{"data": ...}`.
- Typed failure: `{"data":null,"error":{"code":"...","message":"..."}}`
  (`400` invalid body, `401` token, `404` unknown resource, `409` conflict,
  `413` size, `500` opaque fault).
- JSON bodies are capped at 1 MiB; bundles at `PLANE_MAX_BUNDLE_BYTES`
  (default 128 MiB).

## Resources

### Cells

| Method | Path                                   | Purpose                                                        |
| ------ | -------------------------------------- | -------------------------------------------------------------- |
| GET    | `/api/v1/cells`                        | list cells + revision, capabilities, worker/publication counts |
| POST   | `/api/v1/cells`                        | `{cellId}` create (idempotent)                                 |
| GET    | `/api/v1/cells/{cellId}`               | cell state, counts, latest publication                         |
| GET    | `/api/v1/cells/{cellId}/render-inputs` | vars/secret values for the cell (management view)              |
| DELETE | `/api/v1/cells/{cellId}`               | delete the cell and all cell-scoped rows                       |

### Workers and versions

Workers are addressed by `(teamId, name)`; the stored id is `teamId:name`.

| Method | Path                                               | Purpose                                                  |
| ------ | -------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/cells/{cell}/workers?teamId=`             | list workers                                             |
| POST   | `/api/v1/cells/{cell}/workers`                     | `{teamId,name,entrypoint?,compatibilityDate?}`           |
| GET    | `/api/v1/cells/{cell}/teams/{team}/workers/{name}` | worker + versions + vars + secret keys + hostnames       |
| PATCH  | `.../workers/{name}`                               | `{entrypoint?,compatibilityDate?,status?}`               |
| DELETE | `/api/v1/cells/{cell}/teams/{team}/workers/{name}` | delete worker (cascades versions/vars/secrets/hostnames) |
| GET    | `.../versions`                                     | version history                                          |
| POST   | `.../versions`                                     | create a version (see below)                             |
| POST   | `.../versions/{versionId}/activate`                | activate (rollback = activate an older version)          |

Version body:

```json
{
  "versionId": "v-42",
  "bundleSha256": "<64 hex>",
  "bundleBytes": 1234,
  "mainModule": "index.js",
  "modules": [],
  "compatibilityDate": "2025-01-01",
  "compatibilityFlags": [],
  "crons": [{ "scheduleId": "c1", "expression": "*/5 * * * *" }],
  "quotas": { "cpuMs": 10000, "memoryMb": 128, "subrequests": 50, "outboundConnections": 6 },
  "vars": { "GREETING": "hi" },
  "bindings": [],
  "assetsRouting": null,
  "assetsRunWorkerFirst": []
}
```

The bundle digest must already be uploaded (below); the plane records the
bundle object and the version row with a deterministic bindings fingerprint.

### Vars, secrets, hostnames

| Method         | Path                       | Purpose                                   |
| -------------- | -------------------------- | ----------------------------------------- |
| GET/PUT/DELETE | `.../vars[/{key}]`         | plain vars (`{value}` on PUT)             |
| GET            | `.../secrets`              | secret **names only**                     |
| PUT/DELETE     | `.../secrets/{key}`        | set/remove a secret value                 |
| POST           | `.../hostnames`            | `{hostname}` (global uniqueness enforced) |
| DELETE         | `.../hostnames/{hostname}` | remove a hostname                         |

The reference plane stores secret values in Postgres as delivered. A
production deployment should use an encrypted/KMS-backed store; the port keeps
values out of `desired` and out of reads.

### Bundles

| Method | Path                                    | Purpose                               |
| ------ | --------------------------------------- | ------------------------------------- |
| PUT    | `/api/v1/cells/{cell}/bundles/{sha256}` | raw bytes; digest must match the body |
| GET    | `/api/v1/cells/{cell}/bundles/{sha256}` | download (content-addressed)          |

### Publish and publications

| Method | Path                                           | Purpose                                           |
| ------ | ---------------------------------------------- | ------------------------------------------------- |
| POST   | `/api/v1/cells/{cell}/publish`                 | `{cause?,workerId?,versionId?}` → signed revision |
| GET    | `/api/v1/cells/{cell}/publications?limit=`     | recent revisions + ACK status                     |
| GET    | `/api/v1/cells/{cell}/publications/{revision}` | envelope, digests, ACK details                    |

The publish route needs a signing key (`PLANE_SIGNING_SECRET`); without one it
returns `501`.

### Operations

| Method   | Path                                         | Purpose                                                     |
| -------- | -------------------------------------------- | ----------------------------------------------------------- |
| POST/GET | `/api/v1/cells/{cell}/d1-ops[?status=]`      | enqueue/list D1 ops (`EXECUTE`, `MIGRATIONS_APPLY`, `DROP`) |
| POST/GET | `/api/v1/cells/{cell}/cell-ops[?status=]`    | enqueue/list generic cell ops (workflows, KV, R2, ...)      |
| GET      | `/api/v1/cells/{cell}/logs?workerId=&limit=` | query ingested worker logs                                  |
| POST     | `/api/v1/maintenance/prune`                  | `{keepPerCell}` retention prune                             |

The cell channel pulls pending ops and ACKs them by `seq`:

- `GET /api/internal/clusters/{cell}/vrt/d1-ops` / `POST .../d1-ops/ack`
  (`{acks:[{seq,status,result?,error?}]}`);
- `GET /api/internal/clusters/{cell}/vrt/cell-ops` / `POST .../cell-ops/ack`;
- `POST /api/internal/clusters/{cell}/vrt/logs` dedupes by
  `(workerId,bootId,seq)` and stores the batch for the management log query.

Ops are returned `PENDING` + unexpired in SERIAL order. A cell may re-pull
in-flight ops; dedup is the cell's id/seq contract, unchanged from the runtime
side.

## E2E coverage

`apps/plane/src/api.e2e.test.ts` (Postgres in CI) drives the whole lifecycle:

1. create cell + worker;
2. upload a digest-checked bundle, set a var/secret/hostname;
3. create and activate a version;
4. publish, fetch the cell `desired` and `render-inputs`;
5. ACK the revision and read the publication back;
6. enqueue/pull/ACK a D1 op and a generic cell op;
7. push and query logs;
8. update/delete var, hostname, worker and cell.
