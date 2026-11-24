/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/** Edge coverage for teams, Hyperdrive and the stats/unsupported surfaces. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'
import type { BundleStore } from 'openflare-control'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'stats-edge-token'
const TEST_SECRETS_CIPHER = createSecretsCipher('test-secrets-cipher-key-0001')

class NoBundles implements BundleStore {
  async put() {
    return { key: 'x', sha256: 'f'.repeat(64) }
  }
  async get() {
    return null
  }
}

maybe('management API stats edges', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `stats-${suffix}`
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
  const base = `/api/v1/cells/${cell}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new NoBundles(),
      adminToken: TOKEN,
      secrets: TEST_SECRETS_CIPHER,
      signing: resolvePlaneSigningKey('stats-signing-secret-1234'),
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

  it('covers teams, Hyperdrive and stats fail-closed paths', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'E2E' })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)

    // Teams: validation + missing + non-empty delete + happy path.
    expect((await call('POST', '/api/v1/teams', { teamId: 'BAD', name: 'x' })).status).toBe(400)
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: '' })).status).toBe(400)
    expect((await call('GET', '/api/v1/teams/nope')).status).toBe(404)
    expect((await call('PATCH', '/api/v1/teams/nope', { plan: 'Pro' })).status).toBe(404)
    expect((await call('DELETE', '/api/v1/teams/nope')).status).toBe(404)
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'Edge Team' })).status).toBe(
      201
    )
    expect((await call('GET', `/api/v1/teams/${team}`)).status).toBe(200)
    expect((await call('GET', '/api/v1/teams')).status).toBe(200)
    expect((await call('PATCH', `/api/v1/teams/${team}`, { name: 'Renamed' })).status).toBe(200)
    expect((await call('DELETE', `/api/v1/teams/${team}`)).status).toBe(409)

    // Hyperdrive validation + missing + identity.
    expect(
      (await call('POST', `${base}/hyperdrive`, { teamId: team, name: 'BAD', origin: 'x' })).status
    ).toBe(400)
    expect(
      (await call('POST', `${base}/hyperdrive`, { teamId: team, name: 'ok', origin: '' })).status
    ).toBe(400)
    expect((await call('GET', `${base}/hyperdrive/nope`)).status).toBe(404)
    expect((await call('DELETE', `${base}/hyperdrive/nope`)).status).toBe(404)
    const hd = await call('POST', `${base}/hyperdrive`, {
      teamId: team,
      name: 'edge',
      origin: 'postgres://db:5432/app',
    })
    const hdId = hd.body.data.hyperdrive.hyperdrive_id as string
    expect((await call('GET', `${base}/hyperdrive/${hdId}`)).status).toBe(200)
    expect((await call('GET', `${base}/hyperdrive/${hdId}/binding`)).status).toBe(200)
    expect((await call('DELETE', `${base}/hyperdrive/${hdId}`)).status).toBe(200)

    // Metrics: invalid window falls back; worker filter path.
    expect((await call('GET', `${base}/metrics?windowMs=bad`)).status).toBe(200)
    expect((await call('GET', `${base}/teams/${team}/workers/${worker}/metrics`)).status).toBe(200)

    // Stats 404 branches.
    expect((await call('GET', `${base}/d1/databases/nope/stats`)).status).toBe(404)
    expect((await call('GET', `${base}/r2/buckets/nope/stats`)).status).toBe(404)
    expect((await call('GET', `${base}/queues/nope/stats`)).status).toBe(404)
    expect(
      (await call('GET', `${base}/teams/${team}/workers/${worker}/workflows/nope/stats`)).status
    ).toBe(404)
    expect((await call('GET', `${base}/durable-objects/NopeDO/stats`)).status).toBe(404)

    // Instance listings are live; unknown names fail closed with 404.
    expect((await call('GET', `${base}/workflows/x/instances`)).status).toBe(404)
    expect((await call('GET', `${base}/durable-objects/X/instances`)).status).toBe(404)

    // Cleanup: delete worker, then the now-empty team and cell.
    expect((await call('DELETE', `${base}/teams/${team}/workers/${worker}`)).status).toBe(200)
    expect((await call('DELETE', `/api/v1/teams/${team}`)).status).toBe(200)
    expect((await call('DELETE', `/api/v1/cells/${cell}`)).status).toBe(200)
  })
})
