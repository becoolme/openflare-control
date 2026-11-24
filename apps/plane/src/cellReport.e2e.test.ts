/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/**
 * Cell report e2e: the runtime's periodic report is ingested over the internal
 * channel and every console stats/instance surface reads it back. The wire
 * fixture is the vendored runtime contract, so this test also proves the two
 * sides agree on the shape.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'
import type { BundleStore } from 'openflare-control'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'cell-report-token'
const TEST_SECRETS_CIPHER = createSecretsCipher('test-secrets-cipher-key-0001')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class NoBundles implements BundleStore {
  async put() {
    return { key: 'x', sha256: 'f'.repeat(64) }
  }
  async get() {
    return null
  }
}

maybe('cell report e2e', () => {
  let pool: Pool
  let store: ReturnType<typeof createPlaneStore>
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `report-${suffix}`
  const provisionCellToken = async (cellId: string) => {
    await pool.query(
      'insert into plane_cells (cell_id, cluster_id) values ($1,$1) on conflict (cell_id) do nothing',
      [cellId]
    )
    await pool.query(
      `insert into plane_cell_tokens (cell_id, token_hash) values ($1,$2)
         on conflict (cell_id) do update set token_hash=excluded.token_hash`,
      [cellId, createHash('sha256').update(TOKEN).digest('hex')]
    )
  }
  const team = `team-${suffix}`
  const worker = 'w'
  const workerId = `${team}:${worker}`
  const base = `/api/v1/cells/${cell}`
  const auth = { authorization: `Bearer ${TOKEN}` }
  const json = { ...auth, 'content-type': 'application/json' }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    store = createPlaneStore(pool)
    app = createApp({
      store,
      pool,
      bundleStore: new NoBundles(),
      adminToken: TOKEN,
      secrets: TEST_SECRETS_CIPHER,
      signing: resolvePlaneSigningKey('cell-report-signing-secret-0123456789abcdef'),
    })
    await provisionCellToken(cell)
  })
  afterAll(async () => {
    await pool.end()
  })

  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = json
  ): Promise<any> {
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  async function fixtureReport(): Promise<any> {
    const raw = await readFile(
      new URL('../../../packages/control/test/fixtures/cell-report.json', import.meta.url),
      'utf8'
    )
    const report = JSON.parse(raw)
    const now = Date.now()
    report.cellId = cell
    report.sampledAtMs = now
    report.windowMs = 30_000
    report.pods[0].podId = 'pod-0'
    report.pods[0].workers[0].workerId = workerId
    report.pods[0].tenants[0].tenantId = team
    report.pods[0].tenants[0].doStorage[0].workerId = workerId
    report.resources.sampledAtMs = now
    const d1Key = Object.keys(report.resources.d1)[0]!
    report.resources.d1[databaseId] = report.resources.d1[d1Key]
    delete report.resources.d1[d1Key]
    const queueKey = Object.keys(report.resources.queues)[0]!
    report.resources.queues[queueId] = report.resources.queues[queueKey]
    delete report.resources.queues[queueKey]
    report.resources.workflows[workerId] = {
      OrderWorkflow: report.resources.workflows['team-001:api'].order,
    }
    report.resources.durableObjects[workerId] = {
      MyDO: report.resources.durableObjects['team-001:api'].Counter,
    }
    return report
  }

  let databaseId = ''
  let queueId = ''
  let bucket = ''

  it('ingests the report and serves real metrics + resources + instances', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'E2E' })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)

    // Version: DO class declared, queue consumer bound.
    const queue = await call('POST', `${base}/queues`, {
      teamId: team,
      name: 'jobs',
      deliveryDelaySeconds: 5,
    })
    expect(queue.status).toBe(201)
    queueId = queue.body.data.queue.queue_id
    const bundleA = new TextEncoder().encode('report-a')
    const bundleB = new TextEncoder().encode('report-b')
    const digestA = createHash('sha256').update(bundleA).digest('hex')
    const digestB = createHash('sha256').update(bundleB).digest('hex')
    for (const [digest, body] of [
      [digestA, bundleA],
      [digestB, bundleB],
    ] as const) {
      expect(
        (
          await app.request(`/api/v1/cells/${cell}/bundles/${digest}`, {
            method: 'PUT',
            headers: auth,
            body,
          })
        ).status
      ).toBe(201)
    }
    const version = await call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
      versionId: `report-${suffix}`,
      bundleSha256: digestA,
      bundleBytes: bundleA.byteLength,
      vars: {},
      queueConsumers: [{ queueId, queueName: 'jobs', maxBatchSize: 10 }],
      exportedClassNames: ['MyDO'],
    })
    expect(version.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/report-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    // An inactive version must not inflate the queue consumer count.
    expect(
      (
        await call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
          versionId: `inactive-${suffix}`,
          bundleSha256: digestB,
          bundleBytes: bundleB.byteLength,
          vars: {},
          queueConsumers: [{ queueId, queueName: 'jobs', maxBatchSize: 10 }],
          exportedClassNames: ['MyDO'],
        })
      ).status
    ).toBe(201)

    const d1 = await call('POST', `${base}/d1/databases`, { teamId: team, name: 'main' })
    expect(d1.status).toBe(201)
    databaseId = d1.body.data.database.database_id
    // A pending migration is real control-plane state (not in the report).
    expect(
      (
        await call('POST', `${base}/d1/databases/${databaseId}/migrations`, {
          migrations: [{ name: '0001_init', sql: 'create table t(a text)' }],
        })
      ).status
    ).toBe(202)
    await store.recordCellCapabilities(cell, {
      cron: true,
      assets: true,
      workflows: true,
      workflowsCrossWorker: true,
    })
    const wf = await call('POST', `${base}/teams/${team}/workers/${worker}/workflows`, {
      name: 'OrderWorkflow',
      className: 'OrderWorkflow',
    })
    expect(wf.status).toBe(201)
    const r2 = await call('POST', `${base}/r2/buckets`, {
      teamId: team,
      bucketName: `b-${suffix}`,
    })
    expect(r2.status).toBe(201)
    bucket = r2.body.data.bucket.bucket_name
    await pool.query(`update plane_cells set capabilities=$1 where cell_id=$2`, [
      { r2: true },
      cell,
    ])

    // Wire validation: auth, cell binding, schema.
    expect((await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, {}, {})).status).toBe(
      401
    )
    const report = await fixtureReport()
    const crossCell = { ...report, cellId: 'someone-else' }
    expect(
      (await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, crossCell)).status
    ).toBe(403)
    expect(
      (
        await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, {
          ...report,
          schemaVersion: 2,
        })
      ).status
    ).toBe(400)
    const ingested = await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, report)
    expect(ingested.status).toBe(200)
    expect(ingested.body.data).toMatchObject({ stored: true, duplicate: false, pods: 1 })
    // A retried push is idempotent: same (cell, sampledAt) never double-counts.
    const retried = await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, report)
    expect(retried.status).toBe(200)
    expect(retried.body.data).toMatchObject({ stored: false, duplicate: true })
    const storedRow = await pool.query(
      'select payload from plane_cell_metrics where cell_id=$1 and sampled_at=$2',
      [cell, new Date(report.sampledAtMs)]
    )
    expect(storedRow.rows[0]?.payload.resources).toBeUndefined()
    expect(storedRow.rows[0]?.payload.pods).toHaveLength(1)

    // Cell metrics: deltas + CPU + cold starts + latency.
    const metrics = await call('GET', `${base}/metrics`)
    expect(metrics.status).toBe(200)
    expect(metrics.body.data).toMatchObject({
      source: 'runtime',
      requests: 10,
      errors: 1,
      serverErrors: 1,
      cpuMs: 250,
      coldStarts: 0,
      launches: { ready: 1, failed: 0 },
      durationCount: 10,
    })
    expect(metrics.body.data.latency.p50).toBe(50)
    expect(metrics.body.data.latency.p99).toBe(500)
    expect(metrics.body.data.workers).toEqual([
      {
        workerId,
        requests: 10,
        errors: 1,
        serverErrors: 1,
        exceptions: 0,
        requestBytes: 120,
        responseBytes: 2048,
        inflight: 0,
        latency: { p50: 50, p99: 500 },
      },
    ])

    // Worker metrics: request/latency real, CPU explicitly null.
    const workerMetrics = await call('GET', `${base}/teams/${team}/workers/${worker}/metrics`)
    expect(workerMetrics.body.data.requests).toBe(10)
    expect(workerMetrics.body.data.cpuMs).toBeNull()
    expect(workerMetrics.body.data.coldStarts).toBeNull()
    expect(workerMetrics.body.data.latency.p99).toBe(500)

    // An out-of-order older report must never regress the resource snapshot.
    const staleReport = await fixtureReport()
    staleReport.sampledAtMs = report.sampledAtMs - 10_000
    staleReport.resources.sampledAtMs = staleReport.sampledAtMs
    staleReport.resources.d1[databaseId].sizeBytes = 1
    expect(
      (await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, staleReport)).status
    ).toBe(200)
    const stillFresh = await call('GET', `${base}/d1/databases/${databaseId}/stats`)
    expect(stillFresh.body.data.sizeBytes).toBe(16384)

    // D1: real size/tables from the report + pending migration from the ledger.
    const d1Stats = await call('GET', `${base}/d1/databases/${databaseId}/stats`)
    expect(d1Stats.body.data).toMatchObject({
      sizeBytes: 16384,
      pageCount: 4,
      tableCount: 1,
      tables: ['t'],
      pendingMigrations: 1,
    })
    expect(d1Stats.body.data.sampledAt).toBeTruthy()

    // Queue: backlog/visible/dead from the data plane.
    const qStats = await call('GET', `${base}/queues/${queueId}/stats`)
    expect(qStats.body.data).toMatchObject({
      backlog: 1,
      backlogBytes: 2,
      visible: 1,
      inFlight: 0,
      delayed: 0,
      deadLetterDepth: 0,
      consumers: 1,
    })
    expect(qStats.body.data.oldestMessageAgeMs).toBeGreaterThanOrEqual(0)

    // Workflow: instance count/storage real; per-state counters stay null.
    const wfStats = await call(
      'GET',
      `${base}/teams/${team}/workers/${worker}/workflows/OrderWorkflow/stats`
    )
    expect(wfStats.body.data).toMatchObject({
      instances: 1,
      storageBytes: 4096,
      truncated: false,
      runningInstances: null,
    })

    // DO: declared/bindings + instances/storage real.
    expect(
      (
        await call('POST', `${base}/teams/${team}/workers/${worker}/durable-object-classes`, {
          className: 'MyDO',
        })
      ).status
    ).toBe(201)
    const doStats = await call('GET', `${base}/durable-objects/MyDO/stats`)
    expect(doStats.body.data).toMatchObject({
      workers: 1,
      instances: 1,
      storageBytes: 8192,
      activeInstances: null,
    })

    // Instance listings are now live (no 501).
    const wfInstances = await call('GET', `${base}/workflows/OrderWorkflow/instances`)
    expect(wfInstances.status).toBe(200)
    expect(wfInstances.body.data.instances).toEqual([{ id: 'a'.repeat(64), bytes: 4096, workerId }])
    expect(wfInstances.body.data.total).toBe(1)
    const doInstances = await call('GET', `${base}/durable-objects/MyDO/instances`)
    expect(doInstances.status).toBe(200)
    expect(doInstances.body.data.instances).toEqual([{ id: 'b'.repeat(64), bytes: 8192, workerId }])
    expect(doInstances.body.data.storageBytes).toBe(8192)

    // Unknown resources still fail closed.
    expect((await call('GET', `${base}/workflows/Nope/instances`)).status).toBe(404)
    expect((await call('GET', `${base}/durable-objects/Nope/instances`)).status).toBe(404)

    // R2 stats: the API enqueues R2_STATS; ack it while the request waits.
    const waiting = call('GET', `${base}/r2/buckets/${bucket}/stats?waitMs=5000`)
    let op: any = null
    for (let i = 0; i < 40 && !op; i++) {
      await sleep(50)
      const found = await pool.query(
        `select id, seq from plane_cell_ops
          where cell_id=$1 and kind='R2_STATS' and status='PENDING'
          order by seq desc limit 1`,
        [cell]
      )
      op = found.rows[0] ?? null
    }
    expect(op).toBeTruthy()
    expect(
      (
        await call('POST', `/api/internal/clusters/${cell}/vrt/cell-ops/ack`, {
          acks: [
            {
              seq: Number(op.seq),
              status: 'DONE',
              result: { objects: 3, sizeBytes: 11, truncated: false, sampledAtMs: Date.now() },
            },
          ],
        })
      ).body.data.acked
    ).toBe(1)
    const r2Stats = await waiting
    expect(r2Stats.status).toBe(200)
    expect(r2Stats.body.data).toMatchObject({
      objects: 3,
      sizeBytes: 11,
      truncated: false,
      pending: false,
      error: null,
    })
    expect(r2Stats.body.data.sampledAt).toBeTruthy()

    // A second read hits the cached DONE result without enqueueing.
    const cached = await call('GET', `${base}/r2/buckets/${bucket}/stats?waitMs=0`)
    expect(cached.body.data).toMatchObject({
      objects: 3,
      sizeBytes: 11,
      pending: false,
      stale: false,
    })

    // refresh=1 bypasses a fresh cache and rescans.
    const refreshing = call('GET', `${base}/r2/buckets/${bucket}/stats?refresh=1&waitMs=5000`)
    let refreshOp: any = null
    for (let i = 0; i < 40 && !refreshOp; i++) {
      await sleep(50)
      const found = await pool.query(
        `select id, seq from plane_cell_ops
          where cell_id=$1 and kind='R2_STATS' and status='PENDING'
          order by seq desc limit 1`,
        [cell]
      )
      refreshOp = found.rows[0] ?? null
    }
    expect(refreshOp).toBeTruthy()
    expect(
      (
        await call('POST', `/api/internal/clusters/${cell}/vrt/cell-ops/ack`, {
          acks: [
            {
              seq: Number(refreshOp.seq),
              status: 'DONE',
              result: { objects: 4, sizeBytes: 15, truncated: false, sampledAtMs: Date.now() },
            },
          ],
        })
      ).body.data.acked
    ).toBe(1)
    const refreshed = await refreshing
    expect(refreshed.body.data).toMatchObject({
      objects: 4,
      sizeBytes: 15,
      pending: false,
      stale: false,
    })

    // Class A/B counters are a 24h window, not all-time.
    await pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, status, created_at)
       values
         ($1,$3,'',$4,'R2_PUT','{}','DONE', now() - interval '2 days'),
         ($2,$3,'',$4,'R2_PUT','{}','DONE', now())`,
      [`r2-old-${suffix}`, `r2-new-${suffix}`, cell, r2.body.data.bucket.bucket_id]
    )
    const withOps = await call('GET', `${base}/r2/buckets/${bucket}/stats?waitMs=0`)
    expect(withOps.body.data.classAOps).toBe(1)
  })

  it('falls back to logs before the first report arrives', async () => {
    const other = `logs-${suffix}`
    expect((await call('POST', '/api/v1/cells', { cellId: other })).status).toBe(201)
    await provisionCellToken(other)
    await call('POST', `/api/internal/clusters/${other}/vrt/logs`, {
      podId: 'p',
      bootId: 'b',
      records: [
        { seq: 1, workerId: 'team:w', tsMs: Date.now(), kind: 'request', outcome: 'ok' },
        { seq: 2, workerId: 'team:w', tsMs: Date.now(), kind: 'request', outcome: 'exception' },
      ],
    })
    const metrics = await call('GET', `/api/v1/cells/${other}/metrics`)
    expect(metrics.body.data).toMatchObject({
      source: 'logs',
      requests: 2,
      errors: 1,
      cpuMs: null,
      coldStarts: null,
    })
    expect((await call('DELETE', `/api/v1/cells/${other}`)).status).toBe(200)
  })
})
