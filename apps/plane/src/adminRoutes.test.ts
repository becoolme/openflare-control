/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in route tests */
/**
 * Branch coverage for the management API: validation failures, 404/409 paths,
 * malformed ops/log ACKs, missing signing, and cleanup. The happy-path
 * lifecycle lives in api.e2e.test.ts; this file pins the fail-closed edges.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { bundleKeyFor, type BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { MemoryAssetStore } from './assetStore.js'
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
  let assets: MemoryAssetStore
  let assetsApp: ReturnType<typeof createApp>
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
    assets = new MemoryAssetStore()
    assetsApp = createApp({ ...deps, assetStore: assets })
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

  it('creates the fixture cell and covers worker/version edges', async () => {
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
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
    // Ops can only target a database that exists on this cell — the
    // dedicated endpoints enforce the same scope check.
    const db = await call(app, 'POST', `${base}/d1/databases`, {
      teamId: team,
      name: `edge-db-${suffix}`.slice(0, 63),
    })
    expect(db.status).toBe(201)
    const databaseId = db.body.data.database.database_id as string
    expect(
      (
        await call(app, 'POST', `${base}/d1-ops`, {
          databaseId: 'a'.repeat(26),
          kind: 'DROP',
          payload: {},
        })
      ).status
    ).toBe(404)
    const op = await call(app, 'POST', `${base}/d1-ops`, {
      databaseId,
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

  it('deletes the cell and its cluster-scoped resources', async () => {
    // Seed one of every resource family the cell delete must take with it —
    // re-created cell ids must not resurrect the old catalog.
    expect(
      (
        await call(app, 'POST', `${base}/d1/databases`, {
          teamId: team,
          name: `cascade-db-${suffix}`.slice(0, 63),
        })
      ).status
    ).toBe(201)
    expect(
      (
        await call(app, 'POST', `${base}/kv/namespaces`, {
          teamId: team,
          title: `cascade-kv-${suffix}`.slice(0, 63),
        })
      ).status
    ).toBe(201)
    expect(
      (
        await call(app, 'POST', `${base}/queues`, {
          teamId: team,
          name: `cascade-q-${suffix}`.slice(0, 63),
        })
      ).status
    ).toBe(201)
    expect(
      (
        await call(app, 'POST', `${base}/r2/buckets`, {
          teamId: team,
          bucketName: `cb-${suffix}`.slice(0, 63),
        })
      ).status
    ).toBe(201)
    expect(
      (
        await call(app, 'POST', `${base}/hyperdrive`, {
          teamId: team,
          name: `ch-${suffix}`.slice(0, 63),
          origin: 'postgres://db.internal:5432/x',
        })
      ).status
    ).toBe(201)
    await pool.query(
      `insert into plane_cell_metrics (cell_id, sampled_at, window_ms, payload)
       values ($1, now(), 1, '{}'::jsonb)`,
      [cell]
    )
    await pool.query(
      `insert into plane_cell_resources (cell_id, sampled_at, payload)
       values ($1, now(), '{}'::jsonb)
       on conflict (cell_id) do update set sampled_at=excluded.sampled_at`,
      [cell]
    )

    expect((await call(app, 'DELETE', `${base}/teams/${team}/workers/missing`)).status).toBe(404)
    expect((await call(app, 'DELETE', `/api/v1/cells/${cell}`)).status).toBe(200)
    expect((await call(app, 'DELETE', `/api/v1/cells/${cell}`)).status).toBe(404)

    const orphans = await pool.query(
      `select
         (select count(*)::int from plane_d1_databases where cluster_id=$1) +
         (select count(*)::int from plane_kv_namespaces where cluster_id=$1) +
         (select count(*)::int from plane_queues where cluster_id=$1) +
         (select count(*)::int from plane_r2_buckets where cluster_id=$1) +
         (select count(*)::int from plane_hyperdrives where cluster_id=$1) +
         (select count(*)::int from plane_cell_metrics where cell_id=$1) +
         (select count(*)::int from plane_cell_resources where cell_id=$1) as n`,
      [cell]
    )
    expect(orphans.rows[0]!.n).toBe(0)

    // Re-creating the same cell id starts with an empty catalog.
    expect((await call(app, 'POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    const list = await call(app, 'GET', `${base}/d1/databases`)
    expect(list.body.data.databases).toHaveLength(0)
    // The cell detail endpoint aggregates counts plus the latest publication.
    const detail = await call(app, 'GET', `/api/v1/cells/${cell}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.latestPublication).toBeNull()
    const cells = await call(app, 'GET', '/api/v1/cells')
    expect(cells.body.data.cells.some((row: { cellId: string }) => row.cellId === cell)).toBe(true)
  })

  it('pins worker-scoped routes to the :cellId in the path', async () => {
    // The worker id (`team:name`) is globally unique, so every route must
    // also pin `cluster_id` — otherwise any other cell's path resolves the
    // same worker and mutations land through the wrong cell.
    const other = `other-${suffix}`
    await provisionCellToken(other)
    const otherBase = `/api/v1/cells/${other}/teams/${team}/workers/${worker}`

    expect((await call(app, 'GET', `${otherBase}/vars`)).status).toBe(404)
    expect((await call(app, 'PUT', `${otherBase}/vars/K`, { value: 'x' })).status).toBe(404)
    expect((await call(app, 'DELETE', `${otherBase}/vars/K`)).status).toBe(404)
    expect((await call(app, 'GET', `${otherBase}/secrets`)).status).toBe(404)
    expect((await call(app, 'PUT', `${otherBase}/secrets/K`, { value: 'x' })).status).toBe(404)
    expect((await call(app, 'DELETE', `${otherBase}/secrets/K`)).status).toBe(404)
    expect((await call(app, 'DELETE', `${otherBase}/hostnames/${hostname}`)).status).toBe(404)

    // The same worker stays reachable through its own cell.
    expect((await call(app, 'GET', `${base}/teams/${team}/workers/${worker}/vars`)).status).toBe(
      200
    )

    // Workflows get the same treatment (inserted directly — capability
    // gating is covered in cellReport.e2e).
    await pool.query(
      `insert into plane_workflows (workflow_id, worker_id, team_id, cluster_id, name, class_name)
       values ($1,$2,$3,$4,$5,$6)`,
      [`wf-${suffix}`, `${team}:${worker}`, team, cell, 'wf-scope', 'WfScope']
    )
    const wf = `teams/${team}/workers/${worker}/workflows`
    const otherWf = `/api/v1/cells/${other}/${wf}`
    expect((await call(app, 'GET', otherWf)).body.data.workflows).toHaveLength(0)
    expect((await call(app, 'DELETE', `${otherWf}/wf-scope`)).status).toBe(404)
    expect((await call(app, 'POST', `${otherWf}/wf-scope/ops`, { kind: 'WF_GET' })).status).toBe(
      404
    )
    expect((await call(app, 'GET', `${otherWf}/wf-scope/stats`)).status).toBe(404)
    expect((await call(app, 'DELETE', `${base}/${wf}/wf-scope`)).status).toBe(200)
  })

  it('constrains generic cell-ops payloads at the boundary', async () => {
    // Unknown kinds would sit PENDING forever — reject at the boundary.
    expect(
      (await call(app, 'POST', `${base}/cell-ops`, { kind: 'NOPE_KIND', payload: {} })).status
    ).toBe(400)
    // Resource-scoped kinds are minted only by the dedicated per-resource
    // endpoints, which inject tenantId/bucketId/… and resource_key from
    // verified rows — the generic endpoint must not accept them at all.
    for (const kind of ['R2_GET', 'KV_GET', 'STORAGE_PURGE']) {
      expect(
        (
          await call(app, 'POST', `${base}/cell-ops`, {
            kind,
            resourceKey: 'foreign-resource',
            payload: {},
          })
        ).status
      ).toBe(400)
    }
    // Scope fields are server-managed: the dedicated per-resource endpoints
    // inject tenantId/namespaceId/bucketId from verified rows, so a caller
    // must not write them itself.
    for (const key of ['tenantId', 'storageId', 'namespaceId', 'bucketName', 'bucketId']) {
      expect(
        (
          await call(app, 'POST', `${base}/cell-ops`, {
            kind: 'WF_CREATE',
            payload: { [key]: 'x' },
          })
        ).status
      ).toBe(400)
    }
    // workerId, when present, must exist on this cell.
    expect(
      (
        await call(app, 'POST', `${base}/cell-ops`, {
          kind: 'WF_GET',
          workerId: 'other-team:ghost',
          payload: {},
        })
      ).status
    ).toBe(404)
    const other = `other-${suffix}`
    expect(
      (
        await call(app, 'POST', `/api/v1/cells/${other}/cell-ops`, {
          kind: 'WF_GET',
          workerId: `${team}:${worker}`,
          payload: {},
        })
      ).status
    ).toBe(404)
    // A scope-free workflow op still enqueues.
    expect(
      (
        await call(app, 'POST', `${base}/cell-ops`, {
          kind: 'WF_GET',
          workerId: `${team}:${worker}`,
          resourceKey: 'wf-scope',
          payload: { workflow: 'wf-scope', instanceId: 'i-2' },
        })
      ).status
    ).toBe(201)
  })

  it('covers d1 promote ops, writer CAS, and failover reports', async () => {
    // The preceding cascade test deletes and recreates this cell — make the
    // channel credential valid again regardless of suite ordering.
    await provisionCellToken(cell)
    const db = await call(app, 'POST', `${base}/d1/databases`, {
      teamId: team,
      name: `ddb-${suffix}`,
    })
    expect(db.status).toBe(201)
    const databaseId = db.body.data.database.database_id as string

    // Promote input validation happens before the op is queued.
    expect(
      (await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, { expectedEpoch: 2 }))
        .status
    ).toBe(400)
    expect(
      (
        await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, {
          writerAddr: 'ftp://x',
        })
      ).status
    ).toBe(400)
    const promote = await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, {
      expectedEpoch: 2,
      expectedLsn: 9,
      writerAddr: 'https://w1.example.com',
      reason: 'test',
    })
    expect(promote.status).toBe(202)
    // A second promote is refused while one is still pending.
    expect((await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, {})).status).toBe(
      409
    )

    const pendingSeq = async () => {
      const pulled = (await (
        await app.request(`/api/internal/clusters/${cell}/vrt/d1-ops`, { headers: auth })
      ).json()) as { data: { ops: { seq: number; kind: string }[] } }
      return pulled.data.ops.find((o) => o.kind === 'PROMOTE')!.seq
    }
    const ackSeq = (seq: number, result: unknown, target = app) =>
      call(target, 'POST', `/api/internal/clusters/${cell}/vrt/d1-ops/ack`, {
        acks: [{ seq, status: 'DONE', result }],
      })

    // A DONE ack without a usable writer result acks the op but republishes
    // nothing — the cell retried the promote and it did not take.
    const bad = await ackSeq(await pendingSeq(), { success: false })
    expect(bad.body.data).toMatchObject({ acked: 1, published: 0 })

    // On a signing-less plane the writer CAS still applies; only the
    // republish is skipped.
    await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, {})
    const unsigned = await ackSeq(
      await pendingSeq(),
      { epoch: 5, lsn: 11, writerAddr: 'https://w2.example.com' },
      noSigningApp
    )
    expect(unsigned.body.data).toMatchObject({ acked: 1, published: 0 })
    let writer = (
      await pool.query(
        'select writer_epoch, writer_addr, writer_lsn from plane_d1_databases where database_id=$1',
        [databaseId]
      )
    ).rows[0] as { writer_epoch: number; writer_addr: string; writer_lsn: number }
    expect(writer).toMatchObject({ writer_epoch: 5, writer_addr: 'https://w2.example.com' })

    // A stale epoch report acks the op but loses the monotonic CAS.
    await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, {})
    const stale = await ackSeq(await pendingSeq(), { epoch: 4 })
    expect(stale.body.data).toMatchObject({ acked: 1, published: 0 })

    // A well-formed DONE publishes a new desired revision.
    await call(app, 'POST', `${base}/d1/databases/${databaseId}/promote`, {})
    const good = await ackSeq(await pendingSeq(), {
      epoch: 8,
      writerAddr: 'https://w8.example.com',
    })
    expect(good.body.data).toMatchObject({ acked: 1, published: 1 })
    writer = (
      await pool.query(
        'select writer_epoch, writer_addr, writer_lsn from plane_d1_databases where database_id=$1',
        [databaseId]
      )
    ).rows[0] as { writer_epoch: number; writer_addr: string; writer_lsn: number }
    expect(writer).toMatchObject({ writer_epoch: 8, writer_addr: 'https://w8.example.com' })

    // The cell's automatic-failover report validates its inputs.
    const writerUrl = `/api/internal/clusters/${cell}/vrt/d1-writer`
    for (const body of [
      {},
      { databaseId: 'short', epoch: 9 },
      { databaseId, epoch: 0 },
      { databaseId, epoch: 9, lsn: -1 },
      { databaseId, epoch: 9, writerAddr: 'no-scheme' },
      { databaseId, epoch: 9, writerAddr: 'https://trailing.example.com/' },
    ]) {
      expect((await call(app, 'POST', writerUrl, body, json)).status).toBe(400)
    }
    const auto = await call(
      app,
      'POST',
      writerUrl,
      { databaseId, epoch: 9, lsn: 3, writerAddr: 'https://w9.example.com' },
      json
    )
    expect(auto.status).toBe(200)
    expect(auto.body.data).toMatchObject({ applied: true, published: true })
    // Replaying the same epoch loses the CAS and republishes nothing.
    const replay = await call(app, 'POST', writerUrl, { databaseId, epoch: 8 }, json)
    expect(replay.body.data).toMatchObject({ applied: false, published: false })
  })

  it('deletes the team and its team-scoped resources', async () => {
    const orphanTeam = `del-${suffix}`
    expect(
      (await call(app, 'POST', '/api/v1/teams', { teamId: orphanTeam, name: 'doomed' })).status
    ).toBe(201)
    // Asset rows + live fs payloads: deleting the team must remove both.
    const manifestBytes = new TextEncoder().encode('{"m":1}')
    const objectBytes = new TextEncoder().encode('payload')
    const manifestDigest = sha256(manifestBytes)
    const objectDigest = sha256(objectBytes)
    await assets.putManifest(orphanTeam, manifestDigest, manifestBytes)
    await assets.putObject(orphanTeam, objectDigest, objectBytes)
    await pool.query(
      `insert into plane_asset_manifests (team_id, digest, total_bytes) values ($1,$2,$3)`,
      [orphanTeam, manifestDigest, manifestBytes.byteLength]
    )
    await pool.query(`insert into plane_asset_objects (team_id, digest, bytes) values ($1,$2,$3)`, [
      orphanTeam,
      objectDigest,
      objectBytes.byteLength,
    ])
    const doomedDb = await call(app, 'POST', `${base}/d1/databases`, {
      teamId: orphanTeam,
      name: `doomed-db-${suffix}`.slice(0, 63),
    })
    expect(doomedDb.status).toBe(201)
    const doomedNs = await call(app, 'POST', `${base}/kv/namespaces`, {
      teamId: orphanTeam,
      title: `doomed-kv-${suffix}`.slice(0, 63),
    })
    expect(doomedNs.status).toBe(201)
    // Ops keyed by deterministic resource ids must die with the resource —
    // a recreated same-named database/namespace would otherwise inherit
    // the dead team's queued and resulted ops.
    const doomedDbId = doomedDb.body.data.database.database_id as string
    // KV ops key on physical_id (`vrtkv_…`), not namespace_id.
    const doomedPhysical = doomedNs.body.data.namespace.physical_id as string
    await pool.query(
      `insert into plane_d1_ops (id, cell_id, database_id, kind, payload)
       values ($1,$2,$3,'EXECUTE','{}'::jsonb)`,
      [randomUUID(), cell, doomedDbId]
    )
    await pool.query(
      `insert into plane_cell_ops (id, cell_id, resource_key, kind, payload)
       values ($1,$2,$3,'KV_GET','{}'::jsonb)`,
      [randomUUID(), cell, doomedPhysical]
    )
    // Worker-scoped ops key on worker_id=`team:name` — the deterministic
    // composite resurrects under a same-named worker after team re-create.
    await pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload)
       values ($1,$2,$3,'wf-name','WF_GET','{}'::jsonb)`,
      [randomUUID(), cell, `${orphanTeam}:ghost`]
    )

    expect((await call(assetsApp, 'DELETE', `/api/v1/teams/${orphanTeam}`)).status).toBe(200)
    expect(assets.manifests.size).toBe(0)
    expect(assets.objects.size).toBe(0)
    const orphans = await pool.query(
      `select
         (select count(*)::int from plane_d1_databases where team_id=$1) +
         (select count(*)::int from plane_kv_namespaces where team_id=$1) +
         (select count(*)::int from plane_queues where team_id=$1) +
         (select count(*)::int from plane_r2_buckets where team_id=$1) +
         (select count(*)::int from plane_hyperdrives where team_id=$1) +
         (select count(*)::int from plane_asset_manifests where team_id=$1) +
         (select count(*)::int from plane_asset_objects where team_id=$1) +
         (select count(*)::int from plane_d1_ops where database_id=$2) +
         (select count(*)::int from plane_cell_ops where resource_key=$3) +
         (select count(*)::int from plane_cell_ops where worker_id like $1 || ':%') as n`,
      [orphanTeam, doomedDbId, doomedPhysical]
    )
    expect(orphans.rows[0]!.n).toBe(0)
  })

  it('rejects team deletes that are unsafe or unknown', async () => {
    expect((await call(app, 'DELETE', `/api/v1/teams/ghost-${suffix}`)).status).toBe(404)
    // A team that still owns workers refuses to delete.
    const busy = `busy-${suffix}`
    expect((await call(app, 'POST', '/api/v1/teams', { teamId: busy, name: 'b' })).status).toBe(201)
    expect((await call(app, 'POST', `${base}/workers`, { teamId: busy, name: 'w2' })).status).toBe(
      201
    )
    expect((await call(app, 'DELETE', `/api/v1/teams/${busy}`)).status).toBe(409)
  })

  it('still deletes the team when asset fs cleanup fails', async () => {
    // Store deletes are best-effort — rows must go even if the fs throws.
    class FailingAssets extends MemoryAssetStore {
      override async deleteManifest(): Promise<void> {
        throw new Error('fs gone')
      }
      override async deleteObject(): Promise<void> {
        throw new Error('fs gone')
      }
    }
    const failApp = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      secrets: TEST_SECRETS_CIPHER,
      assetStore: new FailingAssets(),
    })
    const doomed = `fs-${suffix}`
    expect((await call(app, 'POST', '/api/v1/teams', { teamId: doomed, name: 'f' })).status).toBe(
      201
    )
    const digest = sha256('x')
    await pool.query(`insert into plane_asset_objects (team_id, digest, bytes) values ($1,$2,1)`, [
      doomed,
      digest,
    ])
    await pool.query(
      `insert into plane_asset_manifests (team_id, digest, total_bytes) values ($1,$2,1)`,
      [doomed, digest]
    )
    expect((await call(failApp, 'DELETE', `/api/v1/teams/${doomed}`)).status).toBe(200)
  })
})
