import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import {
  bundleKeyFor,
  canonicalControlPlaneSnapshotV2,
  type BundleStore,
  type SnapshotSigningContext,
  type VrtControlStore,
} from 'openflare-control'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { publishCell } from './publish.js'
import { resolvePlaneSigningKey } from './signing.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'routes-test-token'
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

class MemoryBundles implements BundleStore {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, body: Uint8Array) {
    const digest = sha256(body)
    this.objects.set(digest, body)
    return { key, sha256: digest }
  }
  async get(key: string) {
    const digest = key.slice(key.lastIndexOf('/') + 1)
    const body = this.objects.get(digest)
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

maybe('reference plane routes', () => {
  let pool: Pool
  let store: VrtControlStore
  let signing: SnapshotSigningContext
  let bundles: MemoryBundles
  let app: ReturnType<typeof createApp>
  const cluster = `route-${Date.now()}`
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
  const team = `team-${Date.now()}`

  const auth = { authorization: `Bearer ${TOKEN}` }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    store = createPlaneStore(pool)
    signing = resolvePlaneSigningKey('routes-test-secret-1234')
    bundles = new MemoryBundles()
    app = createApp({ store, pool, bundleStore: bundles })
    await provisionCellToken(cluster)
  })
  afterAll(async () => {
    await pool.end()
  })

  async function seedWorker(name: string, digest: string, vars: Record<string, string> = {}) {
    await pool.query(
      `insert into plane_workers (id, team_id, cluster_id, name)
       values ($1,$2,$3,$4) on conflict (team_id, cluster_id, name) do nothing`,
      [`${team}:${name}`, team, cluster, name]
    )
    const res = await pool.query(
      'select id from plane_workers where team_id=$1 and cluster_id=$2 and name=$3',
      [team, cluster, name]
    )
    const workerId = (res.rows[0] as { id: string }).id
    const { version } = await store.createVersionWithBindings({
      workerId,
      versionId: `ver-${name}-${Date.now()}`,
      bundleSha256: digest,
      bundleKey: bundleKeyFor(digest),
      bundleBytes: 8,
      mainModule: 'index.js',
      modules: [],
      compatibilityDate: '2024-01-01',
      compatibilityFlags: [],
      crons: [],
      quotas: { cpuMs: 10_000, memoryMb: 128, subrequests: 50, outboundConnections: 6 },
      varValues: vars,
      bindingsFingerprint: digest.slice(0, 32),
      runtimeConfigDigest: digest,
      bindings: [],
      createdById: 'routes-test',
    })
    await store.runCellTransaction(cluster, (tx) => tx.activateVersion(workerId, version.versionId))
    for (const [key, value] of Object.entries(vars)) {
      await pool.query(
        `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
         on conflict (worker_id, key) do update set value=excluded.value`,
        [workerId, key, value]
      )
    }
    return { workerId, versionId: version.versionId }
  }

  it('healthz is open; every cell endpoint requires the bearer token', async () => {
    expect((await app.request('/healthz')).status).toBe(200)
    for (const path of ['vrt/desired', 'vrt/render-inputs', 'vrt/d1-ops', 'vrt/cell-ops']) {
      const res = await app.request(`/api/internal/clusters/${cluster}/${path}`)
      expect(res.status).toBe(401)
    }
    expect(
      (
        await app.request(`/api/internal/clusters/${cluster}/vrt/desired`, {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status
    ).toBe(401)
  })

  it('serves desired, render-inputs and bundles after a publish', async () => {
    const body = Buffer.from('worker-bundle')
    const digest = sha256(body)
    await bundles.put(bundleKeyFor(digest), body)
    const { workerId, versionId } = await seedWorker('hello', digest, { GREETING: 'hi' })
    await publishCell(store, { cellId: cluster, signing, workerId, versionId })

    const desired = await app.request(`/api/internal/clusters/${cluster}/vrt/desired`, {
      headers: auth,
    })
    expect(desired.status).toBe(200)
    expect(desired.headers.get('cache-control')).toBe('no-store')
    const envelope = (await desired.json()) as {
      payload: { tenants: { tenantId: string; workers: { workerId: string }[] }[] }
      payloadDigest: string
    }
    expect(envelope.payload.tenants[0]!.tenantId).toBe(team)
    expect(envelope.payload.tenants[0]!.workers.map((w) => w.workerId)).toContain(workerId)

    const inputs = await app.request(`/api/internal/clusters/${cluster}/vrt/render-inputs`, {
      headers: auth,
    })
    expect(inputs.status).toBe(200)
    const render = (await inputs.json()) as {
      tenants: Record<string, { vars: Record<string, string> }>
    }
    expect(render.tenants[team]!.vars.GREETING).toBe('hi')

    const bundle = await app.request(`/api/internal/clusters/${cluster}/vrt/bundles/${digest}`, {
      headers: auth,
    })
    expect(bundle.status).toBe(200)
    expect(Buffer.from(await bundle.arrayBuffer()).toString()).toBe('worker-bundle')

    // An unreferenced digest is indistinguishable from absent.
    const missing = await app.request(
      `/api/internal/clusters/${cluster}/vrt/bundles/${'b'.repeat(64)}`,
      { headers: auth }
    )
    expect(missing.status).toBe(404)
  })

  it('never leaks secret values into desired; render-inputs is the only path', async () => {
    const body = Buffer.from('secret-bundle')
    const digest = sha256(body)
    await bundles.put(bundleKeyFor(digest), body)
    const { workerId, versionId } = await seedWorker(`vault-${Date.now()}`, digest)
    await pool.query(
      `insert into plane_secrets (worker_id, key, value) values ($1,'API_KEY','s3cr3t-value')
       on conflict (worker_id, key) do update set value=excluded.value`,
      [workerId]
    )
    await publishCell(store, { cellId: cluster, signing, workerId, versionId })

    const desired = await app.request(`/api/internal/clusters/${cluster}/vrt/desired`, {
      headers: auth,
    })
    const text = await desired.text()
    expect(text).not.toContain('s3cr3t-value')

    const inputs = await app.request(`/api/internal/clusters/${cluster}/vrt/render-inputs`, {
      headers: auth,
    })
    expect(await inputs.text()).toContain('s3cr3t-value')
  })

  it('does not serve a bundle to a cell that did not publish it', async () => {
    const body = Buffer.from('cell-private')
    const digest = sha256(body)
    await bundles.put(bundleKeyFor(digest), body)
    const { workerId, versionId } = await seedWorker(`iso-${Date.now()}`, digest)
    await publishCell(store, { cellId: cluster, signing, workerId, versionId })

    const other = await app.request(`/api/internal/clusters/other-cell/vrt/bundles/${digest}`, {
      headers: auth,
    })
    expect(other.status).toBe(404)
  })

  it('rejects an ack that echoes a different cell id', async () => {
    const desired = await app.request(`/api/internal/clusters/${cluster}/vrt/desired`, {
      headers: auth,
    })
    const envelope = (await desired.json()) as Record<string, unknown> & {
      revision: number
      payloadDigest: string
    }
    const res = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        revision: envelope.revision,
        payloadDigest: envelope.payloadDigest,
        envelopeDigest: sha256(canonicalControlPlaneSnapshotV2(envelope)),
        fenceRevision: envelope.revision,
        status: 'APPLIED',
        cellId: 'other-cell',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('acks a matching revision and rejects digest mismatches', async () => {
    const desired = await app.request(`/api/internal/clusters/${cluster}/vrt/desired`, {
      headers: auth,
    })
    const envelope = (await desired.json()) as Record<string, unknown> & {
      revision: number
      payloadDigest: string
    }
    const envelopeDigest = sha256(canonicalControlPlaneSnapshotV2(envelope))
    const base = {
      revision: envelope.revision,
      payloadDigest: envelope.payloadDigest,
      envelopeDigest,
      fenceRevision: envelope.revision,
      status: 'APPLIED',
    }

    const mismatch = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, envelopeDigest: 'c'.repeat(64) }),
    })
    expect(mismatch.status).toBe(409)

    const ok = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(base),
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { data: { ackStatus: string } }
    expect(body.data.ackStatus).toBe('APPLIED')

    const replay = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(base),
    })
    expect(replay.status).toBe(200)
  })

  it('answers malformed bodies with 400, never 500', async () => {
    const invalid = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(invalid.status).toBe(400)
    const schema = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 0 }),
    })
    expect(schema.status).toBe(400)
  })

  it('refuses payloads and bundles over the configured limits', async () => {
    const tiny = createApp({ store, pool, bundleStore: bundles, maxBundleBytes: 4 })
    const bytes = Buffer.from('too-large')
    const digest = sha256(bytes)
    await bundles.put(bundleKeyFor(digest), bytes)
    const { workerId, versionId } = await seedWorker(`big-${Date.now()}`, digest)
    await publishCell(store, { cellId: cluster, signing, workerId, versionId })
    const bundle = await tiny.request(`/api/internal/clusters/${cluster}/vrt/bundles/${digest}`, {
      headers: auth,
    })
    expect(bundle.status).toBe(413)

    const tooBig = await app.request(`/api/internal/clusters/${cluster}/vrt/desired/ack`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', 'content-length': '999999' },
      body: '{}',
    })
    expect(tooBig.status).toBe(413)
  })

  it('answers unimplemented channels with empty shapes, not false success', async () => {
    for (const path of ['vrt/d1-ops', 'vrt/cell-ops']) {
      const res = await app.request(`/api/internal/clusters/${cluster}/${path}`, { headers: auth })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ data: { ops: [] } })
    }
    const logs = await app.request(`/api/internal/clusters/${cluster}/vrt/logs`, {
      method: 'POST',
      headers: auth,
      body: '{}',
    })
    expect(await logs.json()).toEqual({ data: { accepted: 0, dropped: 0 } })
  })
})
