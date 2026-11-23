/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/**
 * Service resource API e2e: D1, R2, KV, queues and workflows are managed over
 * HTTP and their data operations ride the generic cell-op channel.
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
const TOKEN = 'services-e2e-token'
const TEST_SECRETS_CIPHER = createSecretsCipher('test-secrets-cipher-key-0001')

class NoBundles implements BundleStore {
  async put() {
    return { key: 'x', sha256: 'f'.repeat(64) }
  }
  async get() {
    return null
  }
}

maybe('service resource API e2e', () => {
  let pool: Pool
  let store: ReturnType<typeof createPlaneStore>
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `svc-${suffix}`
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
      signing: resolvePlaneSigningKey('services-signing-secret-1234'),
    })
    await provisionCellToken(cell)
  })
  afterAll(async () => {
    await pool.end()
  })

  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await app.request(path, {
      method,
      headers: json,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  async function ackCellOp(opId: string): Promise<any> {
    const listed = await call('GET', `/api/v1/cells/${cell}/cell-ops`)
    const op = (listed.body.data.ops as { id: string; seq: number }[]).find((o) => o.id === opId)
    expect(op).toBeTruthy()
    const ack = await call('POST', `/api/internal/clusters/${cell}/vrt/cell-ops/ack`, {
      acks: [{ seq: op!.seq, status: 'DONE', result: { ok: true } }],
    })
    expect(ack.body.data.acked).toBe(1)
    return op
  }

  it('manages D1, R2, KV, queues and workflows', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    const base = `/api/v1/cells/${cell}`
    expect(
      (await call('POST', `/api/v1/cells/${cell}/workers`, { teamId: team, name: worker })).status
    ).toBe(201)
    const workerId = `${team}:${worker}`

    // D1 database + query op
    const d1 = await call('POST', `/api/v1/cells/${cell}/d1/databases`, {
      teamId: team,
      name: 'main',
    })
    expect(d1.status).toBe(201)
    const databaseId = d1.body.data.database.database_id as string
    const query = await call('POST', `/api/v1/cells/${cell}/d1/databases/${databaseId}/query`, {
      sql: 'select 1 as n',
    })
    expect(query.status).toBe(202)
    const d1Op = (await call('GET', `/api/v1/cells/${cell}/d1-ops`)).body.data.ops[0]
    expect(d1Op.kind).toBe('EXECUTE')
    expect(
      (
        await call('POST', `/api/internal/clusters/${cell}/vrt/d1-ops/ack`, {
          acks: [{ seq: d1Op.seq, status: 'DONE', result: { results: [{ n: 1 }] } }],
        })
      ).body.data.acked
    ).toBe(1)
    const waited = await call(
      'GET',
      `/api/v1/cells/${cell}/ops/${query.body.data.opId}?waitMs=1000`
    )
    expect(waited.body.data.op.status).toBe('DONE')
    expect(
      (await call('GET', `/api/v1/cells/${cell}/d1/databases`)).body.data.databases
    ).toHaveLength(1)

    // R2 bucket + data op
    const r2 = await call('POST', `/api/v1/cells/${cell}/r2/buckets`, {
      teamId: team,
      bucketName: `b-${suffix}`,
    })
    expect(r2.status).toBe(201)
    const bucket = r2.body.data.bucket.bucket_name as string
    const r2Op = await call('POST', `/api/v1/cells/${cell}/r2/buckets/${bucket}/ops`, {
      kind: 'R2_PUT',
      payload: {
        key: 'hello.txt',
        bodyBase64: Buffer.from('hello').toString('base64'),
        contentType: 'text/plain',
      },
    })
    expect(r2Op.status).toBe(202)
    await ackCellOp(r2Op.body.data.opId)

    // KV namespace + data op
    const kv = await call('POST', `/api/v1/cells/${cell}/kv/namespaces`, {
      teamId: team,
      title: `cache-${suffix}`,
    })
    expect(kv.status).toBe(201)
    const namespaceId = kv.body.data.namespace.namespace_id as string
    const kvOp = await call('POST', `/api/v1/cells/${cell}/kv/namespaces/${namespaceId}/ops`, {
      kind: 'KV_GET',
      payload: { key: 'hello' },
    })
    expect(kvOp.status).toBe(202)
    await ackCellOp(kvOp.body.data.opId)

    // Queue metadata + delay update
    const queue = await call('POST', `/api/v1/cells/${cell}/queues`, {
      teamId: team,
      name: 'jobs',
      deliveryDelaySeconds: 5,
    })
    expect(queue.status).toBe(201)
    const queueId = queue.body.data.queue.queue_id as string
    const patched = await call('PATCH', `/api/v1/cells/${cell}/queues/${queueId}`, {
      deliveryDelaySeconds: 10,
    })
    expect(patched.body.data.queue.delivery_delay_seconds).toBe(10)

    // Queue consumer + DO classes travel with the version. The bundle must
    // be uploaded first (content-addressed).
    const bundle = new TextEncoder().encode(`export default { fetch: () => new Response('svc') }`)
    const digest = createHash('sha256').update(bundle).digest('hex')
    expect(
      (
        await app.request(`/api/v1/cells/${cell}/bundles/${digest}`, {
          method: 'PUT',
          headers: auth,
          body: bundle,
        })
      ).status
    ).toBe(201)
    const version = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`,
      {
        versionId: `svc-${suffix}`,
        bundleSha256: digest,
        bundleBytes: bundle.byteLength,
        vars: {},
        queueConsumers: [{ queueId, queueName: 'jobs', maxBatchSize: 10 }],
        exportedClassNames: ['MyDO'],
      }
    )
    expect(version.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions/svc-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    const doClass = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-object-classes`,
      { className: 'MyDO' }
    )
    expect(doClass.status).toBe(201)
    const dos = await call(
      'GET',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-objects`
    )
    expect(dos.body.data.classes).toEqual([
      expect.objectContaining({
        className: 'MyDO',
        uniqueKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        enableSql: true,
      }),
    ])

    const doVersion = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`,
      {
        versionId: `do-${suffix}`,
        bundleSha256: digest,
        bundleBytes: bundle.byteLength,
        queueConsumers: [{ queueId, queueName: 'jobs', maxBatchSize: 10 }],
        bindings: [
          {
            name: 'MY_DO',
            type: 'DO',
            resourceId: `${workerId}:MyDO`,
            permissionRead: true,
            permissionWrite: false,
          },
        ],
      }
    )
    expect(doVersion.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions/do-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    expect(
      (
        await call('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`, {
          versionId: `bad-do-${suffix}`,
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          bindings: [
            {
              name: 'BAD_DO',
              type: 'DO',
              resourceId: `${workerId}:MissingDO`,
              permissionRead: true,
              permissionWrite: false,
            },
          ],
        })
      ).status
    ).toBe(400)
    expect((await call('POST', `/api/v1/cells/${cell}/publish`, { cause: 'DO' })).status).toBe(201)
    const doDesired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    const doEnvelope = (await doDesired.json()) as any
    const doServed = doEnvelope.payload.tenants
      .flatMap((tenant: any) => tenant.workers)
      .find((candidate: any) => candidate.workerId === workerId)
    expect(doServed.durableObjectClasses).toEqual([
      expect.objectContaining({ className: 'MyDO', enableSql: true }),
    ])
    expect(doServed.bindings).toContainEqual(
      expect.objectContaining({ type: 'durableObject', name: 'MY_DO', className: 'MyDO' })
    )
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-object-classes/migrations`,
          { newSqliteClasses: ['ExtraDO'] }
        )
      ).status
    ).toBe(200)
    // Rename keeps the existing storage key; re-creating the old name mints
    // a new key instead of aliasing the renamed class.
    const temp = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-object-classes`,
      { className: 'TempDO' }
    )
    expect(temp.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-object-classes/migrations`,
          { renamedClasses: [{ from: 'TempDO', to: 'TempDO2' }] }
        )
      ).status
    ).toBe(200)
    const recreated = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-object-classes`,
      { className: 'TempDO' }
    )
    expect(recreated.body.data.uniqueKey).not.toBe(temp.body.data.uniqueKey)
    expect(
      (
        await call(
          'DELETE',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/durable-object-classes/MyDO`
        )
      ).status
    ).toBe(409)
    expect(
      (await call('POST', `/api/v1/cells/${cell}/publish`, { cause: 'DO-MIGRATE' })).status
    ).toBe(201)

    // Workflow declaration + instance op
    await store.recordCellCapabilities(cell, {
      cron: true,
      assets: true,
      d1: true,
      queue: true,
      workflows: true,
      workflowsCrossWorker: true,
      flagship: true,
      secretsStore: true,
    })
    // Flagship app + binding ride the next publication.
    const flagship = await call(
      'PUT',
      `/api/v1/cells/${cell}/teams/${team}/flagship/apps/checkout`,
      {
        config: {
          flags: {
            newCheckout: {
              type: 'boolean',
              enabled: true,
              variants: { on: true, off: false },
              defaultVariant: 'off',
            },
          },
        },
      }
    )
    expect(flagship.status).toBe(201)
    const flagshipVersion = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`,
      {
        versionId: `flagship-${suffix}`,
        bundleSha256: digest,
        bundleBytes: bundle.byteLength,
        queueConsumers: [{ queueId, queueName: 'jobs', maxBatchSize: 10 }],
        bindings: [
          {
            name: 'FLAGS',
            type: 'FLAGSHIP',
            resourceId: 'checkout',
            permissionRead: true,
            permissionWrite: false,
          },
          {
            name: 'MY_DO',
            type: 'DO',
            resourceId: `${workerId}:MyDO`,
            permissionRead: true,
            permissionWrite: false,
          },
        ],
      }
    )
    expect(flagshipVersion.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions/flagship-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    expect(
      (await call('POST', `/api/v1/cells/${cell}/publish`, { cause: 'FLAGSHIP' })).status
    ).toBe(201)
    const flagshipDesired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    const flagshipEnvelope = (await flagshipDesired.json()) as any
    const flagshipTenant = flagshipEnvelope.payload.tenants.find(
      (tenant: any) => tenant.tenantId === team
    )
    expect(flagshipTenant.flagshipApps).toEqual([
      expect.objectContaining({
        appId: 'checkout',
        config: expect.stringContaining('newCheckout'),
      }),
    ])
    expect(flagshipTenant.flagshipApps).toEqual([
      expect.objectContaining({
        appId: 'checkout',
        config: expect.stringContaining('newCheckout'),
      }),
    ])
    expect(
      (
        await call('PUT', `/api/v1/cells/${cell}/teams/${team}/flagship/apps/bad`, {
          config: {
            flags: {
              bad: { type: 'nope', enabled: true, variants: {}, defaultVariant: 'x' },
            },
          },
        })
      ).status
    ).toBe(400)
    expect(
      (
        await call('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`, {
          versionId: `flagship-missing-${suffix}`,
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          bindings: [
            {
              name: 'FLAGS',
              type: 'FLAGSHIP',
              resourceId: 'missing',
              permissionRead: true,
              permissionWrite: false,
            },
          ],
        })
      ).status
    ).toBe(400)
    expect(
      (await call('DELETE', `/api/v1/cells/${cell}/teams/${team}/flagship/apps/checkout`)).status
    ).toBe(409)

    // Secrets Store value + binding.
    expect(
      (
        await call('PUT', `/api/v1/cells/${cell}/teams/${team}/secrets-store/default/API_KEY`, {
          value: 'store-secret',
        })
      ).status
    ).toBe(200)
    const secretsVersion = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`,
      {
        versionId: `secrets-${suffix}`,
        bundleSha256: digest,
        bundleBytes: bundle.byteLength,
        queueConsumers: [{ queueId, queueName: 'jobs', maxBatchSize: 10 }],
        bindings: [
          {
            name: 'FLAGS',
            type: 'FLAGSHIP',
            resourceId: 'checkout',
            permissionRead: true,
            permissionWrite: false,
          },
          {
            name: 'MY_DO',
            type: 'DO',
            resourceId: `${workerId}:MyDO`,
            permissionRead: true,
            permissionWrite: false,
          },
          {
            name: 'SECRETS',
            type: 'SECRETS_STORE',
            resourceId: 'default:API_KEY',
            storeId: 'default',
            secretName: 'API_KEY',
            permissionRead: true,
            permissionWrite: false,
          },
        ],
      }
    )
    expect(secretsVersion.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions/secrets-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    expect((await call('POST', `/api/v1/cells/${cell}/publish`, { cause: 'SECRETS' })).status).toBe(
      201
    )
    const secretInputs = await app.request(`/api/internal/clusters/${cell}/vrt/render-inputs`, {
      headers: auth,
    })
    const secretBody = (await secretInputs.json()) as any
    expect(secretBody.tenants[team].secrets['secrets-store:default:API_KEY']).toBe('store-secret')
    const secretsDesired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    const secretsEnvelope = (await secretsDesired.json()) as any
    const secretsServed = secretsEnvelope.payload.tenants
      .flatMap((tenant: any) => tenant.workers)
      .find((candidate: any) => candidate.workerId === workerId)
    expect(secretsServed.bindings).toContainEqual(
      expect.objectContaining({
        type: 'secretsStore',
        name: 'SECRETS',
        storeId: 'default',
        secretName: 'API_KEY',
        secretRef: 'secrets-store:default:API_KEY',
      })
    )
    const stored = await pool.query(
      'select value from plane_secrets_store where team_id=$1 and store_id=$2 and secret_name=$3',
      [team, 'default', 'API_KEY']
    )
    expect((stored.rows[0] as { value: string }).value).toMatch(/^enc:v1:/)
    expect(
      (
        await call('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`, {
          versionId: `secrets-missing-${suffix}`,
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          bindings: [
            {
              name: 'SECRETS',
              type: 'SECRETS_STORE',
              resourceId: 'default:missing',
              storeId: 'default',
              secretName: 'missing',
              permissionRead: true,
              permissionWrite: false,
            },
          ],
        })
      ).status
    ).toBe(400)
    expect(
      (await call('DELETE', `/api/v1/cells/${cell}/teams/${team}/secrets-store/default/API_KEY`))
        .status
    ).toBe(409)

    const wf = await call(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/workflows`,
      { name: 'OrderWorkflow', className: 'OrderWorkflow' }
    )
    expect(wf.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/workflows/OrderWorkflow/ops`,
          {
            kind: 'WF_CREATE',
            instanceId: 'i-1',
            params: { orderId: 42 },
          }
        )
      ).status
    ).toBe(202)
    expect(
      (
        await call('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/workflows`, {
          name: 'BadScript',
          className: 'BadScript',
          scriptName: 'missing',
        })
      ).status
    ).toBe(404)

    expect(
      (await call('POST', `/api/v1/cells/${cell}/publish`, { cause: 'WORKFLOW' })).status
    ).toBe(201)
    const desired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    expect(desired.status).toBe(200)
    const envelope = (await desired.json()) as any
    const served = envelope.payload.tenants
      .flatMap((tenant: any) => tenant.workers)
      .find((candidate: any) => candidate.workerId === workerId)
    expect(served.workflows).toEqual([
      expect.objectContaining({
        name: 'OrderWorkflow',
        binding: 'OrderWorkflow',
        className: 'OrderWorkflow',
        uniqueKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ])
    expect(
      (
        await call('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/versions`, {
          versionId: `wf-collision-${suffix}`,
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          vars: { OrderWorkflow: 1 },
        })
      ).status
    ).toBe(400)
    expect(
      (
        await call(
          'PUT',
          `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/vars/OrderWorkflow`,
          { value: 'x' }
        )
      ).status
    ).toBe(409)

    // Catalog sees every resource; bindings are ready to paste into a version.
    const services = await call('GET', `/api/v1/cells/${cell}/services`)
    expect(services.status).toBe(200)
    expect(services.body.data.d1[0].binding).toMatchObject({
      type: 'D1',
      resourceId: databaseId,
    })
    expect(services.body.data.r2[0].binding).toMatchObject({
      type: 'R2',
      resourceId: bucket,
    })
    expect(services.body.data.kv[0].binding).toMatchObject({
      type: 'KV',
      resourceId: namespaceId,
    })
    expect(services.body.data.queues[0].binding).toMatchObject({
      type: 'QUEUE',
      resourceId: queueId,
      deliveryDelaySeconds: 10,
    })
    expect(services.body.data.workflows[0]).toMatchObject({
      workerId,
      name: 'OrderWorkflow',
    })

    // Op polling by id exposes the generic channel to management clients.
    const ops = (await call('GET', `/api/v1/cells/${cell}/cell-ops`)).body.data.ops as {
      id: string
    }[]
    const first = await call('GET', `/api/v1/cells/${cell}/ops/${ops[0]!.id}`)
    expect(first.body.data.channel).toBe('cell')

    // Teams + quotas
    const teamCreated = await call('POST', '/api/v1/teams', {
      teamId: team,
      name: 'Services Team',
      plan: 'Pro',
    })
    expect(teamCreated.status).toBe(201)
    const quota = await call('PATCH', `/api/v1/teams/${team}`, {
      quotas: { requestsMonth: 1000, workersMax: 5 },
    })
    expect(quota.body.data.team.workers_max).toBe(5)

    // Hyperdrive metadata + binding identity
    const hd = await call('POST', `/api/v1/cells/${cell}/hyperdrive`, {
      teamId: team,
      name: 'pg',
      origin: 'postgres://db.internal:5432/app',
      caching: true,
    })
    expect(hd.status).toBe(201)
    const hdId = hd.body.data.hyperdrive.hyperdrive_id as string
    const hdBinding = await call(`GET`, `${base}/hyperdrive/${hdId}/binding`)
    expect(hdBinding.status).toBe(200)
    expect(hdBinding.body.data.binding.resourceId).toBe(`vrtdb:${hdId}`)
    const catalogWithHd = await call('GET', `${base}/services`)
    expect(catalogWithHd.body.data.hyperdrive[0].hyperdriveId).toBe(hdId)

    // Stats: real control-plane counts; data-plane-only numbers are null.
    expect((await call('GET', `${base}/metrics`)).status).toBe(200)
    const d1Stats = await call('GET', `${base}/d1/databases/${databaseId}/stats`)
    expect(d1Stats.body.data.ops).toBeGreaterThanOrEqual(1)
    expect(d1Stats.body.data.sizeBytes).toBeNull()
    const r2Stats = await call('GET', `${base}/r2/buckets/${bucket}/stats`)
    expect(r2Stats.body.data.ops).toBeGreaterThanOrEqual(1)
    expect(r2Stats.body.data.objects).toBeNull()
    const qStats = await call('GET', `${base}/queues/${queueId}/stats`)
    expect(qStats.body.data.consumers).toBeGreaterThanOrEqual(1)
    const wfStats = await call(
      'GET',
      `${base}/teams/${team}/workers/${worker}/workflows/OrderWorkflow/stats`
    )
    expect(wfStats.body.data.ops).toBeGreaterThanOrEqual(1)
    const doStats = await call('GET', `${base}/durable-objects/MyDO/stats`)
    expect(doStats.body.data.workers).toBeGreaterThanOrEqual(1)
    expect(doStats.body.data.instances).toBeNull()

    // Instance listings are live once the runtime reports; before that they
    // return an empty waiting view instead of a fabricated list.
    const wfWaiting = await call('GET', `${base}/workflows/OrderWorkflow/instances`)
    expect(wfWaiting.status).toBe(200)
    expect(wfWaiting.body.data.waiting).toBe(true)
    expect(wfWaiting.body.data.instances).toEqual([])
    const doWaiting = await call('GET', `${base}/durable-objects/MyDO/instances`)
    expect(doWaiting.status).toBe(200)
    expect(doWaiting.body.data.waiting).toBe(true)
    expect(doWaiting.body.data.instances).toEqual([])

    // Unauthenticated calls are rejected before any resource lookup.
    expect((await app.request(`/api/v1/cells/${cell}/services`)).status).toBe(401)

    // Cleanup. Deleting the cell removes workers; the team can then go.
    expect((await call('DELETE', `${base}/hyperdrive/${hdId}`)).status).toBe(200)
    expect((await call('DELETE', `/api/v1/cells/${cell}`)).status).toBe(200)
    expect((await call('DELETE', `/api/v1/teams/${team}`)).status).toBe(200)
  })

  it('covers service validation, missing-resource and op-list edges', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: `${cell}-e` })).status).toBe(201)
    const cellE = `${cell}-e`
    const base = `/api/v1/cells/${cellE}`

    // D1
    expect(
      (await call('POST', `${base}/d1/databases`, { teamId: team, name: 'BAD NAME' })).status
    ).toBe(400)
    expect((await call('GET', `${base}/d1/databases/nope`)).status).toBe(404)
    expect((await call('DELETE', `${base}/d1/databases/nope`)).status).toBe(404)
    const db = await call('POST', `${base}/d1/databases`, { teamId: team, name: 'db2' })
    const dbId = db.body.data.database.database_id as string
    expect(
      (
        await call('POST', `${base}/d1/databases/${dbId}/migrations`, {
          migrations: [{ name: 'm1', sql: 'create table t(v int)' }],
        })
      ).status
    ).toBe(202)
    expect((await call('GET', `${base}/d1/databases/${dbId}/ops`)).status).toBe(200)
    expect((await call('DELETE', `${base}/d1/databases/${dbId}`)).status).toBe(200)

    // R2
    expect(
      (await call('POST', `${base}/r2/buckets`, { teamId: team, bucketName: 'UPPER' })).status
    ).toBe(400)
    expect((await call('DELETE', `${base}/r2/buckets/none`)).status).toBe(404)
    const b = await call('POST', `${base}/r2/buckets`, {
      teamId: team,
      bucketName: `edge-${suffix}`,
    })
    const bucketName = b.body.data.bucket.bucket_name as string
    expect(
      (
        await call('POST', `${base}/r2/buckets/${bucketName}/ops`, {
          kind: 'R2_GET',
          payload: { tenantId: 'forged', key: 'x' },
        })
      ).status
    ).toBe(400)
    expect((await call('GET', `${base}/r2/buckets/${bucketName}/ops`)).status).toBe(200)
    expect((await call('DELETE', `${base}/r2/buckets/${bucketName}`)).status).toBe(200)

    // KV
    expect((await call('POST', `${base}/kv/namespaces`, { teamId: team, title: '' })).status).toBe(
      400
    )
    expect((await call('DELETE', `${base}/kv/namespaces/none`)).status).toBe(404)
    const kv = await call('POST', `${base}/kv/namespaces`, { teamId: team, title: 'edge' })
    const nsId = kv.body.data.namespace.namespace_id as string
    expect(
      (
        await call('POST', `${base}/kv/namespaces/${nsId}/ops`, {
          kind: 'KV_GET',
          payload: { namespaceId: 'forged', key: 'x' },
        })
      ).status
    ).toBe(400)
    expect((await call('GET', `${base}/kv/namespaces/${nsId}/ops`)).status).toBe(200)
    expect((await call('DELETE', `${base}/kv/namespaces/${nsId}`)).status).toBe(200)

    // Queue
    expect(
      (
        await call('POST', `${base}/queues`, {
          teamId: team,
          name: 'bad queue',
        })
      ).status
    ).toBe(400)
    expect((await call('DELETE', `${base}/queues/none`)).status).toBe(404)
    const q = await call('POST', `${base}/queues`, { teamId: team, name: 'q2' })
    const qid = q.body.data.queue.queue_id as string
    expect(
      (
        await call('PATCH', `${base}/queues/${qid}`, {
          deliveryDelaySeconds: 90_000,
        })
      ).status
    ).toBe(400)
    expect((await call('DELETE', `${base}/queues/${qid}`)).status).toBe(200)

    // Workflow
    expect(
      (
        await call('POST', `${base}/teams/${team}/workers/missing/workflows`, {
          name: 'W',
          className: 'W',
        })
      ).status
    ).toBe(404)
    expect((await call('DELETE', `${base}/teams/${team}/workers/missing/workflows/W`)).status).toBe(
      404
    )
    expect((await call('GET', `${base}/services`)).status).toBe(200)

    expect((await call('DELETE', `/api/v1/cells/${cellE}`)).status).toBe(200)
  })
})
