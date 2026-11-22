# Changelog

## 2026-11-22 — re-pin the wire contract to OpenFlare `5751f90`

- Bumped `OPENFLARE_CONTRACT_REV` from `99a834b` to `5751f90` (versioned
  preview URLs, the `vrt` → `of` CLI rename and version-metadata projection).
- No wire fixture changed: the cell's `AckReport` / `AckCapabilities` and
  `CellReport` are byte-identical between the two revisions, so the vendored
  `desired-ack-*` and `cell-report` fixtures and the derived capability schema
  stayed as they were.
- The desired snapshot gained one strictly optional field, `workers[].preview`
  (`PreviewDesired { workerId, versionId }`, plus the `MAX_PREVIEWS_PER_WORKER`
  bound). Version previews are not implemented in the plane yet, so it is left
  unemitted; `versionMetadata` remains the recognized-but-not-required bit for
  the `activeVersion` `tag`/`createdAt` projection (also unemitted).

## 2026-11-22 — sync the wire contract to OpenFlare main

- Re-pinned `OPENFLARE_CONTRACT_REV` to OpenFlare `99a834b` and refreshed the
  vendored `desired-ack-*` fixtures (runtime merged quotas, service props,
  queue delivery delay, secrets store, version metadata, k2, email, images,
  vectorize, tail consumers and more).
- Accepted the new ACK capability bits `secretsStore` and `versionMetadata` in
  the strict (derived) capability schema. The plane does not emit either wire
  field yet, so both are recognized-but-not-required; without this a healthy
  cell reporting them would have had its whole ACK rejected.
- `scripts/check-openflare-contract.mjs --write` now reformats the copied
  fixtures with Prettier, so a sync no longer trips `pnpm format:check`.
- Drift guards: the control contract test discovers every vendored
  `desired-ack-*.json` from disk and validates it, and the plane validates the
  vendored `cell-report.json` against the ingest schema without a database.

## 2026-11-22 — full-stack execution e2e

- Added the runtime bundle format (`buildRuntimeBundle` /
  `verifyRuntimeBundle`): the object key is sha256(canonical manifest) and the
  inner stored-document digest is re-derived. `PUT /bundles/{digest}` accepts
  it (legacy raw fixture bytes remain accepted for control-plane-only tests);
  `DirBundleStore` stores by the key digest, not sha256(body).
- Added `scripts/e2e-fullstack.mjs` and the `e2e-fullstack` CI job: management
  API → real cell-controller → real vrt-host → pinned workerd → ingress, v1
  response, redeploy v2, v2 response.
- Runtime fix (openflare#77): control-event socket names accept
  `sock-<teamId>:<workerName>` (colon) and the 256-byte bound, otherwise a real
  cell rejected the listen event as `control`/circuit-open.

## 2026-11-22 — worker deploy lifecycle

- Added `POST /cells/{cell}/teams/{team}/workers/{name}/deploy`: create a
  version, optionally activate and publish in one call.
- Version creation now fails closed unless the content-addressed bundle was
  uploaded (`409 VRT_BUNDLE_NOT_UPLOADED`) and the claimed `bundleBytes`
  matches (`409 VRT_BUNDLE_SIZE_MISMATCH`).
- `SUSPENDED`/`DELETED` worker status is honored by `compute.desired` (only
  `ACTIVE` workers are published); the metadata change takes effect on the
  next `POST /publish`.
- `DirBundleStore.has` is a stat probe instead of reading the whole bundle.
- Added a worker lifecycle e2e: upload → deploy/publish → suspend → activate
  → delete, plus missing-bundle and size-mismatch edges.

## 2026-11-22 — runtime metrics/report collection

- Added the cell report wire contract (`fixtures/vrt-wire/cell-report.json`)
  and ingest endpoint `POST /api/internal/clusters/{cell}/vrt/metrics`.
- Metrics now come from the runtime: request/error/latency/CPU/cold-start
  deltas (logs remain a fallback before the first report).
- D1 size/tables/pages, queue backlog/visible/in-flight/delayed/DLQ,
  Workflow/DO instance ids/storage are real.
- Workflow/DO instance listings replaced the typed 501s.
- R2 object/size stats are fetched on demand with a read-only `R2_STATS`
  cell op (cached; `waitMs` requests a refresh).
- Per-worker CPU/cold starts, queue `delivered`, workflow per-state counters
  and DO active instances remain `null` with explicit notes.
- Added `PLANE_METRICS_RETENTION_DAYS` (14) and metrics pruning.
- Console: live worker latency, D1 size/tables, R2 objects/size, queue
  backlog, workflow/DO instance pages; `/kit/api` marks true gaps `PARTIAL`.
- Hardening: report ingest is idempotent per `(cell, sampledAt)`; an
  out-of-order report cannot regress the resource snapshot; R2 stats support
  `refresh=1` and coalesce concurrent scans; expired PENDING ops are reclaimed;
  worker metrics arrive as one `workers[]` breakdown; `coldStarts` counts
  scale-to-zero wakes while generation `launches` are separate.
- Security: the console proxy now serves only `/api/v1/`; the internal cell
  channel (`/api/internal/...`) is never browser-reachable, and encoded/path
  traversal targets are rejected before proxying.
- Tests: report ingest/stats/instances e2e, fixture contract, retention.

## 2026-11-22 — retention configuration

- Added deployment retention knobs: `PLANE_LOG_RETENTION_DAYS` (7),
  `PLANE_OPS_RETENTION_DAYS` (30), `PLANE_PUBLICATION_KEEP` (20) and
  `PLANE_RETENTION_SWEEP_MS` (6h, 0 disables).
- The plane runs a background sweep; `maintain.ts` and
  `POST /api/v1/maintenance/prune` accept per-run overrides.
- Logs and terminal D1/cell ops (the stats sources) are pruned; pending ops are
  never deleted. Indexes added for the cutoff scans.
- Tests: config parsing + e2e proving old logs/terminal ops are removed while
  old pending ops survive.

## 2026-11-21 — teams, Hyperdrive, stats APIs

- Added teams + quotas CRUD (`plane_teams`, `plane_team_quotas`).
- Added Hyperdrive resource metadata/binding API (`plane_hyperdrives`), with
  credentials explicitly provider-managed.
- Added stats endpoints: log-derived worker metrics, D1/R2 op counts, queue
  consumer/producer counts, workflow op counts, DO class/binding counts.
  Data-plane-only values (size, backlog, instances) are `null` with a note.
- Workflow/DO instance-list endpoints answer typed `501 VRT_NOT_SUPPORTED`.
- Console Hyperdrive page and worker metric cards are live; `/kit/api` probes the
  new surfaces.
- E2E coverage added for teams, Hyperdrive, stats and unsupported paths.

## 2026-11-21 — console service + live API

- `apps/console` now ships as a service: Nuxt static SPA plus
  `server/main.mjs`, which proxies `/api/v1` and `/api/internal` to the plane
  with the admin token injected server-side. Docker Compose starts it on 8788.
- Cell selection in the top bar; workers/D1/R2/KV/queues/workflows/DO list
  pages read live management API data with loading/error/empty states.
- `/kit/api` probes the live API and lists missing surfaces (metrics,
  Hyperdrive, D1/R2/queue/DO stats, workflow instances, team/quota).
- Docker and kind e2e now assert the console HTML and proxied API, in addition
  to the plane lifecycle.

## 2026-11-21 — real kind e2e

- `scripts/e2e-kind.sh` + CI `e2e-kind` job: kind cluster, locally loaded plane
  image, Postgres/plane Deployments + Secret, rollout, migrations,
  port-forward, then the same HTTP lifecycle.
- Scope is the plane on real Kubernetes networking; the four runtime cell images
  and workerd stay outside this repository's cluster e2e.

## 2026-11-21 — real Docker e2e

- `scripts/e2e-docker.mjs` + CI `e2e-docker` job: build and start the real
  plane container + Postgres via compose, migrate, then drive the API over HTTP
  (cell/worker/bundle/version/publish/desired/ACK/ops/logs/services/delete).
- Fixed the image's `/data/bundles` ownership (root-owned volume made every
  bundle PUT fail with EACCES) and added a Postgres healthcheck to compose.
- Clarified test layers: `api.e2e`/`services.e2e` are in-process + Postgres;
  Docker job is deployment-level; the k8s job is a render gate, not a cluster
  deployment.

## 2026-11-21 — service APIs and router split

- Split the management API into focused modules (`admin/cells|workers|config|bundles|publications|ops|logs` and `admin/services/*`); `context.ts` owns auth, parsing and wire mappers.
- Added service resource APIs: D1 databases + query/migrations, R2 buckets + object ops, KV namespaces + data ops, queues (CRUD + delay), workflows (declarations + instance ops), and a `/services` catalog returning ready-to-paste bindings.
- Added unified `GET /cells/{cell}/ops/{id}?waitMs=` polling across the D1 and generic cell-op channels.
- `services.e2e.test.ts` covers the service lifecycle and fail-closed validation/scope injection.

## 2026-11-21 — management API + cell ops/logs

- Added `/api/v1` management API: cell/worker/version/vars/secrets/hostnames/
  bundle CRUD, publish/publications, D1 and generic cell-op enqueue/list, log
  query and retention prune. `PLANE_ADMIN_TOKEN` is the management token
  (falls back to `PLANE_TOKEN`).
- Implemented the cell `d1-ops`, `cell-ops` and `logs` channels: PENDING pull,
  seq ACK, and log ingest deduped by `(workerId,bootId,seq)`; added the
  `plane_logs` table.
- `apps/plane/src/api.e2e.test.ts` drives the full lifecycle over HTTP against
  Postgres (create → bundle → version → publish → desired → ACK → ops → logs →
  delete) and runs in CI.

## 2026-11-21 — package consumption integration test

- `pnpm run check:package-consumption` builds and packs the package, installs
  the tarball into an empty project, and imports/uses the public exports. This
  is the integration gate for `files`/`exports`/`dist` mistakes that in-repo
  source tests cannot catch. Wired into the `control` CI job.

## 2026-11-21 — Vibeploy consumes the package

- Vibeploy switched from the byte-identical `server/src/vrt-control` copy to
  the git dependency
  `github:becoolme/openflare-control#v0.2.1&path:packages/control`.
  The package's `prepare` script builds `dist/` during install.
- `check-vibeploy-sync.mjs` now verifies the dependency is declared and fails if
  the old copy is reintroduced; it no longer byte-compares sources.
- `docs/migration.md` records the Git interim and the optional npm switch.

## 2026-11-21 — runtime contract dependency + capability coverage

- Added `scripts/check-openflare-contract.mjs` and a CI step that check out
  `becoolme/openflare` and fail if the vendored `desired/ack` fixtures drift.
  The runtime is now an enforced contract dependency, not a manual copy.
- Synced the fixtures and accepted the runtime's newer ACK capability bits
  `quotas` and `workerLoader`; without this, a cell reporting either bit would
  have its whole ACK rejected by the strict schema.
- Added capability keys `serviceProps`, `queueDeliveryDelay`, `workerLoader`,
  `quotas` and the matching optional binding fields
  (`services[].props`, queue `deliveryDelaySeconds`, `WORKER_LOADER` bindings)
  so the plane can gate new wire fields on cells that report support.

## 2026-11-21 — rename to openflare-control

- Repository, package and image names unified with the runtime: the library is
  published as `openflare-control`, the reference service is `openflare-plane`,
  images are `openflare-host/provider/sql/cell-controller`, and the namespace is
  `openflare-system`. Binary/config identifiers (`vrt-*`, `VRT_*`) are kept for
  compatibility with deployed cells and explained in the README glossary.
- The one remaining Chinese comment block (vrt-sql probes) is translated.

## 2026-11-21 — portability docs

- 104 unit tests (79% statements), including property tests for canonical
  JSON round-trip/order independence, after adding binding serialization, hostname
  policy and tenant-capacity eviction cases; [docs/conformance.md](docs/conformance.md)
  explains how a third-party store runs the shared suite.

## 2026-11-21 — isolation tests

- route tests prove a secret value never appears in `desired`, that a cell
  cannot fetch a bundle published by another cell, and that an ACK echoing a
  different `cellId` is rejected with 403 (the reference plane now enforces
  that check); `seed` can register secrets.

## 2026-11-21 — public-safety gate

- `scripts/check-sanitized.mjs` fails if the deployment layer contains private
  host addresses, cell tokens, private keys or brand references (masked deny
  CIDRs stay allowed); wired into CI together with a Docker image build.

## 2026-11-21 — concurrency and image fixes

- The Postgres store applied an ACK with a read-then-write sequence: two
  conflicting verdicts could both succeed. It now uses a conditional UPDATE
  (`ack_status in ('PENDING','PARTIAL')`) and classifies the loser as
  `terminal`; a concurrency test pins it.
- The runtime image was missing pnpm's per-package `node_modules`, so it
  crashed on `import 'zod'`. The Dockerfile now copies the workspace store and
  package dependency links; verified by running the image against Postgres
  (healthz, 401, and a signed desired payload).

## 2026-11-21 — coverage and operations

- 83 tests for `openflare-control` (73% statements, thresholds enforced) and 30 for
  the reference plane (85% statements, thresholds enforced); coverage runs in
  CI. The ACK schema is pinned to OpenFlare's cross-language wire fixtures.
- Reference plane: bundle/payload size limits (413), content-length pre-check,
  logged opaque 500s, and a `maintain` command for publication retention.
- Docs: cell API reference, operations runbook (key rotation, retention,
  upgrades, backups, failure modes).

## 2026-11-21 — hardening

- 59 unit tests for `openflare-control` (canonical JSON, signing, contract,
  validation, digests, hyperdrive, text, ack errors, renewal, compat, ACK
  state machine) and 21 tests for the reference plane (routes, signing,
  bundle store, publish/concurrency, shared conformance).
- Fix: `bundleDigestsInEnvelope` crashed on a `null` tenant/worker in a
  stored envelope; it now skips malformed entries as documented.
- Reference plane: every cell endpoint authenticates (including d1-ops,
  cell-ops and logs), JSON parse errors answer 400, a global error handler
  preserves typed statuses, graceful SIGTERM shutdown, schema CHECK
  constraints, and the store proxy no longer fakes `then`.
- Tooling: ESLint (typescript-eslint + prettier) and Prettier at the root;
  tests typechecked; CONTRIBUTING/SECURITY.

## 2026-11-21 — initial split

- `openflare-control`: portable cell plane extracted from vibeploy
  (`server/src/openflare-control`): wire contract (desired/ACK), desired builder,
  Ed25519 signer over canonical JSON v2, store/bundle ports, and the shared
  store-conformance suite (same cases run against Prisma and Postgres).
- `apps/plane`: reference plane — Hono service, Postgres store, filesystem
  bundle store, migrate/seed/publish CLI; cell channel implemented
  (desired, ACK, render-inputs, bundles), other channels answer empty shapes.
- `deploy/k8s`: kustomize base/components/example overlay, sanitized
  (`vrt-*` namespaces, no internal addresses); `scripts/vrt-k8s-check`
  renders it and fails closed on placeholders, tag-only images or unsafe
  ingress/egress.
- `scripts`: pinned workerd fetch, ELF arch check, image build (4 images,
  digest-pinned pushes) and the vibeploy source-sync gate.
