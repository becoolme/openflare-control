# Console

`apps/console` is the OpenFlare web console: a Nuxt-generated static SPA plus a
tiny Node service that serves it and proxies the plane API on the same origin.

## Service shape

```text
browser ──▶ console:8788
              ├─ /_nuxt/*, /workers, /d1, ...   static SPA (200.html fallback)
              ├─ /console-healthz               liveness
              └─ /api/v1/*, /api/internal/*     proxy to PLANE_URL
                                                (server injects the admin token)
```

- The browser never receives the management token; it is injected by
  `apps/console/server/main.mjs`.
- No CORS configuration is needed because the UI and API are same-origin.
- `PLANE_URL` defaults to `http://127.0.0.1:8787`.
- `PLANE_ADMIN_TOKEN` is required (falls back to `PLANE_TOKEN`).
- Static output is `apps/console/.output/public`; the Docker image copies it to
  `/app/public`.

## Run it

Docker Compose starts Postgres, the plane and the console:

```sh
export PLANE_TOKEN="$(openssl rand -hex 32)"
export PLANE_SIGNING_SECRET="$(openssl rand -hex 32)"
docker compose up -d --build
docker compose exec plane node dist/migrate.js
# UI:    http://127.0.0.1:8788
# Plane: http://127.0.0.1:8787
```

Local development:

```sh
pnpm --filter openflare-plane build
pnpm --filter openflare-console dev          # Nuxt dev server
# or serve the generated build through the proxy:
pnpm --filter openflare-console build
PLANE_URL=http://127.0.0.1:8787 PLANE_ADMIN_TOKEN=... \
  node apps/console/server/main.mjs
```

The console is also part of the real Docker and kind e2e runs: the scripts
assert the UI returns HTML and that `/api/v1/cells` is reachable through the
proxy.

## What is live

The console selects a cell from `GET /api/v1/cells` (top-bar selector) and the
list pages read live data:

| Page            | API                                                |
| --------------- | -------------------------------------------------- |
| Workers         | `GET /api/v1/cells/{cell}/workers`                 |
| D1              | `GET .../d1/databases`                             |
| R2              | `GET .../r2/buckets`                               |
| KV              | `GET .../kv/namespaces`                            |
| Queues          | `GET .../queues`                                   |
| Workflows       | `GET .../services`                                 |
| Durable Objects | workers + `GET .../workers/{name}/durable-objects` |
| Hyperdrive      | no API — page explains the gap                     |
| API coverage    | probes the endpoints live (`/kit/api`)             |

Create/delete forms, metrics panels and detail-page charts are still design
shells. The `/kit/api` page is the authoritative gap list; it probes the live
API and marks each surface `LIVE`, `MISSING` or `ERROR`.

## APIs added for the console

- Teams + quotas (`/teams`).
- Hyperdrive metadata + binding identity (`/hyperdrive`).
- Log-derived worker metrics (`/metrics`).
- D1/R2/queue/workflow/DO stats endpoints — real control-plane counts where
  stored; data-plane-only numbers are explicitly `null`.
- Typed `501 VRT_NOT_SUPPORTED` for workflow/DO instance lists.

## Remaining gaps (visible in `/kit/api`)

- CPU/cold-start metrics (runtime does not report them).
- D1 size/tables/pending migrations, R2 object/size/class counts, queue
  backlog/delivery, workflow instance counters, DO instance/storage — these
  need data-plane or runtime indexes, not just a control-plane table.
- User identity/profile (`/me`) — the shell team/user chrome is still static.

These are the next API candidates; adding an endpoint should be paired with
replacing the corresponding static panel.
