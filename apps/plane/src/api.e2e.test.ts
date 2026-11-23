/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
/**
 * End-to-end management API: create a cell, worker, bundle, version, vars,
 * secrets, hostnames; publish; verify the cell channels (desired/ack, ops,
 * logs); read everything back through the API; then delete.
 *
 * Requires DATABASE_URL (CI provides Postgres); skipped otherwise.
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
const TOKEN = 'e2e-admin-token'
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

maybe('management API e2e', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `e2e-${suffix}`
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
  const worker = 'hello'
  const versionId = `v-${suffix}`
  const hostname = `hello-${suffix}.example.test`
  const databaseId = 'a'.repeat(26)
  const auth = { authorization: `Bearer ${TOKEN}` }
  const json = { ...auth, 'content-type': 'application/json' }
  const base = `/api/v1/cells/${cell}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles(),
      adminToken: TOKEN,
      secrets: TEST_SECRETS_CIPHER,
      signing: resolvePlaneSigningKey('e2e-signing-secret-1234'),
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

  it('runs the full resource lifecycle over HTTP', async () => {
    // cell + worker
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect(
      (
        await call('POST', `${base}/workers`, {
          teamId: team,
          name: worker,
          entrypoint: 'src/index.ts',
        })
      ).status
    ).toBe(201)

    // bundle upload is content-addressed and digest-checked
    const bundle = new TextEncoder().encode(
      `export default { fetch: () => new Response('${suffix}') }`
    )
    const digest = sha256(bundle)
    const put = await app.request(`${base}/bundles/${digest}`, {
      method: 'PUT',
      headers: auth,
      body: bundle,
    })
    expect(put.status).toBe(201)
    const badDigest = 'f'.repeat(64)
    expect(
      (
        await app.request(`${base}/bundles/${badDigest}`, {
          method: 'PUT',
          headers: auth,
          body: bundle,
        })
      ).status
    ).toBe(400)

    // vars / secrets / hostname
    expect(
      (
        await call('PUT', `${base}/teams/${team}/workers/${worker}/vars/GREETING`, {
          value: 'hi',
        })
      ).status
    ).toBe(200)
    expect(
      (
        await call('PUT', `${base}/teams/${team}/workers/${worker}/secrets/API_KEY`, {
          value: 'super-secret',
        })
      ).status
    ).toBe(200)
    expect(
      (await call('POST', `${base}/teams/${team}/workers/${worker}/hostnames`, { hostname })).status
    ).toBe(201)

    // version + activate
    const created = await call('POST', `${base}/teams/${team}/workers/${worker}/versions`, {
      versionId,
      bundleSha256: digest,
      bundleBytes: bundle.byteLength,
      compatibilityDate: '2025-01-01',
      vars: { GREETING: 'hi' },
      crons: [],
    })
    expect(created.status).toBe(201)
    expect(
      (
        await call(
          'POST',
          `${base}/teams/${team}/workers/${worker}/versions/${versionId}/activate`,
          {}
        )
      ).status
    ).toBe(200)

    const detail = await call('GET', `${base}/teams/${team}/workers/${worker}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.worker.activeVersionId).toBe(versionId)
    expect(detail.body.data.secretKeys).toEqual(['API_KEY'])
    const patched = await call('PATCH', `${base}/teams/${team}/workers/${worker}`, {
      entrypoint: 'src/other.ts',
      compatibilityDate: '2025-02-02',
    })
    expect(patched.status).toBe(200)
    expect(patched.body.data.worker.entrypoint).toBe('src/other.ts')

    // publish + cell desired
    const published = await call('POST', `${base}/publish`, { cause: 'E2E' })
    expect(published.status).toBe(201)
    const revision = published.body.data.revision as number
    const desired = await app.request(`/api/internal/clusters/${cell}/vrt/desired`, {
      headers: auth,
    })
    expect(desired.status).toBe(200)
    const envelope = (await desired.json()) as {
      payload: { tenants: { tenantId: string; workers: { workerId: string }[] }[] }
      payloadDigest: string
      envelopeDigest?: string
    }
    expect(envelope.payload.tenants[0]!.tenantId).toBe(team)
    expect(envelope.payload.tenants[0]!.workers[0]!.workerId).toBe(`${team}:${worker}`)
    const render = await app.request(`/api/internal/clusters/${cell}/vrt/render-inputs`, {
      headers: auth,
    })
    const inputs = (await render.json()) as {
      tenants: Record<string, { vars: Record<string, string>; secrets: Record<string, string> }>
    }
    expect(inputs.tenants[team]!.vars.GREETING).toBe('hi')
    expect(inputs.tenants[team]!.secrets.API_KEY).toBe('super-secret')
    const adminInputs = await call('GET', `${base}/render-inputs`)
    expect(adminInputs.status).toBe(200)
    expect(adminInputs.body.data.tenants[team].secrets.API_KEY).toBe('super-secret')

    // ACK from the cell; the management read sees APPLIED. The digests are
    // server-recorded publication fields (exactly what the cell echoes back).
    const detailPub = await call('GET', `${base}/publications/${revision}`)
    const publication = detailPub.body.data.publication as {
      payloadDigest: string
      envelopeDigest: string
    }
    const ack = await call(
      'POST',
      `/api/internal/clusters/${cell}/vrt/desired/ack`,
      {
        revision,
        payloadDigest: publication.payloadDigest,
        envelopeDigest: publication.envelopeDigest,
        fenceRevision: revision,
        status: 'APPLIED',
        capabilities: { cron: true, assets: true },
        podsApplied: true,
      },
      json
    )
    expect(ack.status).toBe(200)
    expect(ack.body.data.ackStatus).toBe('APPLIED')
    const publications = await call('GET', `${base}/publications?limit=5`)
    expect(publications.status).toBe(200)
    expect(publications.body.data.publications[0].revision).toBe(revision)

    // d1 + cell ops: enqueue over management, pull/ack over the cell channel
    const d1 = await call('POST', `${base}/d1-ops`, {
      databaseId,
      kind: 'EXECUTE',
      payload: { sql: 'create table if not exists t(v int)' },
    })
    expect(d1.status).toBe(201)
    const pulled = await app.request(`/api/internal/clusters/${cell}/vrt/d1-ops`, {
      headers: auth,
    })
    const ops = (await pulled.json()) as { data: { ops: { seq: number; databaseId: string }[] } }
    expect(ops.data.ops[0]!.databaseId).toBe(databaseId)
    const ackD1 = await call(
      'POST',
      `/api/internal/clusters/${cell}/vrt/d1-ops/ack`,
      { acks: [{ seq: ops.data.ops[0]!.seq, status: 'DONE', result: { ok: true } }] },
      json
    )
    expect(ackD1.body.data.acked).toBe(1)
    const done = await call('GET', `${base}/d1-ops?status=DONE`)
    expect(done.body.data.ops).toHaveLength(1)

    const cellOp = await call('POST', `${base}/cell-ops`, {
      kind: 'WF_GET',
      workerId: `${team}:${worker}`,
      payload: { workflow: 'wf', instanceId: 'i-1' },
    })
    expect(cellOp.status).toBe(201)
    const cellPulled = await app.request(`/api/internal/clusters/${cell}/vrt/cell-ops`, {
      headers: auth,
    })
    const cellOps = (await cellPulled.json()) as {
      data: { ops: { seq: number; kind: string; workerId: string }[] }
    }
    expect(cellOps.data.ops[0]!.kind).toBe('WF_GET')
    expect(
      (
        await call(
          'POST',
          `/api/internal/clusters/${cell}/vrt/cell-ops/ack`,
          { acks: [{ seq: cellOps.data.ops[0]!.seq, status: 'DONE' }] },
          json
        )
      ).body.data.acked
    ).toBe(1)

    // log ingest + query
    const logs = await call(
      'POST',
      `/api/internal/clusters/${cell}/vrt/logs`,
      {
        podId: 'pod-1',
        bootId: 'boot-1',
        records: [
          {
            seq: 1,
            workerId: `${team}:${worker}`,
            tsMs: Date.now(),
            level: 'info',
            kind: 'request',
            message: 'hello',
          },
        ],
      },
      json
    )
    expect(logs.body.data.accepted).toBe(1)
    const listed = await call(
      'GET',
      `${base}/logs?workerId=${encodeURIComponent(`${team}:${worker}`)}`
    )
    expect(listed.body.data.logs[0].message).toBe('hello')

    // update/delete resources
    expect(
      (
        await call('PUT', `${base}/teams/${team}/workers/${worker}/vars/GREETING`, {
          value: 'bye',
        })
      ).status
    ).toBe(200)
    expect(
      (await call('DELETE', `${base}/teams/${team}/workers/${worker}/vars/GREETING`)).status
    ).toBe(200)
    expect(
      (await call('DELETE', `${base}/teams/${team}/workers/${worker}/hostnames/${hostname}`)).status
    ).toBe(200)
    expect((await call('DELETE', `${base}/teams/${team}/workers/${worker}`)).status).toBe(200)
    expect((await call('DELETE', `/api/v1/cells/${cell}`)).status).toBe(200)
  })

  it('rejects unauthenticated management calls', async () => {
    expect((await app.request('/api/v1/cells')).status).toBe(401)
  })
})
