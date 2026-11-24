/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { bundleKeyFor, type BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { MemoryAssetStore } from './assetStore.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'assets-token-0123456789abcdef'
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

maybe('assets', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let assets: MemoryAssetStore
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `assets-${suffix}`
  const team = `team-${suffix}`
  const worker = 'w'
  const workerId = `${team}:${worker}`
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
    assets = new MemoryAssetStore()
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      signing: resolvePlaneSigningKey('assets-signing-secret-1234'),
      secrets: createSecretsCipher('assets-secrets-key'),
      assetStore: assets,
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

  it('uploads object + manifest and publishes ASSETS', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)

    const object = new TextEncoder().encode('<h1>hello</h1>')
    const objectDigest = sha256(object)
    const objectPut = await app.request(`${base}/teams/${team}/assets/objects/${objectDigest}`, {
      method: 'PUT',
      headers: auth,
      body: object,
    })
    expect(objectPut.status).toBe(201)

    const manifestBytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        htmlHandling: 'auto-trailing-slash',
        files: [
          { path: '/index.html', sha256: objectDigest, size: object.byteLength, mime: 'text/html' },
        ],
      })
    )
    const manifestDigest = sha256(manifestBytes)
    const manifestPut = await app.request(
      `${base}/teams/${team}/assets/manifests/${manifestDigest}`,
      { method: 'PUT', headers: auth, body: manifestBytes }
    )
    expect(manifestPut.status).toBe(201)
    expect(await assets.hasManifest(team, manifestDigest)).toBe(true)
    expect(await assets.hasObject(team, objectDigest)).toBe(true)

    const missingObject = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        files: [{ path: '/missing', sha256: 'f'.repeat(64), size: 1, mime: 'text/plain' }],
      })
    )
    expect(
      (
        await app.request(`${base}/teams/${team}/assets/manifests/${sha256(missingObject)}`, {
          method: 'PUT',
          headers: auth,
          body: missingObject,
        })
      ).status
    ).toBe(400)

    const wrongSize = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        files: [
          {
            path: '/index.html',
            sha256: objectDigest,
            size: object.byteLength + 1,
            mime: 'text/html',
          },
        ],
      })
    )
    expect(
      (
        await app.request(`${base}/teams/${team}/assets/manifests/${sha256(wrongSize)}`, {
          method: 'PUT',
          headers: auth,
          body: wrongSize,
        })
      ).status
    ).toBe(400)
    const badPath = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        files: [
          { path: '/a/../b', sha256: objectDigest, size: object.byteLength, mime: 'text/html' },
        ],
      })
    )
    expect(
      (
        await app.request(`${base}/teams/${team}/assets/manifests/${sha256(badPath)}`, {
          method: 'PUT',
          headers: auth,
          body: badPath,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await app.request(`${base}/teams/${team}/assets/objects/${'a'.repeat(64)}`, {
          method: 'PUT',
          headers: auth,
          body: object,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await app.request(`${base}/teams/${team}/assets/manifests/${'a'.repeat(64)}`, {
          method: 'PUT',
          headers: auth,
          body: manifestBytes,
        })
      ).status
    ).toBe(400)

    const bundle = new TextEncoder().encode('export default { fetch: () => new Response("a") }')
    const bundleDigest = sha256(bundle)
    expect(
      (
        await app.request(`${base}/bundles/${bundleDigest}`, {
          method: 'PUT',
          headers: auth,
          body: bundle,
        })
      ).status
    ).toBe(201)
    const version = await call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
      versionId: `v-${suffix}`,
      bundleSha256: bundleDigest,
      bundleBytes: bundle.byteLength,
      bindings: [
        {
          name: 'ASSETS',
          type: 'ASSETS',
          resourceId: manifestDigest,
          permissionRead: true,
          permissionWrite: false,
        },
      ],
      assetsRouting: 'ASSETS_FIRST',
      assetsRunWorkerFirst: ['/api/*'],
    })
    expect(version.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/v-${suffix}/activate`,
          {}
        )
      ).status
    ).toBe(200)
    expect((await call('POST', `${base}/publish`, { cause: 'ASSETS' })).status).toBe(201)
    const desired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    const envelope = (await desired.json()) as any
    const served = envelope.payload.tenants
      .flatMap((tenant: any) => tenant.workers)
      .find((candidate: any) => candidate.workerId === workerId)
    expect(served.bindings).toContainEqual(
      expect.objectContaining({
        type: 'assets',
        name: 'ASSETS',
        manifestDigest,
        assetsFirst: true,
        runWorkerFirst: ['/api/*'],
      })
    )
    const pullManifest = await app.request(
      `/api/internal/clusters/${cell}/vrt/assets/manifests/${manifestDigest}`,
      { headers: auth }
    )
    expect(pullManifest.status).toBe(200)
    expect(await pullManifest.text()).toContain('/index.html')
    const pullObject = await app.request(
      `/api/internal/clusters/${cell}/vrt/assets/objects/${objectDigest}`,
      { headers: auth }
    )
    expect(pullObject.status).toBe(200)
    expect(await pullObject.text()).toBe('<h1>hello</h1>')
    expect(
      (
        await app.request(`/api/internal/clusters/${cell}/vrt/assets/objects/${'c'.repeat(64)}`, {
          headers: auth,
        })
      ).status
    ).toBe(404)

    // A corrupt manifest digest stored inside a publication must skip the
    // row, not throw a 500 out of assertDigest inside the asset store.
    await pool.query(
      `update plane_publications
          set envelope = jsonb_set(envelope, '{payload,tenants,0,workers,0,bindings,0,manifestDigest}', '"garbage"')
        where cell_id=$1`,
      [cell]
    )
    expect(
      (
        await app.request(`/api/internal/clusters/${cell}/vrt/assets/objects/${objectDigest}`, {
          headers: auth,
        })
      ).status
    ).toBe(404)

    // A version referencing an un-uploaded manifest fails at create.
    expect(
      (
        await call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
          versionId: `missing-${suffix}`,
          bundleSha256: bundleDigest,
          bundleBytes: bundle.byteLength,
          bindings: [
            {
              name: 'ASSETS',
              type: 'ASSETS',
              resourceId: 'b'.repeat(64),
              permissionRead: true,
              permissionWrite: false,
            },
          ],
        })
      ).status
    ).toBe(400)
  })
})
