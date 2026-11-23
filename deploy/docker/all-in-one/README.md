# All-in-one Docker deploy

One host, the whole platform: **control plane** (postgres + plane +
console) **and one cell** (vrt-host + cell-controller + vrt-provider +
vrt-sql + redis KV). The management API is the plane's `/api/v1` — the
same code the k8s layout runs — so Docker and k8s expose an identical
management surface; they differ only in orchestration.

```
openflare-system ─────────────────────────────────────────────
 traefik(:443, profile tls) ── console.<host> → console:8788
                            └─ * (catch-all) → vrt-host:8080
 plane:8787 ← cell-controller (pull) ← signed desired → vrt-host
 postgres / plane-bundles      /run/vrt (secrets, delivery, listeners)
```

## Quick start

```sh
# 1. Fetch the pinned workerd into the openflare checkout (one time):
(cd $OPENFLARE_DIR && node scripts/vrt-fetch-workerd.mjs)  # or fetch-workerd.sh
export WORKERD_SHA256=$(node -e "const l=require('$OPENFLARE_DIR/deploy/docker/workerd.lock');const a=l.artifacts[process.arch==='arm64'?'linux-arm64':'linux-x64'];console.log(a.binarySha256)")

# 2. Secrets (all required; generate with `openssl rand -hex 32`):
export PLANE_ADMIN_TOKEN=...      # ≥32 chars, management API
export PLANE_SIGNING_SECRET=...   # Ed25519 root — derives signing + secrets keys
export PLANE_SECRETS_KEY=...      # ≥32 chars, secrets at rest
export CONSOLE_AUTH_PASSWORD=...  # console Basic auth (user: admin)
export OPENFLARE_DIR=../openflare # sibling checkout with the cell Dockerfiles

# 3. Dev (loopback only):  console :8788, plane :8787, ingress :8080
docker compose -f docker-compose.all-in-one.yml up --build

# 4. Public (TLS): Traefik owns :80/:443 and issues one Let's Encrypt
#    cert per hostname at first handshake.
export CONSOLE_HOST=console.example.com
export VRT_TLS_EMAIL=you@example.com  # optional — LE expiry notices
#    DNS: console.example.com + every worker hostname + *.preview-domain → this host
docker compose -f docker-compose.all-in-one.yml --profile tls up --build
```

`cell-init` runs once on every `up`: creates the cell
(`VRT_CELL_ID`, default `local`), issues its pull token via
`POST /api/v1/cells/:id/token`, renders the four service configs with
the derived signing key, and seeds shared HMAC secrets. Existing files
are never overwritten — re-running `up` never rotates credentials.

## What works / what doesn't (fail closed)

| Capability                                                           | Status                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Workers, versions, hostnames, secrets, assets, D1, queue, cron, logs | ✅                                                                     |
| KV                                                                   | ✅ via bundled `redis` service (override `VRT_KVROCKS_URL`)            |
| R2                                                                   | ✅ via bundled `silo` (maintained MinIO fork; `VRT_R2_*` → real S3)  |
| Hyperdrive/pg                                                        | credentials file is provisioned; pg endpoints need a reachable DB      |
| TLS                                                                  | Traefik profile; cert per SNI hostname on first handshake              |

## Ports

| Service                 | Default                           |
| ----------------------- | --------------------------------- |
| traefik (profile `tls`) | `0.0.0.0:80/443` (`VRT_TLS_BIND`) |
| console                 | `127.0.0.1:8788` (`CONSOLE_BIND`) |
| plane                   | `127.0.0.1:8787` (`PLANE_BIND`)   |
| vrt-host ingress        | `127.0.0.1:8080` (`VRT_BIND`)     |
| postgres                | unpublished (internal only)       |

Remote cells (outside this host) need the plane exposed with TLS:
point `control_plane_url` at `https://api.example.com` and add a
`Host()` router for it — the tenant catch-all does not cover it.

## vs standalone (`openflare/deploy/standalone`)

Standalone is the no-control-plane mode: `of` CLI writes signed
desired-state to `/data` directly. All-in-one is the full platform on
one host — same `/api/v1` + console as k8s. Pick standalone for
air-gapped/minimal nodes; all-in-one for a self-hosted control plane.
