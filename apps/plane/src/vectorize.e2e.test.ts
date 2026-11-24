/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { bundleKeyFor, type BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { createSecretsCipher } from './secretsCipher.js'
import { resolvePlaneSigningKey } from './signing.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'vectorize-token-0123456789abcdef'
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

maybe('vectorize', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `vx-${suffix}`
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
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      signing: resolvePlaneSigningKey('vectorize-signing-secret-0123456789abcdef'),
      secrets: createSecretsCipher('vectorize-secrets-key'),
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

  it('creates an index, binds it, and publishes vectorize', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)
    const index = await call('POST', `${base}/vectorize/indexes`, {
      teamId: team,
      name: 'docs-index',
      dimensions: 768,
      metric: 'cosine',
    })
    expect(index.status).toBe(201)
    const indexId = index.body.data.index.index_id
    expect(indexId).toMatch(/^[0-9a-z]{26}$/)
    const binding = await call('GET', `${base}/vectorize/indexes/${indexId}/binding`)
    expect(binding.body.data.binding).toMatchObject({
      type: 'VECTORIZE',
      indexName: 'docs-index',
      dimensions: 768,
      metric: 'cosine',
    })
    expect(
      (
        await call('POST', `${base}/vectorize/indexes`, {
          teamId: team,
          name: 'bad',
          dimensions: 1537,
          metric: 'cosine',
        })
      ).status
    ).toBe(400)

    await createPlaneStore(pool).recordCellCapabilities(cell, {
      cron: true,
      assets: true,
      vectorize: true,
      storagePurge: true,
      vectorizePurge: true,
    })

    const purgeIndex = await call('POST', `${base}/vectorize/indexes`, {
      teamId: team,
      name: 'purge-me',
      dimensions: 8,
      metric: 'cosine',
    })
    expect(purgeIndex.status).toBe(201)
    const purgeId = purgeIndex.body.data.index.index_id as string
    const started = await call('DELETE', `${base}/vectorize/indexes/${purgeId}`)
    expect(started.status).toBe(202)
    expect(started.body.data.status).toBe('PURGE_PENDING')
    const opId = started.body.data.opId as string
    const repeated = await call('DELETE', `${base}/vectorize/indexes/${purgeId}`)
    expect(repeated.status).toBe(202)
    expect(repeated.body.data.opId).toBe(opId)
    const findOp = async () => {
      const listed = await call('GET', `${base}/cell-ops?status=PENDING`)
      return (listed.body.data.ops as { id: string; seq: number }[]).find((o) => o.id === opId)
    }
    const op = await findOp()
    expect(op).toBeTruthy()
    const firstAck = await call('POST', `/api/internal/clusters/${cell}/vrt/cell-ops/ack`, {
      acks: [{ seq: op!.seq, status: 'DONE', result: { complete: false, deletedKeys: 1 } }],
    })
    expect(firstAck.body.data.acked).toBe(1)
    const pending = (await call('GET', `${base}/cell-ops?status=PENDING`)).body.data.ops as {
      id: string
      seq: number
      kind: string
      resourceKey: string
    }[]
    const next = pending.find(
      (candidate) =>
        candidate.kind === 'STORAGE_PURGE' &&
        candidate.resourceKey === purgeId &&
        candidate.seq !== op!.seq
    )
    expect(next).toBeTruthy()
    const finalAck = await call('POST', `/api/internal/clusters/${cell}/vrt/cell-ops/ack`, {
      acks: [{ seq: next!.seq, status: 'DONE', result: { complete: true, deletedKeys: 1 } }],
    })
    expect(finalAck.body.data.acked).toBe(1)
    expect((await call('GET', `${base}/vectorize/indexes/${purgeId}/binding`)).status).toBe(404)

    const bundle = new TextEncoder().encode('export default { fetch: () => new Response("vx") }')
    const digest = sha256(bundle)
    const put = await app.request(`${base}/bundles/${digest}`, {
      method: 'PUT',
      headers: auth,
      body: bundle,
    })
    expect(put.status).toBe(201)
    const version = await call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
      versionId: `v-${suffix}`,
      bundleSha256: digest,
      bundleBytes: bundle.byteLength,
      bindings: [
        {
          name: 'VECTORS',
          type: 'VECTORIZE',
          resourceId: indexId,
          indexName: 'docs-index',
          dimensions: 768,
          metric: 'cosine',
          permissionRead: true,
          permissionWrite: true,
        },
      ],
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
    expect((await call('POST', `${base}/publish`, { cause: 'VECTORIZE' })).status).toBe(201)
    const desired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    const envelope = (await desired.json()) as any
    const served = envelope.payload.tenants
      .flatMap((tenant: any) => tenant.workers)
      .find((candidate: any) => candidate.workerId === workerId)
    expect(served.bindings).toContainEqual(
      expect.objectContaining({
        type: 'vectorize',
        name: 'VECTORS',
        indexId,
        indexName: 'docs-index',
        dimensions: 768,
        metric: 'cosine',
      })
    )
    expect(
      (
        await call('POST', `${base}/vectorize/indexes`, {
          teamId: team,
          name: 'docs-index',
          dimensions: 512,
          metric: 'cosine',
        })
      ).status
    ).toBe(409)
    expect((await call('DELETE', `${base}/vectorize/indexes/${indexId}`)).status).toBe(409)
    expect(
      (
        await call('POST', `${base}/vectorize/indexes`, {
          teamId: team,
          name: 'bad-metric',
          dimensions: 8,
          metric: 'bad',
        })
      ).status
    ).toBe(400)
    expect((await call('GET', `${base}/vectorize/indexes/missing/binding`)).status).toBe(404)

    // The index is scoped to its owning team.
    const otherTeam = `other-${suffix}`
    expect(
      (await call('POST', `${base}/workers`, { teamId: otherTeam, name: worker })).status
    ).toBe(201)
    expect(
      (
        await call('POST', `${base}/teams/${otherTeam}/workers/${worker}/versions`, {
          versionId: `other-${suffix}`,
          bundleSha256: digest,
          bundleBytes: bundle.byteLength,
          bindings: [
            {
              name: 'VECTORS',
              type: 'VECTORIZE',
              resourceId: indexId,
              indexName: 'docs-index',
              dimensions: 768,
              metric: 'cosine',
              permissionRead: true,
              permissionWrite: true,
            },
          ],
        })
      ).status
    ).toBe(400)
  })
})
