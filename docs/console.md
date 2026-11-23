# Console

`apps/console` is the OpenFlare web console: a Nuxt-generated static SPA plus a
tiny Node service that serves it and proxies the plane API on the same origin.

## Service shape

```text
browser ──▶ console:8788
              ├─ /_nuxt/*, /workers, /d1, ...   static SPA (200.html fallback)
              ├─ /console-healthz               liveness
              └─ /api/v1/*                      proxy to PLANE_URL
                                                (server injects the admin token;
                                                /api/internal/* is never exposed)
```

- The browser never receives the management token; it is injected by
  `apps/console/server/main.mjs`.
- No CORS configuration is needed because the UI and API are same-origin.
- `PLANE_URL` defaults to `http://127.0.0.1:8787`.
- `PLANE_ADMIN_TOKEN` is required, at least 32 characters, and must differ
  from `PLANE_TOKEN` — the plane refuses to boot otherwise.
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

| Page            | API                                                    |
| --------------- | ------------------------------------------------------ |
| Workers         | `GET /api/v1/cells/{cell}/workers`                     |
| D1              | `GET .../d1/databases`                                 |
| R2              | `GET .../r2/buckets`                                   |
| KV              | `GET .../kv/namespaces`                                |
| Queues          | `GET .../queues`                                       |
| Workflows       | `GET .../services`                                     |
| Durable Objects | workers + `GET .../workers/{name}/durable-objects`     |
| Hyperdrive      | `GET .../hyperdrive`                                   |
| Metrics         | `GET .../metrics` (runtime deltas, logs fallback)      |
| D1 detail       | `GET .../d1/databases/{id}/stats`                      |
| R2 detail       | `GET .../r2/buckets/{name}/stats` (`R2_STATS` op)      |
| Queue detail    | `GET .../queues/{id}/stats`                            |
| Workflow detail | `GET .../workflows/{name}/stats` + `/instances`        |
| DO detail       | `GET .../durable-objects/{class}/stats` + `/instances` |
| API coverage    | probes the endpoints live (`/kit/api`)                 |

Create/delete forms, metrics panels and detail-page charts are still design
shells. The `/kit/api` page is the authoritative gap list; it probes the live
API and marks each surface `LIVE`, `MISSING` or `ERROR`.

## APIs added for the console

- Teams + quotas (`/teams`).
- Hyperdrive metadata + binding identity (`/hyperdrive`).
- Runtime cell report ingest (`POST /api/internal/.../vrt/metrics`) carrying
  request/error/latency/CPU/cold-start deltas, D1/queue stats and
  Workflow/DO instance files. Replays are idempotent per `(cell, sampledAt)`.
- D1/R2/queue/workflow/DO stats endpoints — real data-plane values from the
  report (R2 on demand via a read-only `R2_STATS` cell op).
- Live workflow/DO instance listings (engine class-dir sqlite stems).

## Remaining intentional gaps (visible in `/kit/api`)

- Per-worker CPU/cold starts: the runtime reports CPU per tenant process and
  launches per pod, so a worker view is `null` rather than fake precision.
- Queue `delivered`: the counter lives in the cell-controller registry and is
  not part of the pod scrape yet.
- Workflow per-state counters (running/waiting/completed) and DO
  `activeInstances`: the engine has no status/liveness index; instance files
  are listed instead.
- User identity/profile (`/me`) — the shell team/user chrome is still static.

Adding an endpoint should be paired with replacing the corresponding static
panel; `/kit/api` marks these as `PARTIAL` rather than hiding them.
