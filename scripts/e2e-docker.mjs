#!/usr/bin/env node
/**
 * Real deployment e2e: talks to the built `openflare-plane` container over
 * HTTP (not `app.request`) with a real Postgres behind it.
 *
 *   PLANE_ADMIN_TOKEN=... docker compose up -d --build
 *   docker compose exec -T plane node dist/migrate.js
 *   PLANE_ADMIN_TOKEN=... node scripts/e2e-docker.mjs
 *
 * CI runs the same sequence; the script is also the local smoke command.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

const base = (process.env.PLANE_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const consoleBase = (process.env.CONSOLE_BASE_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '')
const adminToken = process.env.PLANE_ADMIN_TOKEN
if (!adminToken) throw new Error('PLANE_ADMIN_TOKEN is required')
const consolePassword = process.env.CONSOLE_AUTH_PASSWORD ?? ''

// Filled in by provisioning the cell's own pull token below — the per-cell
// credential is exactly what a deployed cell would carry.
let auth
let json
const adminAuth = { authorization: `Bearer ${adminToken}` }
const adminJson = { ...adminAuth, 'content-type': 'application/json' }
const cellJson = () => {
  if (!json) throw new Error('cell token not provisioned yet')
  return json
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`
const cell = `docker-${suffix}`
const team = `team-${suffix}`

async function request(method, path, body, headers, raw = false) {
  headers ??= path.startsWith('/api/v1') ? adminJson : cellJson()
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  const parsed = text && !raw ? JSON.parse(text) : text
  return { status: res.status, body: parsed }
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const [plane, consoleRes] = await Promise.all([
        fetch(`${base}/healthz`),
        fetch(`${consoleBase}/console-healthz`),
      ])
      if (plane.ok && consoleRes.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`plane did not become healthy at ${base}`)
}

async function main() {
  await waitReady()
  let r = await request('POST', '/api/v1/cells', { cellId: cell })
  assert.equal(r.status, 201)
  r = await request('POST', `/api/v1/cells/${cell}/token`)
  assert.equal(r.status, 201)
  const cellToken = r.body.data.token
  assert.ok(cellToken)
  auth = { authorization: `Bearer ${cellToken}` }
  json = { ...auth, 'content-type': 'application/json' }

  // Console path: unauthenticated request is rejected; Basic auth proxies the
  // admin API with the server-side credential.
  const basic = `Basic ${Buffer.from(`admin:${consolePassword}`).toString('base64')}`
  const unauth = await fetch(`${consoleBase}/api/v1/cells`)
  assert.equal(unauth.status, 401)
  const viaConsole = await fetch(`${consoleBase}/api/v1/cells`, {
    headers: { authorization: basic },
  })
  assert.equal(viaConsole.status, 200)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  r = await request('POST', `/api/v1/cells/${cell}/workers`, { teamId: team, name: 'hello' })
  assert.equal(r.status, 201, JSON.stringify(r.body))

  const bundle = Buffer.from(`export default { fetch: () => new Response('${suffix}') }`)
  const digest = sha256(bundle)
  const put = await fetch(`${base}/api/v1/cells/${cell}/bundles/${digest}`, {
    method: 'PUT',
    headers: adminAuth,
    body: bundle,
  })
  assert.equal(put.status, 201)

  r = await request('PUT', `/api/v1/cells/${cell}/teams/${team}/workers/hello/vars/GREETING`, {
    value: 'hi',
  })
  assert.equal(r.status, 200)
  r = await request('PUT', `/api/v1/cells/${cell}/teams/${team}/workers/hello/secrets/API_KEY`, {
    value: 'secret',
  })
  assert.equal(r.status, 200)
  r = await request('POST', `/api/v1/cells/${cell}/teams/${team}/workers/hello/hostnames`, {
    hostname: `hello-${suffix}.example.test`,
  })
  assert.equal(r.status, 201)

  r = await request('POST', `/api/v1/cells/${cell}/teams/${team}/workers/hello/versions`, {
    versionId: `v-${suffix}`,
    bundleSha256: digest,
    bundleBytes: bundle.byteLength,
    vars: { GREETING: 'hi' },
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  r = await request(
    'POST',
    `/api/v1/cells/${cell}/teams/${team}/workers/hello/versions/v-${suffix}/activate`,
    {}
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  r = await request('POST', `/api/v1/cells/${cell}/publish`, { cause: 'DOCKER_E2E' })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const revision = r.body.data.revision

  r = await request('GET', `/api/internal/clusters/${cell}/vrt/desired`, undefined, auth)
  assert.equal(r.status, 200)
  const envelope = r.body
  assert.equal(envelope.payload.tenants[0].tenantId, team)

  r = await request('GET', `/api/v1/cells/${cell}/publications/${revision}`)
  assert.equal(r.status, 200)
  const pub = r.body.data.publication
  r = await request(
    'POST',
    `/api/internal/clusters/${cell}/vrt/desired/ack`,
    {
      revision,
      payloadDigest: pub.payloadDigest,
      envelopeDigest: pub.envelopeDigest,
      fenceRevision: revision,
      status: 'APPLIED',
      capabilities: { cron: true, assets: true },
      podsApplied: true,
    },
    json
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.data.ackStatus, 'APPLIED')

  r = await request('POST', `/api/v1/cells/${cell}/d1-ops`, {
    databaseId: 'a'.repeat(26),
    kind: 'EXECUTE',
    payload: { sql: 'select 1' },
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const d1OpId = r.body.data.id
  r = await request('GET', `/api/internal/clusters/${cell}/vrt/d1-ops`, undefined, auth)
  const d1Op = r.body.data.ops[0]
  r = await request(
    'POST',
    `/api/internal/clusters/${cell}/vrt/d1-ops/ack`,
    { acks: [{ seq: d1Op.seq, status: 'DONE', result: { ok: true } }] },
    json
  )
  assert.equal(r.body.data.acked, 1)
  r = await request('GET', `/api/v1/cells/${cell}/ops/${d1OpId}?waitMs=1000`)
  assert.equal(r.body.data.op.status, 'DONE')

  r = await request(
    'POST',
    `/api/internal/clusters/${cell}/vrt/logs`,
    {
      podId: 'pod-1',
      bootId: 'boot-1',
      records: [
        {
          seq: 1,
          workerId: `${team}:hello`,
          tsMs: Date.now(),
          level: 'info',
          kind: 'request',
          message: 'hello from docker',
        },
      ],
    },
    json
  )
  assert.equal(r.body.data.accepted, 1)
  r = await request('GET', `/api/v1/cells/${cell}/logs`)
  assert.equal(r.body.data.logs[0].message, 'hello from docker')

  // Service resource path through the real container.
  r = await request('POST', `/api/v1/cells/${cell}/queues`, {
    teamId: team,
    name: 'jobs',
    deliveryDelaySeconds: 5,
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const queueId = r.body.data.queue.queue_id
  r = await request('GET', `/api/v1/cells/${cell}/services`)
  assert.equal(r.status, 200)
  assert.equal(r.body.data.queues[0].binding.type, 'queue')

  // Runtime cell report: the deployed plane ingests the exact wire shape the
  // cell controller pushes, and the console sees real metrics/stats.
  r = await request('POST', `/api/v1/cells/${cell}/d1/databases`, {
    teamId: team,
    name: 'main',
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const dbId = r.body.data.database.database_id
  const now = Date.now()
  const workerId = `${team}:hello`
  const report = {
    schemaVersion: 1,
    cellId: cell,
    sampledAtMs: now,
    windowMs: 30_000,
    pods: [
      {
        podId: 'pod-1',
        bootId: 'boot-1',
        windowMs: 30_000,
        firstSample: false,
        reset: false,
        workers: [
          {
            workerId,
            requests: 7,
            errorRequests: 1,
            serverErrors: 1,
            exceptions: 0,
            requestBytes: 10,
            responseBytes: 20,
            inflight: 0,
            requestDuration: {
              count: 7,
              sumSeconds: 0.2,
              buckets: [
                { le: 0.005, count: 2 },
                { le: 0.05, count: 7 },
              ],
            },
          },
        ],
        tenants: [{ tenantId: team, cpuSeconds: 0.25, memoryRssBytes: 1024, doStorage: [] }],
        launches: { ready: 1, failed: 0 },
        wakes: { ok: 0, failed: 0 },
        wakeSeconds: { count: 0, sumSeconds: 0, buckets: [] },
        processStartTimeSeconds: now / 1000 - 30,
      },
    ],
    resources: {
      sampledAtMs: now,
      d1: {
        [dbId]: {
          sizeBytes: 8192,
          pageCount: 2,
          pageSize: 4096,
          tableCount: 1,
          tables: ['t'],
          indexCount: 0,
          userVersion: 0,
        },
      },
      queues: {
        [queueId]: {
          backlog: 2,
          backlogBytes: 20,
          oldestMessageTimestampMs: now - 1000,
          visible: 2,
          inFlight: 0,
          delayed: 0,
          dead: 0,
        },
      },
      workflows: {},
      durableObjects: {},
      errors: [],
    },
  }
  r = await request('POST', `/api/internal/clusters/${cell}/vrt/metrics`, report, json)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.data.stored, true)
  r = await request('GET', `/api/v1/cells/${cell}/metrics`)
  assert.equal(r.body.data.source, 'runtime')
  assert.equal(r.body.data.requests, 7)
  assert.equal(r.body.data.cpuMs, 250)
  assert.equal(r.body.data.coldStarts, 0)
  assert.equal(r.body.data.launches.ready, 1)
  assert.equal(r.body.data.latency.p50, 50)
  r = await request('GET', `/api/v1/cells/${cell}/d1/databases/${dbId}/stats`)
  assert.equal(r.body.data.sizeBytes, 8192)
  assert.equal(r.body.data.tableCount, 1)
  r = await request('GET', `/api/v1/cells/${cell}/queues/${queueId}/stats`)
  assert.equal(r.body.data.backlog, 2)
  assert.equal(r.body.data.visible, 2)
  r = await request('GET', `/api/v1/cells/${cell}/teams/${team}/workers/hello/metrics`)
  assert.equal(r.body.data.requests, 7)
  assert.equal(r.body.data.cpuMs, null)
  const proxiedMetrics = await fetch(`${consoleBase}/api/v1/cells/${cell}/metrics`, {
    headers: { authorization: basic },
  })
  assert.equal(proxiedMetrics.status, 200)
  assert.equal((await proxiedMetrics.json()).data.source, 'runtime')

  // The console service is a real static UI + same-origin API proxy.
  const ui = await fetch(`${consoleBase}/`, { headers: { authorization: basic } })
  assert.equal(ui.status, 200)
  assert.match(await ui.text(), /OpenFlare/i)
  const proxied = await fetch(`${consoleBase}/api/v1/cells`, {
    headers: { authorization: basic },
  })
  assert.equal(proxied.status, 200)
  const proxiedBody = await proxied.json()
  assert.ok(Array.isArray(proxiedBody.data.cells))

  r = await request('DELETE', `/api/v1/cells/${cell}`)
  assert.equal(r.status, 200)
  console.log(`OK: docker e2e passed (cell ${cell}, revision ${revision})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
