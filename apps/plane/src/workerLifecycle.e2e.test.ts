/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/**
 * Worker lifecycle e2e: bundle upload → deploy (create/activate/publish) →
 * status update → delete, plus the fail-closed bundle checks. The desired
 * envelope is read back from the cell channel to prove the update actually
 * changes what the runtime will serve.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { bundleKeyFor, type BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { createSecretsCipher } from './secretsCipher.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'worker-lifecycle-token'
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

class MemoryBundles implements BundleStore {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, body: Uint8Array) {
    const digest = sha256(body)
    this.objects.set(digest, body)
    return { key: key ?? bundleKeyFor(digest), sha256: digest }
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
  async has(key: string) {
    return this.objects.has(key.slice(key.lastIndexOf('/') + 1))
  }
}

maybe('worker lifecycle e2e', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `life-${suffix}`
  const team = `team-${suffix}`
  const worker = 'edge'
  const id = `${team}:${worker}`
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
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      signing: resolvePlaneSigningKey('worker-lifecycle-signing-secret-0123456789abcdef'),
      secrets: createSecretsCipher('worker-lifecycle-secrets-key'),
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

  async function desiredWorkerIds(): Promise<string[]> {
    const res = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    expect(res.status).toBe(200)
    const envelope = await res.json()
    const tenants = envelope.payload?.tenants ?? []
    return tenants.flatMap((t: any) => (t.workers ?? []).map((w: any) => w.workerId))
  }

  it('uploads, deploys, suspends, updates and deletes a worker', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'E2E' })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)

    // A deploy without an uploaded bundle fails closed.
    expect(
      (
        await call('POST', `${base}/teams/${team}/workers/${worker}/deploy`, {
          versionId: 'missing',
          bundleSha256: 'a'.repeat(64),
          vars: {},
        })
      ).status
    ).toBe(409)

    const bundle = new TextEncoder().encode('export default { fetch: () => new Response("ok") }')
    const digest = sha256(bundle)
    expect(
      (
        await app.request(`${base}/bundles/${digest}`, {
          method: 'PUT',
          headers: auth,
          body: bundle,
        })
      ).status
    ).toBe(201)

    // Wrong claimed size is rejected before any version row exists.
    expect(
      (
        await call('POST', `${base}/teams/${team}/workers/${worker}/deploy`, {
          versionId: 'bad-size',
          bundleSha256: digest,
          bundleBytes: bundle.byteLength + 1,
          vars: {},
        })
      ).status
    ).toBe(409)

    const deployed = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy`, {
      versionId: 'v1',
      bundleSha256: digest,
      bundleBytes: bundle.byteLength,
      compatibilityDate: '2025-01-01',
      vars: { GREETING: 'hi' },
      bindings: [],
      activate: true,
      publish: true,
    })
    expect(deployed.status).toBe(201)
    expect(deployed.body.data).toMatchObject({ created: true, activated: true })
    expect(deployed.body.data.revision).toBeGreaterThan(0)
    expect(await desiredWorkerIds()).toContain(id)

    // Metadata update is visible, and status is honored by the desired builder
    // (a suspended worker must not be served).
    expect(
      (
        await call('PATCH', `${base}/teams/${team}/workers/${worker}`, {
          entrypoint: 'src/main.ts',
          status: 'SUSPENDED',
        })
      ).status
    ).toBe(200)
    expect(
      (await call('GET', `${base}/teams/${team}/workers/${worker}`)).body.data.worker.entrypoint
    ).toBe('src/main.ts')
    expect((await call('POST', `${base}/publish`, { cause: 'TEST' })).status).toBe(201)
    expect(await desiredWorkerIds()).not.toContain(id)

    expect(
      (await call('PATCH', `${base}/teams/${team}/workers/${worker}`, { status: 'ACTIVE' })).status
    ).toBe(200)
    expect((await call('POST', `${base}/publish`, { cause: 'TEST' })).status).toBe(201)
    expect(await desiredWorkerIds()).toContain(id)

    // A second upload/deploy with different content creates a new version.
    const bundle2 = new TextEncoder().encode('export default { fetch: () => new Response("v2") }')
    const digest2 = sha256(bundle2)
    expect(
      (
        await app.request(`${base}/bundles/${digest2}`, {
          method: 'PUT',
          headers: auth,
          body: bundle2,
        })
      ).status
    ).toBe(201)
    const deployed2 = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy`, {
      versionId: 'v2',
      bundleSha256: digest2,
      bundleBytes: bundle2.byteLength,
      vars: { GREETING: 'hi' },
      activate: true,
      publish: true,
    })
    expect(deployed2.status).toBe(201)
    expect(deployed2.body.data.created).toBe(true)
    expect(
      (await call('GET', `${base}/teams/${team}/workers/${worker}`)).body.data.worker
        .activeVersionId
    ).toBe('v2')

    // Delete + publish removes the worker from the cell's desired state.
    expect((await call('DELETE', `${base}/teams/${team}/workers/${worker}`)).status).toBe(200)
    expect((await call('GET', `${base}/teams/${team}/workers/${worker}`)).status).toBe(404)
    expect((await call('POST', `${base}/publish`, { cause: 'TEST' })).status).toBe(201)
    expect(await desiredWorkerIds()).not.toContain(id)
  })
})
