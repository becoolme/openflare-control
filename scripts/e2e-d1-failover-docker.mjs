// Docker D1 failover drill on the all-in-one stack.
//
//   node scripts/e2e-d1-failover-docker.mjs
//
// Assumes docker-compose.all-in-one.yml is up (the CI job does that) and the
// cell image `openflare-cell-sql:local` exists. It:
//   1. creates a D1 database through the management API;
//   2. writes through a control-plane EXECUTE op (real vrt-sql writer);
//   3. starts a follower container on the same persistence volume;
//   4. stops the writer and enqueues PROMOTE until the follower is caught up;
//   5. asserts the control plane advanced the writer epoch and published;
//   6. restarts the writer and reads the data back through a new EXECUTE op.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PLANE = 'http://127.0.0.1:8787'
const ADMIN = process.env.PLANE_ADMIN_TOKEN
const CELL = process.env.VRT_CELL_ID ?? 'local'
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const team = `d1fail-${suffix}`
const dbName = `d1-fail-${suffix}`
const followerName = `e2e-d1-follower-${suffix}`
const project = 'openflare-all-in-one'

const api = async (method, path, body) => {
  const res = await fetch(`${PLANE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return {
    status: res.status,
    body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text || 'null') : text,
  }
}
const waitFor = async (fn, label, timeoutMs = 120_000, intervalMs = 500) => {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`)
}
const runOp = async (sql) => {
  let r = await api('POST', `/api/v1/cells/${CELL}/d1/databases/${dbId}/query`, { sql })
  assert.equal(r.status, 202, `query enqueue: ${JSON.stringify(r.body)}`)
  const opId = r.body.data.opId
  return waitFor(async () => {
    const got = await api('GET', `/api/v1/cells/${CELL}/ops/${opId}?waitMs=2000`)
    if (got.status !== 200) return null
    const op = got.body?.data?.op ?? got.body?.data
    if (!op || op.status === 'PENDING') return null
    assert.equal(op.status, 'DONE', `op ${opId} ${op.status}: ${op.error ?? ''}`)
    return op
  }, `op ${opId}`)
}
const docker = (args, opts = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

await waitFor(async () => (await fetch(`${PLANE}/healthz`)).ok, 'plane healthz', 60_000)

let r = await api('POST', '/api/v1/teams', { teamId: team, name: 'D1 failover drill' })
assert.equal(r.status, 201, `team create: ${JSON.stringify(r.body)}`)
r = await api('POST', `/api/v1/cells/${CELL}/d1/databases`, { teamId: team, name: dbName })
assert.equal(r.status, 201, `d1 create: ${JSON.stringify(r.body)}`)
const dbId = r.body.data.database.database_id
await waitFor(
  async () => (await api('GET', `/api/v1/cells/${CELL}/d1/databases/${dbId}`)).status === 200,
  'd1 row visible'
)

// Real writer path: EXECUTE op -> cell-controller -> vrt-sql.
await runOp('CREATE TABLE IF NOT EXISTS t(v INTEGER)')
await runOp('INSERT INTO t VALUES (1)')

// Start a follower/premote listener on the same persistence + data volume.
const tmp = mkdtempSync(join(tmpdir(), 'vrt-d1-fail-'))
const cfg = join(tmp, 'follower.toml')
writeFileSync(
  cfg,
  `dbRoot = "/data/replica"
listenTcp = "0.0.0.0:8092"
authSecretFile = "/run/vrt/secrets/vrt-sql-auth-secret"
promoteWriterDbRoot = "/data/db"

[persistence]
backend = "fs"
allowSameDeviceDurability = true
fs = { root = "/data/persistence" }

[follower]
databaseId = "${dbId}"
pollIntervalMs = 200
retainGenerations = 2
`
)
let followerStarted = false
const stopFollower = () => {
  if (!followerStarted) return
  try {
    docker(['rm', '-f', followerName])
  } catch {
    // best-effort cleanup
  }
  followerStarted = false
}
try {
  docker([
    'run', '-d', '--name', followerName,
    '--network', `${project}_default`,
    '--network-alias', 'vrt-sql-follower.openflare.svc',
    '--user', '10001:10001',
    '-v', `${tmp}:/etc/vrt:ro`,
    '-v', `${project}_cell-sql-data:/data`,
    '-v', `${project}_cell-run:/run/vrt:ro`,
    '--entrypoint', '/usr/local/bin/vrt-sql',
    'openflare-cell-sql:local', '--config', '/etc/vrt/follower.toml',
  ])
  followerStarted = true

  // Stop the writer so the follower's manifest head is final.
  docker(['compose', '-f', 'docker-compose.all-in-one.yml', 'stop', 'vrt-sql'])

  // Enqueue PROMOTE until the follower is caught up (409/FAILED before that).
  const promoted = await waitFor(async () => {
    const enq = await api('POST', `/api/v1/cells/${CELL}/d1/databases/${dbId}/promote`, {
      writerAddr: 'http://vrt-sql.openflare.svc:8082',
      reason: 'docker e2e',
    })
    if (enq.status !== 202) return null
    const opId = enq.body.data.opId
    return waitFor(async () => {
      const got = await api('GET', `/api/v1/cells/${CELL}/ops/${opId}?waitMs=2000`)
      const op = got.body?.data?.op ?? got.body?.data
      if (!op || op.status === 'PENDING') return null
      return op.status === 'DONE' ? op : { failed: true, error: op.error }
    }, `promote op ${opId}`, 10_000, 250)
  }, 'promotion (follower catch-up)', 90_000, 2_000)
  assert.ok(promoted && !promoted.failed, `promote failed: ${JSON.stringify(promoted)}`)

  const detail = await waitFor(async () => {
    const d = await api('GET', `/api/v1/cells/${CELL}/d1/databases/${dbId}/promotions`)
    return d.status === 200 && d.body.data.writer.epoch >= 2 ? d.body.data : null
  }, 'writer epoch published')
  assert.ok(detail.promotions.some((p) => p.status === 'DONE'), 'PROMOTE not DONE')
  console.log('d1 failover: writer epoch', detail.writer.epoch, 'addr', detail.writer.addr)

  // Restart the writer: it claims the promoted epoch and must serve the data.
  docker(['compose', '-f', 'docker-compose.all-in-one.yml', 'start', 'vrt-sql'])
  await waitFor(async () => {
    const h = await api('POST', `/api/v1/cells/${CELL}/d1/databases/${dbId}/query`, {
      sql: 'SELECT count(*) AS n FROM t',
    })
    if (h.status !== 202) return null
    const op = await waitFor(async () => {
      const got = await api('GET', `/api/v1/cells/${CELL}/ops/${h.body.data.opId}?waitMs=2000`)
      const o = got.body?.data?.op ?? got.body?.data
      return o && o.status !== 'PENDING' ? o : null
    }, 'post-promote read', 15_000, 250)
    return op.status === 'DONE' && op.result ? op : null
  }, 'writer serves promoted data', 120_000, 1_000)
  console.log('d1 failover: restarted writer serves the promoted database OK')
} finally {
  stopFollower()
  rmSync(tmp, { recursive: true, force: true })
}
