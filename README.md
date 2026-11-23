# openflare-control

[![CI](https://github.com/becoolme/openflare-control/actions/workflows/ci.yml/badge.svg)](https://github.com/becoolme/openflare-control/actions/workflows/ci.yml)

A self-hostable control plane for [OpenFlare](https://github.com/becoolme/openflare)
(the open-source `workerd` runtime), deployable on Kubernetes or Docker Compose.

OpenFlare runs Workers; this repository is everything around them:

- a **portable plane package** — the signed `compute.desired` contract, the
  desired-state builder and signer, the publish/ACK state machine, the store
  ports and the conformance suite that any store implementation must pass;
- a **reference plane** — a small HTTP service with a Postgres store,
  filesystem bundle store, and a deploy/publish CLI;
- the **Kubernetes deployment layer** — a kustomize base, components and an
  example overlay for a cell (`host` + `provider` + `cell-controller` +
  `sql`).

It is the second composition of the plane that powers Vibeploy's Workers
runtime, so the wire bytes and the ACK semantics are the same in both.

```
openflare          workerd runtime + cell-controller (Rust, MIT)
openflare-control  this repo: portable plane + reference service + deploy/k8s
vibeploy           product control plane (teams, billing, console, CLI)
```

The control plane is never on the tenant request path. Cells pull a signed
snapshot, serve traffic from it, and keep serving their last accepted snapshot
until it expires (24 h maximum).

## Naming

`VRT` is the internal codename of the self-developed workerd runtime (as
opposed to the legacy managed `WDL` runtime). User-facing components are named
`openflare-*`; the `vrt-*` prefix survives in binary and configuration names
(`vrt-host`, `vrt-provider`, `vrt-sql`, `vrt-cell-controller`, `VRT_*` env
vars) for compatibility with existing cells and must not be renamed casually.

## Repository layout

| Path               | Role                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/control` | Portable plane: wire schemas, desired builder, signer, ports, store conformance suite (published as `openflare-control`) |
| `apps/plane`       | Reference plane: Hono service, Postgres store, filesystem bundle store, migrate/seed/maintain CLI                        |
| `apps/console`     | Web console: generated Nuxt SPA + same-origin API proxy service ([docs/console.md](docs/console.md))                     |
| `deploy/k8s`       | Kustomize base, components and an example overlay for one cell                                                           |
| `scripts`          | Render/invariant gate (`vrt-k8s-check`), image build, pinned workerd fetch, sanitization and sync gates                  |
| `docs`             | Architecture, Kubernetes, API, operations, conformance and migration notes                                               |

## Try it locally

```sh
pnpm install
pnpm --filter openflare-control build

export PLANE_TOKEN="$(openssl rand -hex 32)"
export PLANE_ADMIN_TOKEN="$(openssl rand -hex 32)"
export PLANE_SIGNING_SECRET="$(openssl rand -hex 32)"
docker compose up -d --build
docker compose exec plane node dist/migrate.js

# store a bundle and publish a signed snapshot
DIGEST=$(printf 'hello' | shasum -a 256 | cut -d' ' -f1)
docker compose exec plane node dist/seed.js \
  --cluster dev-cell --team demo --name hello \
  --version ver-1 --digest "$DIGEST" --var GREETING=hi

curl -H "Authorization: Bearer $PLANE_TOKEN" \
  http://127.0.0.1:8787/api/internal/clusters/dev-cell/vrt/desired
```

The response is the signed envelope a cell would verify. `docker compose
down -v` removes the plane database and bundle volume.

## Deploy on Kubernetes

Prerequisites: a K3s/Kubernetes cluster with a shared ingress and wildcard DNS,
an S3-compatible store, Kvrocks, Postgres, and an OpenFlare checkout
(unmodified upstream) at `../openflare` or `$OPENFLARE_DIR`.

```sh
# 1. plane database + service (outside or inside the cluster)
export DATABASE_URL=postgresql://user:pass@host/openflare_plane
export PLANE_TOKEN="$(openssl rand -hex 32)"
export PLANE_ADMIN_TOKEN="$(openssl rand -hex 32)"
export PLANE_SIGNING_SECRET="$(openssl rand -hex 32)"
export PLANE_BUNDLE_DIR=/var/lib/openflare/bundles
pnpm --filter openflare-plane migrate
pnpm --filter openflare-plane start        # prints keyId + publicKey

# 2. build and push the four cell images from the pinned workerd fork
VRT_REGISTRY=ghcr.io/your-org \
WORKERD_SHA256=$(node scripts/vrt-fetch-workerd.mjs --arch linux-x64 | sed -n 's/^WORKERD_SHA256=//p') \
  ./scripts/vrt-build-images.sh --push --tag openflare-$(date +%Y%m%d)

# 3. fill the overlay and apply
$EDITOR deploy/k8s/overlays/example       # every REPLACE_ME_* plus image digests
OPENFLARE_DIR=../openflare node scripts/vrt-k8s-check.mjs deploy/k8s/overlays/example
kubectl apply -k deploy/k8s/overlays/example
```

The overlay documents every placeholder: control-plane URL, trusted key, cell
id, wildcard TLS secret, storage class, S3/Kvrocks endpoints and the
`vrt-secrets` keys. The render gate fails on residual placeholders, tag-only
images, or an ingress exposing anything but `:8080`.

See [docs/kubernetes.md](docs/kubernetes.md) for networking, image publishing
and rollout/rollback.

## Deploy a worker

```sh
pnpm --filter openflare-plane exec tsx src/seed.ts \
  --cluster prod-cell-1 --team demo --name hello \
  --version ver-1 --digest <sha256-of-bundle> \
  --var GREETING=hello --secret API_KEY=... \
  --hostname hello.workers.example.com
```

The cell pulls `GET /api/internal/clusters/<cell>/vrt/desired`, fetches the
bundle by digest, and reports `POST .../desired/ack`. Vars and secret values
are only served through the authenticated `render-inputs` endpoint. The full
cell API is in [docs/api.md](docs/api.md).

## Security model

- **Single trusted owner**, like OpenFlare's standalone mode. This is not a
  hostile multi-tenant boundary; run one plane per trust domain and keep it on
  a private network.
- Bearer token (`PLANE_TOKEN`) on every cell endpoint, compared in constant
  time.
- The management API requires a separate, at-least-32-character
  `PLANE_ADMIN_TOKEN`; it never falls back to the cell token, so a leaked cell
  credential cannot become a management credential.
- Desired snapshots are Ed25519-signed over canonical JSON v2; the key is
  derived from `PLANE_SIGNING_SECRET` and its public key must be listed in each
  component's `trustedKeys`. Cells reject replayed, tampered, mis-scoped or
  expired envelopes and fail closed.
- Secrets never appear in the desired document — only references do.
- Bundle bytes are served only for digests referenced by a retained
  publication (no existence oracle), and size-capped.
- Deployment manifests contain no private addresses or credentials
  (`pnpm run check:sanitized` enforces it).

Rotating the signing key, retention, backups and failure modes:
[docs/operations.md](docs/operations.md).

## Store contract and conformance

`openflare-control` exports `storeConformanceCases`, a framework-free suite
every `VrtControlStore` implementation must pass. Vibeploy runs it against its
Prisma store; `apps/plane` runs the same cases against Postgres:

```sh
DATABASE_URL=postgresql://.../openflare_plane_test pnpm --filter openflare-plane test
```

Adding a store method or changing semantics requires a case there. See
[docs/conformance.md](docs/conformance.md) for a third-party implementation
walkthrough.

## Quality gates

```sh
pnpm --filter openflare-control test        # unit + property + boundary tests
DATABASE_URL=... pnpm --filter openflare-plane test
pnpm lint && pnpm format:check && pnpm run typecheck
pnpm run check:package                      # publint (exports/files)
OPENFLARE_DIR=../openflare pnpm run check:openflare-contract  # checks the pinned runtime revision
pnpm run check:package-consumption          # pack + install + import in an empty project
pnpm run check:sanitized                    # no private refs in deploy/
# real container + real Postgres (requires docker compose):
PLANE_TOKEN=... PLANE_ADMIN_TOKEN=... pnpm test:e2e:docker
# real kind cluster + Postgres (requires kind/kubectl):
PLANE_TOKEN=... PLANE_ADMIN_TOKEN=... PLANE_SIGNING_SECRET=... pnpm test:e2e:kind
OPENFLARE_DIR=../openflare node scripts/vrt-k8s-check.mjs --template deploy/k8s/overlays/example
```

CI runs the same gates plus coverage thresholds (currently 79% statements in
the package, 84% in the service), a Postgres conformance job, a container
build, and the kustomize render gate. The test suite covers canonical JSON
(including property tests), signing, the ACK/desired contract (pinned to
OpenFlare's cross-language wire fixtures), hostname/binding validation, publish
eviction and concurrency, HTTP auth/limits/isolation, retention and the shared
store conformance cases.

## Status

- Cell channel: desired, ACK, render-inputs, bundles — implemented.
- Management API (`/api/v1`): cells, workers, versions, vars, secrets,
  hostnames, bundles, publish/publications, teams/quotas, D1/R2/KV/queue/
  workflow/Hyperdrive resources, runtime metrics/report ingest, stats,
  workflow/DO instance listings, D1/cell ops, logs and retention prune —
  implemented
  ([docs/management-api.md](docs/management-api.md)).
- D1, generic cell-op and log channels: implemented (pull/ACK/ingest), not just
  empty shapes.
- Per-worker CPU/cold starts, queue `delivered`, workflow per-state counters and
  DO active-instance counts remain explicit `null`s: the runtime reports CPU
  per tenant process, launches per pod, and has no engine status/liveness index.
  Instance ids/storage are listed from the engine class dirs.
- Console: list pages (workers, D1, R2, KV, queues, workflows, durable objects)
  read the live management API through a same-origin proxy; `/kit/api` lists the
  remaining gaps (metrics, Hyperdrive, queue/D1/R2/DO stats, workflow instances,
  team/quota).
- Multi-cell: one plane serves any number of cells keyed by `cellId`; one cell
  is one pod (see the manifests).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
License: MIT.

## Roadmap

- D1 / cell-op / log resource manager in the reference plane.
- A remote-base example overlay for Vibeploy-style private deployments.
- Published `openflare-control` package and digest-pinned images on every tag.
