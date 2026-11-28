/**
 * The cell's op executors deserialize payloads with `deny_unknown_fields`
 * and expect base64-encoded values over the JSON channel. The plane owns
 * the translation at the API boundary — a payload forwarded verbatim with
 * a stray key or a plain-text value fails on the cell as "malformed
 * payload", which is exactly what happened to every browser-driven KV/R2
 * operation before this translation existed.
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

maybe('kv/r2 op payload translation', () => {
  const suffix = Math.random().toString(16).slice(2, 10)
  const cell = `opc-cell-${suffix}`
  const team = `opc-team-${suffix}`
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
      bundleStore: { put: async () => ({ key: 'x', sha256: 'x' }), get: async () => null } as never,
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
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'OPC' })).status).toBe(201)
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

  async function lastPayload(kind: string): Promise<Record<string, unknown>> {
    const r = await pool.query(
      'select payload from plane_cell_ops where kind=$1 order by seq desc limit 1',
      [kind]
    )
    return r.rows[0].payload as Record<string, unknown>
  }

  it('KV_PUT translates text value to valueBase64 and drops stray fields', async () => {
    const ns = await call('POST', `${base}/kv/namespaces`, { teamId: team, title: `kv-${suffix}` })
    expect(ns.status).toBe(201)
    const nsId = ns.body.data.namespace.namespace_id
    const res = await call('POST', `${base}/kv/namespaces/${nsId}/ops`, {
      kind: 'KV_PUT',
      payload: { key: 'k', value: 'hello', strayField: 'must-not-cross-the-wire' },
    })
    expect(res.status).toBe(202)
    const payload = await lastPayload('KV_PUT')
    expect(payload.key).toBe('k')
    expect(payload.valueBase64).toBe(Buffer.from('hello', 'utf8').toString('base64'))
    expect(payload.value).toBeUndefined()
    expect(payload.strayField).toBeUndefined()
    expect(payload.tenantId).toBe(team)
  })

  it('KV_PUT rejects a missing value', async () => {
    const ns = await call('POST', `${base}/kv/namespaces`, { teamId: team, title: `kv2-${suffix}` })
    const nsId = ns.body.data.namespace.namespace_id
    const res = await call('POST', `${base}/kv/namespaces/${nsId}/ops`, {
      kind: 'KV_PUT',
      payload: { key: 'k' },
    })
    expect(res.status).toBe(400)
  })

  it('R2_PUT translates text body and camelCases contentType', async () => {
    const bucket = await call('POST', `${base}/r2/buckets`, {
      teamId: team,
      bucketName: `bkt-${suffix}`,
    })
    expect(bucket.status).toBe(201)
    const res = await call('POST', `${base}/r2/buckets/bkt-${suffix}/ops`, {
      kind: 'R2_PUT',
      payload: { key: 'a/b.txt', body: 'object-text', contentType: 'text/plain', junk: 1 },
    })
    expect(res.status).toBe(202)
    const payload = await lastPayload('R2_PUT')
    expect(payload.bodyBase64).toBe(Buffer.from('object-text', 'utf8').toString('base64'))
    expect(payload.contentType).toBe('text/plain')
    expect(payload.body).toBeUndefined()
    expect(payload.junk).toBeUndefined()
    expect(payload.bucketId).toEqual(expect.any(String))
  })

  it('R2_DELETE accepts a singular key and emits the keys array the cell expects', async () => {
    const res = await call('POST', `${base}/r2/buckets/bkt-${suffix}/ops`, {
      kind: 'R2_DELETE',
      payload: { key: 'a/b.txt' },
    })
    expect(res.status).toBe(202)
    const payload = await lastPayload('R2_DELETE')
    expect(payload.keys).toEqual(['a/b.txt'])
    expect(payload.key).toBeUndefined()
  })
})
