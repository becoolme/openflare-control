/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in route tests */
/**
 * Branch coverage for the management API: validation failures, 404/409 paths,
 * malformed ops/log ACKs, missing signing, and cleanup. The happy-path
 * lifecycle lives in api.e2e.test.ts; this file pins the fail-closed edges.
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
const TOKEN = 'admin-edge-token'
const TEST_SECRETS_CIPHER = createSecretsCipher('test-secrets-cipher-key-0001')
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

class MemoryBundles implements BundleStore {
  readonly objects = new Map<string, Uint8Array>()
  async put(_key: string, body: Uint8Array) {
    const digest = sha256(body)
    this.objects.set(digest, body)
    return { key: bundleKeyFor(digest), sha256: digest }
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

maybe('management API edges', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  let noSigningApp: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `edge-${suffix}`
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
  const hostname = `h-${suffix}.example.test`
  const auth = { authorization: `Bearer ${TOKEN}` }
  const json = { ...auth, 'content-type': 'application/json' }
  const base = `/api/v1/cells/${cell}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    const deps = {
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      secrets: TEST_SECRETS_CIPHER,
    }
    app = createApp({ ...deps, signing: resolvePlaneSigningKey('edge-signing-secret-1234') })
    noSigningApp = createApp(deps)
    await provisionCellToken(cell)
  })
  afterAll(async () => {
    await pool.end()
  })

  async function call(
    target: ReturnType<typeof createApp>,
    method: string,
    path: string,
    body?: unknown,
    headers = json
  ): Promise<{ status: number; body: any }> {
    const res = await target.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  it('rejects bad auth and malformed resource identifiers', async () => {
    expect((await app.request('/api/v1/cells')).status).toBe(401)
    expect(
      (
        await app.request('/api/v1/cells', {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status
    ).toBe(401)
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: 'INVALID' })).status).toBe(400)
    expect((await call(app, 'DELETE', '/api/v1/cells/nope')).status).toBe(404)
    expect((await call(app, 'GET', `/api/v1/cells/absent-${suffix}`)).status).toBe(404)
  })

  it('rejects resource creates for missing teams and malformed resource ids', async () => {
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    const ghost = `ghost-${suffix}`
    // Writes must not mint rows under a team that was never created.
    expect((await call(app, 'POST', `${base}/workers`, { teamId: ghost, name: 'w' })).status).toBe(
      404
    )
    expect(
      (await call(app, 'POST', `${base}/d1/databases`, { teamId: ghost, name: 'db' })).status
    ).toBe(404)
    expect(
      (await call(app, 'POST', `${base}/kv/namespaces`, { teamId: ghost, title: 'ns' })).status
    ).toBe(404)
    expect((await call(app, 'POST', `${base}/queues`, { teamId: ghost, name: 'q' })).status).toBe(
      404
    )
    // Path params carrying server-minted ids are shape-checked, not just bound.
    expect((await call(app, 'GET', `${base}/d1/databases/not-an-id`)).status).toBe(400)
    expect((await call(app, 'DELETE', `${base}/queues/not-an-id`)).status).toBe(400)
    expect((await call(app, 'GET', `${base}/hyperdrive/not-an-id`)).status).toBe(400)
    expect((await call(app, 'DELETE', `${base}/kv/namespaces/not-an-id`)).status).toBe(400)
    expect((await call(app, 'DELETE', `${base}/r2/buckets/Bad_Name`)).status).toBe(400)
  })

  it('creates the fixture cell and covers worker/version edges', async () => {
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call(app, 'POST', '/api/v1/teams', { teamId: team, name: 'E2E' })).status).toBe(
      201
    )
    expect(
      (await call(app, 'POST', `/api/v1/cells/${cell}/workers`, { teamId: 'BAD', name: worker }))
        .status
    ).toBe(400)
    expect(
      (await call(app, 'POST', `${base}/workers`, { teamId: team, name: worker })).status
    ).toBe(201)
    expect((await call(app, 'GET', `${base}/teams/${team}/workers/missing`)).status).toBe(404)
    expect(
      (await call(app, 'PATCH', `${base}/teams/${team}/workers/missing`, { status: 'ACTIVE' }))
        .status
    ).toBe(404)
    expect(
      (await call(app, 'GET', `${base}/teams/${team}/workers/${worker}/versions`)).status
    ).toBe(200)
    const bundle = new TextEncoder().encode('edge-v1')
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
    expect(
      (
        await call(app, 'POST', `${base}/teams/${team}/workers/${worker}/versions`, {
          versionId: 'missing-bundle',
          bundleSha256: 'a'.repeat(64),
          vars: {},
        })
      ).status
    ).toBe(409)
    expect(
      (
        await call(app, 'POST', `${base}/teams/${team}/workers/${worker}/versions`, {
          versionId: 'v1',
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          vars: {},
        })
      ).status
    ).toBe(201)

    // Real runtime artifacts: the key is sha256(canonical manifest), not
    // sha256(stored-document bytes). The route must accept that format.
    const runtimeDigest = 'a71da14134a9249da38199c2fc282347a451237a1702c9758214f026a809753f'
    const runtimeBytes = new Uint8Array(
      await readFile(
        new URL('../../../packages/control/test/fixtures/runtime-bundle-v1.json', import.meta.url)
      )
    )
    expect(
      (
        await app.request(`${base}/bundles/${runtimeDigest}`, {
          method: 'PUT',
          headers: auth,
          body: runtimeBytes,
        })
      ).status
    ).toBe(201)
    expect(
      (
        await call(app, 'POST', `${base}/teams/${team}/workers/${worker}/versions`, {
          versionId: 'runtime-v1',
          bundleSha256: runtimeDigest,
          bundleBytes: runtimeBytes.byteLength,
          vars: {},
        })
      ).status
    ).toBe(201)
    const tampered = new Uint8Array(runtimeBytes)
    const flip = tampered.length - 10
    tampered[flip] = (tampered[flip] ?? 0) ^ 1
    expect(
      (
        await app.request(`${base}/bundles/${runtimeDigest}`, {
          method: 'PUT',
          headers: auth,
          body: tampered,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await call(
          app,
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/missing/activate`,
          {}
        )
      ).status
    ).toBe(404)
    expect(
      (
        await call(app, 'PATCH', `${base}/teams/${team}/workers/${worker}`, {
          entrypoint: 'src/index.ts',
          compatibilityDate: '2025-03-03',
          status: 'ACTIVE',
        })
      ).status
    ).toBe(200)
  })

  it('covers vars/secrets/hostname validation and conflicts', async () => {
    expect(
      (
        await call(app, 'PUT', `${base}/teams/${team}/workers/${worker}/vars/bad key`, {
          value: 'x',
        })
      ).status
    ).toBe(400)
    expect(
      (await call(app, 'PUT', `${base}/teams/${team}/workers/${worker}/vars/K`, {})).status
    ).toBe(400)
    expect(
      (
        await call(app, 'PUT', `${base}/teams/${team}/workers/${worker}/secrets/bad key`, {
          value: 'x',
        })
      ).status
    ).toBe(400)
    expect(
      (await call(app, 'PUT', `${base}/teams/${team}/workers/${worker}/secrets/K`, {})).status
    ).toBe(400)
    expect(
      (
        await call(app, 'POST', `${base}/teams/${team}/workers/${worker}/hostnames`, {
          hostname: 'BAD',
        })
      ).status
    ).toBe(400)
    expect(
      (await call(app, 'POST', `${base}/teams/${team}/workers/missing/hostnames`, { hostname }))
        .status
    ).toBe(404)
    expect(
      (await call(app, 'POST', `${base}/teams/${team}/workers/${worker}/hostnames`, { hostname }))
        .status
    ).toBe(201)
    expect(
      (await call(app, 'POST', `${base}/teams/${team}/workers/${worker}/hostnames`, { hostname }))
        .status
    ).toBe(201)
    expect(
      (
        await call(
          app,
          'DELETE',
          `${base}/teams/${team}/workers/${worker}/hostnames/none.example.test`
        )
      ).status
    ).toBe(404)
  })

  it('covers bundle/publish/publication edges', async () => {
    expect((await call(app, 'GET', `${base}/bundles/${'a'.repeat(64)}`)).status).toBe(404)
    expect((await call(app, 'PUT', `${base}/bundles/nothex`, undefined)).status).toBe(400)
    const bytes = new TextEncoder().encode('edge-bundle')
    const digest = sha256(bytes)
    expect(
      (
        await app.request(`${base}/bundles/${digest}`, {
          method: 'PUT',
          headers: auth,
          body: bytes,
        })
      ).status
    ).toBe(201)
    const mismatch = await app.request(`${base}/bundles/${'a'.repeat(64)}`, {
      method: 'PUT',
      headers: auth,
      body: bytes,
    })
    expect(mismatch.status).toBe(400)
    expect((await call(app, 'GET', `${base}/publications/9999`)).status).toBe(404)
    expect((await call(app, 'GET', `${base}/publications?limit=0`)).status).toBe(200)
    expect((await call(noSigningApp, 'POST', `${base}/publish`, {})).status).toBe(501)
    expect((await call(app, 'POST', `${base}/publish`, undefined)).status).toBe(201)
    const published = await call(app, 'POST', `${base}/publish`, { cause: 'EDGE' })
    expect(published.status).toBe(201)
    expect((await call(app, 'GET', `${base}/publications?limit=1`)).status).toBe(200)
    expect((await call(app, 'GET', `${base}/render-inputs`)).status).toBe(200)
  })

  it('covers ops/logs validation and malformed ACKs', async () => {
    expect(
      (
        await call(app, 'POST', `${base}/d1-ops`, {
          databaseId: 'short',
          kind: 'EXECUTE',
          payload: {},
        })
      ).status
    ).toBe(400)
    expect(
      (
        await call(app, 'POST', `${base}/d1-ops`, {
          databaseId: 'a'.repeat(26),
          kind: 'NOPE',
          payload: {},
        })
      ).status
    ).toBe(400)
    const op = await call(app, 'POST', `${base}/d1-ops`, {
      databaseId: 'a'.repeat(26),
      kind: 'DROP',
      payload: {},
    })
    expect(op.status).toBe(201)
    const pulled = (await (
      await app.request(`/api/internal/clusters/${cell}/vrt/d1-ops`, { headers: auth })
    ).json()) as { data: { ops: { seq: number }[] } }
    const ack = await call(
      app,
      'POST',
      `/api/internal/clusters/${cell}/vrt/d1-ops/ack`,
      {
        acks: [
          { seq: 'bad', status: 'X' },
          { seq: pulled.data.ops[0]!.seq, status: 'FAILED' },
        ],
      },
      json
    )
    expect(ack.body.data).toMatchObject({ acked: 1, malformed: 1 })
    expect((await call(app, 'GET', `${base}/d1-ops?status=FAILED`)).status).toBe(200)

    expect(
      (
        await call(app, 'POST', `${base}/cell-ops`, {
          kind: 'WF_GET',
          workerId: `${team}:${worker}`,
          payload: {},
        })
      ).status
    ).toBe(201)
    const cellOps = (await (
      await app.request(`/api/internal/clusters/${cell}/vrt/cell-ops`, { headers: auth })
    ).json()) as { data: { ops: { seq: number }[] } }
    const cellAck = await call(
      app,
      'POST',
      `/api/internal/clusters/${cell}/vrt/cell-ops/ack`,
      {
        acks: [
          { seq: 'bad', status: 'NOPE' },
          { seq: cellOps.data.ops[0]!.seq, status: 'EXPIRED' },
        ],
      },
      json
    )
    expect(cellAck.body.data).toMatchObject({ acked: 1, malformed: 1 })

    const log = await call(
      app,
      'POST',
      `/api/internal/clusters/${cell}/vrt/logs`,
      {
        podId: 'p',
        bootId: 'b',
        records: [
          { seq: 'bad', workerId: 'w' },
          {
            seq: 1,
            workerId: `${team}:${worker}`,
            tsMs: Date.now(),
            level: 'warn',
            kind: 'k',
            message: 'm',
            truncated: true,
          },
        ],
      },
      json
    )
    expect(log.body.data.accepted).toBe(1)
    expect((await call(app, 'GET', `${base}/logs?limit=1`)).status).toBe(200)
    expect((await call(app, 'POST', '/api/v1/maintenance/prune', { keepPerCell: -1 })).status).toBe(
      400
    )
    expect((await call(app, 'POST', '/api/v1/maintenance/prune', { keepPerCell: 0 })).status).toBe(
      200
    )
  })

  it('issues cell-scoped tokens and keeps admin auth separate', async () => {
    const tokenCell = `token-${suffix}`
    const otherCell = `token-other-${suffix}`
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: tokenCell })).status).toBe(201)
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: otherCell })).status).toBe(201)

    const issued = await call(app, 'POST', `/api/v1/cells/${tokenCell}/token`)
    expect(issued.status).toBe(201)
    const token = issued.body.data.token as string
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const [stored] = (
      await pool.query('select token_hash from plane_cell_tokens where cell_id=$1', [tokenCell])
    ).rows as { token_hash: string }[]
    expect(stored!.token_hash).toBe(sha256(token))
    expect(stored!.token_hash).not.toBe(token)

    const cellAuth = { authorization: `Bearer ${token}` }
    // Each credential is valid only on its own surface.
    expect((await app.request('/api/v1/cells', { headers: cellAuth })).status).toBe(401)
    expect(
      (
        await app.request(`/api/internal/clusters/${tokenCell}/vrt/desired`, {
          headers: auth,
        })
      ).status
    ).toBe(401)
    expect(
      (
        await app.request(`/api/internal/clusters/${tokenCell}/vrt/desired`, {
          headers: cellAuth,
        })
      ).status
    ).toBe(404)
    // A cell token is scoped to its own cell id.
    expect(
      (
        await app.request(`/api/internal/clusters/${otherCell}/vrt/desired`, {
          headers: cellAuth,
        })
      ).status
    ).toBe(401)

    // Rotation invalidates the previous credential immediately.
    const rotated = await call(app, 'POST', `/api/v1/cells/${tokenCell}/token`)
    expect(rotated.status).toBe(201)
    const nextToken = rotated.body.data.token as string
    expect(nextToken).not.toBe(token)
    expect(
      (
        await app.request(`/api/internal/clusters/${tokenCell}/vrt/desired`, {
          headers: cellAuth,
        })
      ).status
    ).toBe(401)
    expect(
      (
        await app.request(`/api/internal/clusters/${tokenCell}/vrt/desired`, {
          headers: { authorization: `Bearer ${nextToken}` },
        })
      ).status
    ).toBe(404)
  })

  it('deletes the cell and reports missing deletes', async () => {
    expect((await call(app, 'DELETE', `${base}/teams/${team}/workers/missing`)).status).toBe(404)
    expect((await call(app, 'DELETE', `/api/v1/cells/${cell}`)).status).toBe(200)
    expect((await call(app, 'DELETE', `/api/v1/cells/${cell}`)).status).toBe(404)
  })
})
