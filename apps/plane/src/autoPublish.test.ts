/**
 * Lifecycle mutations (worker delete, hostname/vars/secrets changes, version
 * activation) must republish the cell's desired state automatically: the
 * console has no explicit "publish" step, so without it a deleted worker
 * would keep serving traffic on every cell indefinitely.
 */
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'e2e-admin-token'

class MemoryBundles {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, body: Uint8Array) {
    this.objects.set(key, body)
    return { key, sha256: 'x' }
  }
  async get() {
    return null
  }
}

maybe('auto-publish on lifecycle mutations', () => {
  const suffix = Math.random().toString(16).slice(2, 10)
  const cell = `ap-cell-${suffix}`
  const team = `ap-team-${suffix}`
  const worker = `ap-worker-${suffix}`
  const base = `/api/v1/cells/${cell}`
  const json = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  let pool: Pool
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles() as never,
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
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'AP' })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)
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

  async function revisionCount(): Promise<number> {
    const res = await call('GET', `${base}/publications`)
    return (res.body.data.publications as unknown[]).length
  }

  it('publishes when a hostname is added', async () => {
    const before = await revisionCount()
    const res = await call('POST', `${base}/teams/${team}/workers/${worker}/hostnames`, {
      hostname: `ap-${suffix}.workers.local`,
    })
    expect(res.status).toBe(201)
    expect(res.body.data.revision).toEqual(expect.any(Number))
    expect(await revisionCount()).toBe(before + 1)
  })

  it('publishes when a var is written', async () => {
    const before = await revisionCount()
    const res = await call('PUT', `${base}/teams/${team}/workers/${worker}/vars/GREETING`, {
      value: 'hello',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.revision).toEqual(expect.any(Number))
    expect(await revisionCount()).toBe(before + 1)
  })

  it('publishes when a secret is written and deleted', async () => {
    const before = await revisionCount()
    expect(
      (
        await call('PUT', `${base}/teams/${team}/workers/${worker}/secrets/TOKEN`, {
          value: 's3cret',
        })
      ).status
    ).toBe(200)
    expect(
      (await call('DELETE', `${base}/teams/${team}/workers/${worker}/secrets/TOKEN`)).status
    ).toBe(200)
    expect(await revisionCount()).toBe(before + 2)
  })

  it('publishes when a worker is suspended', async () => {
    const before = await revisionCount()
    const res = await call('PATCH', `${base}/teams/${team}/workers/${worker}`, {
      status: 'SUSPENDED',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.revision).toEqual(expect.any(Number))
    expect(await revisionCount()).toBe(before + 1)
    await call('PATCH', `${base}/teams/${team}/workers/${worker}`, { status: 'ACTIVE' })
  })

  it('publishes when a worker is deleted', async () => {
    const before = await revisionCount()
    const res = await call('DELETE', `${base}/teams/${team}/workers/${worker}`)
    expect(res.status).toBe(200)
    expect(res.body.data.revision).toEqual(expect.any(Number))
    const pubs = await call('GET', `${base}/publications`)
    expect(pubs.body.data.publications[0].cause).toBe('DELETE')
    expect(await revisionCount()).toBe(before + 1)
  })
})
