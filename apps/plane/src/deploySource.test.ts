/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/**
 * deploy-source endpoint: raw module sources in, canonical bundle built and
 * stored server-side, same create/activate/publish pipeline as /deploy.
 * Requires DATABASE_URL (CI provides Postgres); skipped otherwise.
 */
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { bundleKeyFor, verifyRuntimeBundle, type BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'e2e-admin-token'
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

class MemoryBundles implements BundleStore {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, body: Uint8Array) {
    // The store is keyed by object key; lookups slice off the path suffix.
    this.objects.set(key.slice(key.lastIndexOf('/') + 1), body)
    return { key, sha256: sha256(body) }
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

maybe('deploy-source endpoint', () => {
  const suffix = Math.random().toString(16).slice(2, 10)
  const cell = `ds-cell-${suffix}`
  const team = `ds-team-${suffix}`
  const worker = `ds-worker-${suffix}`
  const base = `/api/v1/cells/${cell}`
  const bundles = new MemoryBundles()
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const json = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: bundles,
      adminToken: TOKEN,
      secrets: createSecretsCipher('test-secrets-cipher-key-0001'),
      signing: resolvePlaneSigningKey('e2e-signing-secret-0123456789abcdef'),
    })
    await pool.query(
      'insert into plane_cells (cell_id, cluster_id) values ($1,$1) on conflict (cell_id) do nothing',
      [cell]
    )
    await pool.query(
      `insert into plane_cell_tokens (cell_id, token_hash) values ($1, 'x') on conflict do nothing`,
      [cell]
    )
  })
  afterAll(async () => {
    await pool.end()
  })

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: json,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const source = {
    mainModule: 'main.js',
    modules: [
      {
        name: 'main.js',
        type: 'esModule',
        text: 'export default { fetch(req, env) { return new Response(`hi ${env.GREETING}`) } }\n',
      },
    ],
    compatibilityDate: '2024-09-25',
    vars: { greetingValue: 'world' },
    bindings: [
      {
        name: 'GREETING',
        type: 'VAR',
        resourceId: 'greetingValue',
        permissionRead: true,
        permissionWrite: true,
      },
    ],
  }

  it('rejects deploy-source for a missing worker', async () => {
    await call('POST', '/api/v1/cells', { cellId: cell })
    await call('POST', '/api/v1/teams', { teamId: team, name: 'DS' })
    const r = await call('POST', `${base}/teams/${team}/workers/nope/deploy-source`, source)
    expect(r.status).toBe(404)
  })

  it('builds, stores and deploys a bundle from raw sources', async () => {
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)
    const r = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy-source`, source)
    expect(r.status).toBe(201)
    const data = r.body.data
    expect(data.activated).toBe(true)
    expect(typeof data.revision).toBe('number')
    expect(data.bundleDigest).toMatch(/^[0-9a-f]{64}$/)

    // the stored document must verify against the returned digest
    const stored = bundles.objects.get(bundleKeyFor(data.bundleDigest).split('/').pop()!)
    expect(stored).toBeTruthy()
    expect(verifyRuntimeBundle(data.bundleDigest, stored!)).toBe(true)

    // the version is readable and active
    const versions = await call('GET', `${base}/teams/${team}/workers/${worker}/versions`)
    expect(versions.status).toBe(200)
    expect(
      versions.body.data.versions.some((v: any) => v.versionId === data.version.versionId)
    ).toBe(true)
  })

  it('rejects empty module arrays and empty source text', async () => {
    const empty = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy-source`, {
      ...source,
      modules: [],
    })
    expect(empty.status).toBe(400)
    const blank = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy-source`, {
      ...source,
      modules: [{ name: 'main.js', type: 'esModule', text: '' }],
    })
    expect(blank.status).toBe(400)
  })

  it('rejects unknown fields (strict input)', async () => {
    const r = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy-source`, {
      ...source,
      hack: true,
    })
    expect(r.status).toBe(400)
  })
})
