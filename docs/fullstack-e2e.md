# Full-stack e2e (API → cell → workerd → ingress)

`scripts/e2e-fullstack.mjs` is the execution-level test. It does not stop at
"the desired snapshot looks right": it starts the real runtime and asserts the
worker's actual response.

```text
management API
  → Postgres / plane (signed compute.desired)
  → real cell-controller (bundle fetch + verification, ACK)
  → real vrt-host (supervisor)
  → real workerd
  → ingress request
```

## What it does

1. Starts a fresh plane + migrations and reads the signing public key.
2. Creates a cell/team/worker/hostname over `/api/v1`.
3. Builds a runtime bundle with `buildRuntimeBundle` (canonical stored
   document + manifest digest), uploads it with
   `PUT /cells/{cell}/bundles/{digest}`, and calls
   `POST /workers/{name}/deploy` with `activate + publish`.
4. Starts the cell-controller and waits for `envelope.json`/`assignment.json`,
   then starts vrt-host with the pinned real `workerd`.
5. Polls the publication until the cell ACKs `APPLIED`, requests the ingress
   with `Host: <hostname>`, and asserts the body is `v1`.
6. Uploads a second bundle whose code returns `v2`, deploys it, waits for the
   new ACK, and polls the ingress until it serves `v2` (the old generation may
   answer during the switch).

## Run locally

Requires the runtime checkout, a built `cell-controller`/`vrt-host`, the pinned
workerd binary, and the facade dist:

```sh
# build once
cargo build --locked -p cell-controller -p vrt-host --bins   # in ../openflare
../openflare/scripts/fetch-workerd.sh --out ../openflare/.ci/workerd --platform linux-x64

DATABASE_URL=postgresql://postgres@127.0.0.1:5432/openflare_fullstack \
RUNTIME_DIR=../openflare \
WORKERD_BIN=../openflare/.ci/workerd/workerd \
PLANE_SIGNING_SECRET=fullstack-signing-secret-1234 \
PLANE_TOKEN=fullstack-cell-token PLANE_ADMIN_TOKEN=fullstack-cell-token \
node scripts/e2e-fullstack.mjs
```

`FULLSTACK_STUB=1` starts the dev-stub workerd instead (no code execution; it
proves the API/cell/bundle/ACK wiring and answers `stub ok`). It needs
`VRT_HOST_BIN` built with `--features dev-stub` and `STUB_BIN`.

## Bundle format

The management API stores the runtime's canonical stored document, keyed by
sha256(canonical manifest) — **not** sha256(document bytes). The runtime
re-verifies the inner digest and every module at fetch. The control package
exports `buildRuntimeBundle` / `verifyRuntimeBundle` for clients and the bundle
upload guard.

## CI

The `e2e-fullstack` job checks out the runtime at `OPENFLARE_CONTRACT_REV`,
builds the two bins, fetches the pinned workerd, and runs the script against a
Postgres service. Failure prints the plane/cell-controller/vrt-host logs.
