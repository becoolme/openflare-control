# Changelog

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
