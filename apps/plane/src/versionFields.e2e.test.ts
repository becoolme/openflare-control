/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/**
 * Version-scoped wire fields: queue consumers, tail consumers, observability,
 * version metadata, typed vars, assets routing, and the content fingerprint.
 * Requires DATABASE_URL; skipped otherwise.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { bundleKeyFor, type BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'version-fields-token-0123456789'
const SECRETS = createSecretsCipher('version-fields-secrets-key')
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

class MemoryBundles implements BundleStore {
  readonly objects = new Map<string, Uint8Array>()
  async put(_key: string, body: Uint8Array) {
    const digest = sha256(body)
    this.objects.set(digest, body)
    return { key: bundleKeyFor(digest), sha256: digest }
  }
  async has(key: string) {
    return this.objects.has(key.slice(key.lastIndexOf('/') + 1))
  }
  async get(key: string) {
    const body = this.objects.get(key.slice(key.lastIndexOf('/') + 1))
    if (!body) return null
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body)
          controller.close()
        },
      }),
      bytes: body.byteLength,
    }
  }
}

maybe('version-scoped fields', () => {
  let pool: Pool
  let store: ReturnType<typeof createPlaneStore>
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `fields-${suffix}`
  const team = `team-${suffix}`
  const worker = 'hello'
  const tail = 'tail'
  const workerId = `${team}:${worker}`
  const tailId = `${team}:${tail}`
  let queueId = ''
  const base = `/api/v1/cells/${cell}`
  const auth = { authorization: `Bearer ${TOKEN}` }
  const json = { ...auth, 'content-type': 'application/json' }

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

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    store = createPlaneStore(pool)
    app = createApp({
      store,
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      signing: resolvePlaneSigningKey('version-fields-signing-secret'),
      secrets: SECRETS,
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
    headers = json
  ): Promise<{ status: number; body: any }> {
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  it('publishes every version-scoped field and fingerprints the full config', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', '/api/v1/teams', { teamId: team })).status).toBe(201)
    await store.recordCellCapabilities(cell, {
      cron: true,
      assets: true,
      queue: true,
      tailConsumers: true,
      streamingTailConsumers: true,
      observability: true,
      versionMetadata: true,
    })
    for (const name of [worker, tail]) {
      expect((await call('POST', `${base}/workers`, { teamId: team, name })).status).toBe(201)
    }

    const bundle = new TextEncoder().encode(`export default { fetch: () => new Response('ok') }`)
    const digest = sha256(bundle)
    const put = await app.request(`${base}/bundles/${digest}`, {
      method: 'PUT',
      headers: auth,
      body: bundle,
    })
    expect(put.status).toBe(201)

    const queue = await call('POST', `${base}/queues`, { teamId: team, name: 'jobs' })
    expect(queue.status).toBe(201)
    queueId = queue.body.data.queue.queue_id

    const create = (versionId: string, extra: Record<string, unknown> = {}) =>
      call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
        versionId,
        bundleSha256: digest,
        bundleBytes: bundle.byteLength,
        vars: {
          GREETING: 'hi',
          COUNT: 3,
          ENABLED: true,
          CONFIG: { mode: 'x' },
        },
        bindings: [
          {
            name: 'ASSETS',
            type: 'ASSETS',
            resourceId: 'a'.repeat(64),
            permissionRead: true,
            permissionWrite: false,
          },
        ],
        queueConsumers: [{ queueId, queueName: 'jobs' }],
        tailConsumers: [tailId],
        versionMetadata: 'CF_VERSION_METADATA',
        observability: {
          enabled: true,
          logsEnabled: true,
          invocationLogs: false,
          headSamplingRatePpm: 250_000,
        },
        assetsRouting: 'ASSETS_FIRST',
        assetsRunWorkerFirst: ['/api/*'],
        ...extra,
      })

    // Tail consumer must be an existing same-team/cell worker with a serving
    // version, so create that version first.
    const tailVersion = await call('POST', `${base}/teams/${team}/workers/${tail}/versions`, {
      versionId: `tv-${suffix}`,
      bundleSha256: digest,
      bundleBytes: bundle.byteLength,
    })
    expect(tailVersion.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${tail}/versions/tv-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)

    const created = await create(`v-${suffix}`)
    expect(created.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/v-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)

    const published = await call('POST', `${base}/publish`, { cause: 'FIELDS' })
    expect(published.status).toBe(201)
    const desired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    expect(desired.status).toBe(200)
    const envelope = (await desired.json()) as any
    const hello = envelope.payload.tenants[0].workers.find((w: any) => w.workerId === workerId)
    expect(hello).toBeTruthy()
    expect(hello.queueConsumers).toEqual([expect.objectContaining({ queueId, queueName: 'jobs' })])
    expect(hello.tailConsumers).toEqual([{ workerId: tailId }])
    expect(hello.observability).toMatchObject({
      enabled: true,
      logsEnabled: true,
      invocationLogs: false,
      headSamplingRatePpm: 250_000,
    })
    const assets = hello.bindings.find((b: any) => b.type === 'assets')
    expect(assets).toMatchObject({ assetsFirst: true, runWorkerFirst: ['/api/*'] })
    const jsonBindings = Object.fromEntries(
      hello.bindings.filter((b: any) => b.type === 'json').map((b: any) => [b.name, b.value])
    )
    expect(jsonBindings.COUNT).toBe('3')
    expect(jsonBindings.ENABLED).toBe('true')
    expect(jsonBindings.CONFIG).toBe('{"mode":"x"}')
    expect(JSON.parse(jsonBindings.CF_VERSION_METADATA)).toMatchObject({ id: `v-${suffix}` })

    const detail = await call('GET', `${base}/teams/${team}/workers/${worker}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.vars).toEqual([{ key: 'GREETING', value: 'hi' }])
    expect(detail.body.data.jsonVars).toMatchObject({
      COUNT: 3,
      ENABLED: true,
      CONFIG: { mode: 'x' },
    })
    expect(detail.body.data.queueConsumers).toHaveLength(1)
    expect(detail.body.data.tailConsumers).toEqual([tailId])
    expect(detail.body.data.assetsRouting).toBe('ASSETS_FIRST')

    // A different queue consumer set is a different version; identical
    // content still reuses the row.
    const changed = await create(`v2-${suffix}`, { queueConsumers: [] })
    expect(changed.status).toBe(201)
    expect(changed.body.data.created).toBe(true)
    const same = await create(`v3-${suffix}`, { queueConsumers: [] })
    expect(same.status).toBe(200)
    expect(same.body.data.created).toBe(false)

    // Staging a version must not mutate the serving version's render-inputs.
    const staged = await create(`staged-${suffix}`, { vars: { GREETING: 'staged' } })
    expect(staged.status).toBe(201)
    const stillServing = await app.request(`/api/internal/clusters/${cell}/vrt/render-inputs`, {
      headers: auth,
    })
    expect((await stillServing.json()).tenants[team].vars.GREETING).toBe('hi')

    // Fail-fast edges.
    expect(
      (
        await create(`bad-queue-${suffix}`, {
          queueConsumers: [{ queueId: 'q'.repeat(26), queueName: 'jobs' }],
        })
      ).status
    ).toBe(400)
    expect((await create(`collision-${suffix}`, { versionMetadata: 'GREETING' })).status).toBe(400)
    expect(
      (await create(`bad-tail-${suffix}`, { tailConsumers: [`other-team:${tail}`] })).status
    ).toBe(400)
    expect((await create(`self-tail-${suffix}`, { tailConsumers: [workerId] })).status).toBe(400)
    expect(
      (
        await create(`dual-tail-${suffix}`, {
          tailConsumers: [tailId],
          streamingTailConsumers: [tailId],
        })
      ).status
    ).toBe(400)
    expect(
      (
        await create(`bad-observability-${suffix}`, {
          observability: {
            enabled: true,
            logsEnabled: true,
            invocationLogs: true,
            headSamplingRatePpm: 1_000_001,
          },
        })
      ).status
    ).toBe(400)
    expect(
      (
        await create(`big-var-${suffix}`, {
          vars: { BIG: { value: 'x'.repeat(17 * 1024) } },
        })
      ).status
    ).toBe(400)
    // Referential integrity: an active tail target and a consumed queue
    // cannot be deleted or suspended out from under the serving worker.
    expect((await call('DELETE', `${base}/teams/${team}/workers/${tail}`)).status).toBe(409)
    expect(
      (
        await call('PATCH', `${base}/teams/${team}/workers/${tail}`, {
          status: 'SUSPENDED',
        })
      ).status
    ).toBe(409)
    expect((await call('DELETE', `${base}/queues/${queueId}`)).status).toBe(409)
    // Rollback restores the older version's string vars.
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/staged-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    let rolled = await app.request(`/api/internal/clusters/${cell}/vrt/render-inputs`, {
      headers: auth,
    })
    expect((await rolled.json()).tenants[team].vars.GREETING).toBe('staged')
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/v-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    rolled = await app.request(`/api/internal/clusters/${cell}/vrt/render-inputs`, {
      headers: auth,
    })
    expect((await rolled.json()).tenants[team].vars.GREETING).toBe('hi')

    // Activation is scoped to the URL cell.
    expect(
      (
        await call(
          'POST',
          `/api/v1/cells/other-${suffix}/teams/${team}/workers/${worker}/versions/v-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(404)

    // A secret cannot reuse a var/env name, even after the version exists.
    expect(
      (
        await call('PUT', `${base}/teams/${team}/workers/${worker}/secrets/GREETING`, {
          value: 'x',
        })
      ).status
    ).toBe(409)

    // Queue name/timeout validation is fail-fast.
    expect(
      (
        await create(`queue-name-${suffix}`, {
          queueConsumers: [{ queueId, queueName: 'other' }],
        })
      ).status
    ).toBe(400)
    expect(
      (
        await create(`queue-timeout-${suffix}`, {
          queueConsumers: [{ queueId, queueName: 'jobs', maxBatchTimeoutMs: 1500 }],
        })
      ).status
    ).toBe(400)

    // Optional fields fail closed on a cell that does not report the bit.
    const capsCell = `caps-${suffix}`
    expect((await call('POST', '/api/v1/cells', { cellId: capsCell })).status).toBe(201)
    expect(
      (await call('POST', `/api/v1/cells/${capsCell}/workers`, { teamId: team, name: 'obs' }))
        .status
    ).toBe(201)
    await store.recordCellCapabilities(capsCell, { cron: true, assets: true })
    expect(
      (
        await call('POST', `/api/v1/cells/${capsCell}/teams/${team}/workers/obs/versions`, {
          versionId: `obs-${suffix}`,
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          observability: {
            enabled: true,
            logsEnabled: true,
            invocationLogs: true,
            headSamplingRatePpm: 1,
          },
        })
      ).status
    ).toBe(409)
  })
})
