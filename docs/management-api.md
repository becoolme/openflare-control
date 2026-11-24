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

- `Authorization: Bearer <PLANE_ADMIN_TOKEN>` — required at boot and at least
  32 characters. There is no shared cell token: each cell holds its own
  pull credential issued by `POST /api/v1/cells/:cellId/token`.
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
| POST   | `/api/v1/cells/{cellId}/token`         | issue/rotate the cell pull token; plaintext returned once      |
| GET    | `/api/v1/cells/{cellId}`               | cell state, counts, latest publication                         |
| GET    | `/api/v1/cells/{cellId}/render-inputs` | vars/secret values for the cell (management view)              |
| DELETE | `/api/v1/cells/{cellId}`               | delete the cell and all cell-scoped rows                       |

### Teams and quotas

| Method           | Path                     | Purpose                                         |
| ---------------- | ------------------------ | ----------------------------------------------- |
| GET/POST         | `/api/v1/teams`          | list/create teams (default quota row)           |
| GET/PATCH/DELETE | `/api/v1/teams/{teamId}` | read/update plan+quotas; delete only when empty |

Quota fields: `requestsMonth`, `cpuMsMonth`, `workersMax`.

### Workers and versions

Workers are addressed by `(teamId, name)`; the stored id is `teamId:name`.

| Method | Path                                               | Purpose                                                  |
| ------ | -------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/cells/{cell}/workers?teamId=`             | list workers                                             |
| POST   | `/api/v1/cells/{cell}/workers`                     | `{teamId,name,entrypoint?,compatibilityDate?}`           |
| GET    | `/api/v1/cells/{cell}/teams/{team}/workers/{name}` | worker + versions + vars + secret keys + hostnames       |
| GET    | `.../workers/{name}/durable-objects`               | active version's exported classes + `DO` bindings        |
| PATCH  | `.../workers/{name}`                               | `{entrypoint?,compatibilityDate?,status?}`               |
| DELETE | `/api/v1/cells/{cell}/teams/{team}/workers/{name}` | delete worker (cascades versions/vars/secrets/hostnames) |
| GET    | `.../versions`                                     | version history                                          |
| POST   | `.../versions`                                     | create a version (see below)                             |
| POST   | `.../versions/{versionId}/activate`                | activate (rollback = activate an older version)          |
| POST   | `.../workers/{name}/deploy`                        | create version + optional activate/publish in one call   |

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
  "quotas": { "cpuMs": 10000, "memoryMb": 128, "subrequests": 50, "outboundConnections": 16 },
  "vars": { "GREETING": "hi", "COUNT": 3, "CONFIG": { "mode": "x" } },
  "bindings": [],
  "queueConsumers": [{ "queueId": "<26>", "queueName": "jobs", "maxBatchSize": 10 }],
  "tailConsumers": ["demo:log-sink"],
  "streamingTailConsumers": [],
  "versionMetadata": "CF_VERSION_METADATA",
  "observability": {
    "enabled": true,
    "logsEnabled": true,
    "invocationLogs": false,
    "headSamplingRatePpm": 250000
  },
  "exportedClassNames": ["MyDO"],
  "assetsRouting": null,
  "assetsRunWorkerFirst": []
}
```

The bundle is the runtime's canonical stored document (produced by
`buildRuntimeBundle` / `vrt`); the object key is the manifest digest, not
sha256(document bytes). The bundle **must already be uploaded** (below). `POST /versions` and
`POST /deploy` fail closed with `409 VRT_BUNDLE_NOT_UPLOADED` when the digest
has no uploaded object, and `409 VRT_BUNDLE_SIZE_MISMATCH` when the claimed
`bundleBytes` differs from the stored size.

`POST /workers/{name}/deploy` accepts the same body plus `activate` (default
`true`) and `publish` (default `false`). It creates the version, activates it,
and optionally publishes the cell, returning
`{version,created,activated,revision}`. The returned `version.versionId` is
authoritative: identical content (bundle + the full runtime-config
fingerprint — bindings, vars, crons, queue consumers, tails, observability,
version metadata, assets routing, quotas) reuses the existing version row
instead of creating a duplicate.

`vars` accepts strings and JSON values. Strings stay worker-scoped and are
served through `render-inputs`; non-strings become version-scoped
`jsonVars` and render as `{"type":"json"}` bindings. Tail consumers must be
existing workers of the same team and cell; the two tail channels cannot
contain the same worker.

`PATCH /workers/{name}` metadata (including `status`) changes the stored row;
call `POST /publish` for it to reach the cell. Only `status='ACTIVE'` workers
are included in `compute.desired`; `SUSPENDED`/`DELETED` workers stop serving
after the next publish.

### Secrets Store

`PUT /api/v1/cells/{cell}/teams/{team}/secrets-store/{storeId}/{secretName}`
with `{value}` stores an encrypted team-level secret; `GET` lists names and
`DELETE` removes one (409 while a version references it).
`SECRETS_STORE` bindings carry `storeId`/`secretName`; `render-inputs` exposes
the value under `secrets-store:{storeId}:{secretName}`. The cell must
advertise the `secretsStore` capability.

### Flagship apps

`GET /api/v1/cells/{cell}/teams/{team}/flagship/apps` lists apps;
`PUT .../apps/{appId}` accepts `{config}` (validated by the portable Flagship
model and stored canonically); `DELETE .../apps/{appId}` removes it. Apps for
teams with workers on the cell ride `compute.desired` as
`tenants[].flagshipApps`, and `FLAGSHIP` bindings must name a declared app.

### Static assets

Upload the provider-format manifest and its objects first:

- `PUT /api/v1/cells/{cell}/teams/{team}/assets/objects/{sha256}` (raw bytes,
  sha256-checked)
- `PUT /api/v1/cells/{cell}/teams/{team}/assets/manifests/{sha256}` (canonical
  manifest JSON, every listed object must already exist)

The reference plane stores the provider-format content-addressed objects
under `PLANE_ASSET_DIR` and serves them to the cell over the authenticated
cell channel:
`GET /api/internal/clusters/{cell}/vrt/assets/{manifests,objects}/{digest}`.
The cell pulls only digests referenced by its retained publications.
`ASSETS` bindings reference the manifest digest, and `assetsRouting` /
`assetsRunWorkerFirst` control assets-first routing.

### Durable Object classes

`GET/POST/DELETE .../workers/{name}/durable-object-classes[/{className}]`
manages the classes a worker declares. POST accepts
`{className, enableSql?, transferFromWorkerId?}`; `enableSql` defaults to true.
`POST .../durable-object-classes/migrations` applies
`{newClasses?, newSqliteClasses?, renamedClasses?, deletedClasses?}` in one
transaction; `transferredClasses` is rejected. Declared classes are emitted as
`durableObjectClasses[]` in `compute.desired`, and DO bindings must target a
declared class in the same team/cell.

### Vars, secrets, hostnames

| Method         | Path                       | Purpose                                   |
| -------------- | -------------------------- | ----------------------------------------- |
| GET/PUT/DELETE | `.../vars[/{key}]`         | plain vars (`{value}` on PUT)             |
| GET            | `.../secrets`              | secret **names only**                     |
| PUT/DELETE     | `.../secrets/{key}`        | set/remove a secret value                 |
| POST           | `.../hostnames`            | `{hostname}` (global uniqueness enforced) |
| DELETE         | `.../hostnames/{hostname}` | remove a hostname                         |

`PUT .../vars` updates the worker-level var table immediately. Activating a
version replaces the whole worker var set with that version's `vars` (CF
version semantics), so direct PUT writes are for bootstrap/pre-version edits;
put versioned configuration in the version body. Env names must be unique
across vars, secrets, bindings, `jsonVars`, and `versionMetadata`.

The reference plane encrypts secret values in Postgres with AES-256-GCM
(`enc:v1:<iv>:<tag>:<ciphertext>`) under the dedicated `PLANE_SECRETS_KEY`.
Values written before encryption are re-sealed on their first read. The port
still keeps values out of `desired` and out of secret-name reads; only
`render-inputs` reveals them.

### Bundles

| Method | Path                                    | Purpose                                                                                                                                                                                           |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | `/api/v1/cells/{cell}/bundles/{digest}` | runtime stored document; `digest` is sha256(canonical manifest) and the inner `digest` is re-verified. Legacy raw bytes whose sha256 equals the path are accepted for control-plane-only fixtures |
| GET    | `/api/v1/cells/{cell}/bundles/{sha256}` | download (content-addressed)                                                                                                                                                                      |

### Service resources

Each service has a resource table plus a data channel. Data operations are
asynchronous cell-ops, so they return `{opId, channel}` (`202`) and the caller
polls `GET /api/v1/cells/{cell}/ops/{opId}?waitMs=`.

| Service   | Resource endpoints                                              | Data/ops                                                                                              |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D1        | `GET/POST /d1/databases`, `GET/DELETE /d1/databases/{id}`, `GET .../promotions` | `POST .../query {sql,params?}`, `POST .../migrations {migrations}`, `POST .../promote`, `GET .../ops` |
| R2        | `GET/POST /r2/buckets`, `DELETE /r2/buckets/{name}`             | `POST .../ops {kind,payload}` for `R2_LIST/HEAD/GET/PUT/DELETE`; `GET .../ops`                        |
| KV        | `GET/POST /kv/namespaces`, `DELETE /kv/namespaces/{id}`         | `POST .../ops {kind,payload}` for `KV_GET/PUT/DELETE/LIST/BULK_PUT/BULK_DELETE`; `GET .../ops`        |
| Queues    | `GET/POST /queues`, `PATCH/DELETE /queues/{id}`                 | metadata only; producers/consumers are worker bindings (queue send stays on the data plane)           |
| Workflows | `GET/POST/DELETE .../workers/{name}/workflows[/{wf}]`           | `POST .../workflows/{wf}/ops` for `WF_CREATE/GET/ACTION/EVENT/DELETE`; `GET .../ops`                  |
| Vectorize | `GET/POST /vectorize/indexes`, `DELETE /vectorize/indexes/{id}` | `GET .../{id}/binding`; DELETE queues `STORAGE_PURGE` and returns `202 {opId}`                        |

Vectorize indexes are cell/team-scoped; `GET .../{id}/binding` returns a
ready binding. `index_id` includes a per-incarnation component, so deleting
and re-creating an index never reopens the previous physical index. DELETE
requires the cell to claim both `storagePurge` and `vectorizePurge`, queues a
`STORAGE_PURGE {storage:"vectorize", storageId, tenantId}` cell op, and returns
`202 {opId, channel:"cell", status:"PURGE_PENDING"}`. The index row is removed
only when the cell ACKs a complete purge; an incomplete bounded pass is
redispatched, and FAILED/EXPIRED leaves the row for the caller to retry.
Deploying a `VECTORIZE` binding requires a cell new enough to parse the
vectorize wire variant.

Workflow declarations and Durable Object classes are **worker-scoped** in the
reference plane, not snapshot-version-scoped: activating or rolling back a
version does not restore the declaration rowset. Re-POST the desired
declarations/migrations when rolling back across a declaration change. The
portable store contract supports version-scoped application
(`applyWorkflowDeclarations` / `applyDoClasses`) for product control planes such
as Vibeploy; the minimal reference plane intentionally keeps them worker-level.

Workflow declarations are worker-scoped in the reference plane: POST accepts
`{name, className, binding?, limitsSteps?, scriptName?, defaultRetention?, concurrencyLimit?}`.
A POST is a full replacement: omitted `binding` resets to `name` (which must
itself be a valid JS identifier, so hyphenated names need an explicit binding),
and omitted `scriptName` makes the declaration same-worker. `scriptName` must
name an active same-team/cell VRT worker. Declarations are published in the next
`compute.desired`; activating an older version does not roll the declaration
rowset back. The cell must advertise `workflows` (and `workflowsCrossWorker`
for cross-worker declarations); the write is rejected with
`409 VRT_CELL_CAPABILITY_MISSING` otherwise.

`defaultRetention` accepts `{successRetention?, errorRetention?}` as whole
milliseconds or duration strings such as `"3 days"` (max 30 days) and cannot be
combined with `scriptName`. `concurrencyLimit` lowers the per-Workflow active
instance cap (1–4,500; default 4,500). Both are emitted into the signed
workflow declaration; older cells reject unknown fields, so only target cells
with matching runtime support.

`GET /api/v1/cells/{cell}/services` returns every resource with a ready-to-paste
canonical `VrtBindingRecord` (uppercase `type`, `resourceId`, permissions), plus
workflow metadata.

R2/KV payload scope (`tenantId`, physical `bucketId`/`namespaceId`) is resolved
server-side and injected; a client-supplied scope is rejected. `R2_DELETE` takes
`{keys: [...]}`; `R2_PUT` takes `{key, bodyBase64, contentType?}`; KV values use
`valueBase64` (see the runtime cell-op shapes).

### Publish and publications

| Method | Path                                           | Purpose                                           |
| ------ | ---------------------------------------------- | ------------------------------------------------- |
| POST   | `/api/v1/cells/{cell}/publish`                 | `{cause?,workerId?,versionId?}` → signed revision |
| GET    | `/api/v1/cells/{cell}/publications?limit=`     | recent revisions + ACK status                     |
| GET    | `/api/v1/cells/{cell}/publications/{revision}` | envelope, digests, ACK details                    |

The publish route needs a signing key (`PLANE_SIGNING_SECRET`); without one it
returns `501`.

### Operations

| Method   | Path                                         | Purpose                                                                                          |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| POST/GET | `/api/v1/cells/{cell}/d1-ops[?status=]`      | enqueue/list D1 ops (`EXECUTE`, `MIGRATIONS_APPLY`, `DROP`, `PROMOTE`)                           |
| POST/GET | `/api/v1/cells/{cell}/cell-ops[?status=]`    | enqueue/list workflow ops (`WF_*`); R2/KV/D1 ops go through the per-resource `.../ops` endpoints |
| GET      | `/api/v1/cells/{cell}/ops/{opId}?waitMs=`    | unified op lookup/long-poll (D1 or cell channel)                                                 |
| GET      | `/api/v1/cells/{cell}/logs?workerId=&limit=` | query ingested worker logs                                                                       |
| POST     | `/api/v1/maintenance/prune`                  | `{keepPerCell}` retention prune                                                                  |

`POST .../d1/databases/{id}/promote` queues a manual writer promotion
(`{expectedEpoch?, expectedLsn?, generation?, writerAddr?, reason?, expiresAt?}`;
epoch/lsn must be supplied together). The cell executes it through
`[d1sql].promoteEndpoint` on the follower and ACKs the promoted epoch/lsn.
On a `DONE` ACK the plane monotonic-CASes `writer_epoch`/`writer_addr` on
`plane_d1_databases`, allocates a new revision and republishes the signed
desired document; the provider switches writes to `writerAddr` on the next
snapshot pull. `writerAddr` is supplied by the operator (the runtime cannot
know the serving address).

`GET .../d1/databases/{id}/promotions` returns the current writer tuple
(`epoch`, `addr`, `lsn`, `updatedAt`) plus the latest 50 `PROMOTE` ops with
their status/result/error — the read model for a console writer/promotion
panel.

The cell channel pulls pending ops and ACKs them by `seq`:

- `GET /api/internal/clusters/{cell}/vrt/d1-ops` / `POST .../d1-ops/ack`
  (`{acks:[{seq,status,result?,error?}]}`, status `DONE` / `FAILED` / `EXPIRED`;
  the response also reports `published` when a PROMOTE caused a new desired
  revision);
- `POST /api/internal/clusters/{cell}/vrt/d1-writer` (`{databaseId, epoch,
lsn?, writerAddr?, cause?}`) — the cell's automatic-failover report; applies
  the monotonic writer CAS and republishes the signed desired document;
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

`apps/plane/src/services.e2e.test.ts` separately exercises D1 query/migrations,
R2/KV ops (scope injection rejection), queue delay updates, workflow
declarations + instance ops, the service catalog, unified op polling, and
validation/missing-resource branches.

These two files call Hono's `app.request()` in-process against a real Postgres
(CI `plane` job) — they are API/integration tests, not deployment tests.

## Real deployment e2e (Docker)

`scripts/e2e-docker.mjs` talks to the **built `openflare-plane` container over
HTTP** with a real Postgres behind it:

```sh
PLANE_ADMIN_TOKEN=... PLANE_SIGNING_SECRET=... PLANE_SECRETS_KEY=... \
  CONSOLE_AUTH_PASSWORD=... docker compose up -d --build
PLANE_ADMIN_TOKEN=... PLANE_SECRETS_KEY=... CONSOLE_AUTH_PASSWORD=... \
  pnpm test:e2e:docker
```

The plane applies the idempotent schema at boot (`PLANE_MIGRATE_ON_BOOT=0`
opts out for least-privilege DB roles). CI's `e2e-docker` job runs exactly
that sequence (compose up, script, logs on failure, compose down). It covers
the same lifecycle plus a real
content-addressed bundle volume, real HTTP routing and the signed publish path.

## Real Kubernetes e2e (kind)

`scripts/e2e-kind.sh` creates (or reuses) a kind cluster, builds and loads the
plane image, applies `deploy/k8s/e2e/plane.yaml` (Postgres + plane + Secret),
waits for rollout (the plane applies the schema at boot), port-forwards the
Service and executes the same HTTP lifecycle as the Docker e2e.

```sh
PLANE_ADMIN_TOKEN=... PLANE_SIGNING_SECRET=... PLANE_SECRETS_KEY=... \
  CONSOLE_AUTH_PASSWORD=... pnpm test:e2e:kind
```

CI's `e2e-kind` job runs this on `ubuntu-24.04` with `helm/kind-action`. Scope:
the **plane** on real Kubernetes networking. It does not deploy the four
openflare runtime images or a workerd cell; the production cell overlay remains
a render gate (`k8s` job) plus `vrt-k8s-check`.
