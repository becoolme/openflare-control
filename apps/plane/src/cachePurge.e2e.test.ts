/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import type { BundleStore } from 'openflare-control'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { createSecretsCipher } from './secretsCipher.js'
import { resolvePlaneSigningKey } from './signing.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'cachepurge-token-0123456789abcdef'

// Control-plane side of CACHE_PURGE: the endpoint mints a wire-valid op for
// the cell's fan-out executor, gated on the cell's cachePurge capability bit.
// Cell-side validation/fan-out is covered by openflare's cachepurge.rs tests.
maybe('cache purge', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `cp-${suffix}`
  const team = `team-${suffix}`
  const base = `/api/v1/cells/${cell}`
  const json = {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: null as unknown as BundleStore,
      adminToken: TOKEN,
      signing: resolvePlaneSigningKey('cachepurge-signing-secret-0123456789abcdef'),
      secrets: createSecretsCipher('cachepurge-secrets-key'),
    })
    await pool.query(
      'insert into plane_cells (cell_id, cluster_id) values ($1,$1) on conflict (cell_id) do nothing',
      [cell]
    )
    await pool.query(
      `insert into plane_cell_tokens (cell_id, token_hash) values ($1,$2)
         on conflict (cell_id) do update set token_hash=excluded.token_hash`,
      [cell, createHash('sha256').update(TOKEN).digest('hex')]
    )
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

  const purge = (body: unknown) => call('POST', `${base}/teams/${team}/cache/purge`, body)

  it('mints wire-valid CACHE_PURGE ops for exactly one mode each', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'E2E' })).status).toBe(201)

    // Capability gate fails closed before any op exists.
    expect((await purge({ all: true })).status).toBe(409)
    await createPlaneStore(pool).recordCellCapabilities(cell, {
      cron: true,
      assets: true,
      cachePurge: true,
    })

    // Exactly-one-mode enforcement at the boundary.
    for (const bad of [
      {},
      { all: true, tags: ['a'] },
      { all: false },
      { workerName: 'w', pathPrefix: '/x' },
      { tags: [] },
      { tags: ['a', ''] },
      { pathPrefix: 'no-leading-slash' },
      { workerName: 'BadCase' },
      { all: true, unexpected: 1 },
      // Scope keys are server-injected — a caller-supplied tenantId is
      // not even a known field on this endpoint.
      { all: true, tenantId: 'other-team' },
    ]) {
      expect((await purge(bad)).status).toBe(400)
    }
    // Unknown teams cannot mint purges.
    expect(
      (await call('POST', `${base}/teams/no-such-team/cache/purge`, { all: true })).status
    ).toBe(404)

    // The generic cell-ops endpoint must never mint CACHE_PURGE — its
    // server-injected scope (tenantId) is exactly what the generic
    // endpoint forbids callers to write, so a direct attempt is a 400,
    // not a cross-tenant purge.
    expect(
      (
        await call('POST', `${base}/cell-ops`, {
          kind: 'CACHE_PURGE',
          payload: { tenantId: team, all: true },
        })
      ).status
    ).toBe(400)

    // All four modes mint ops with the exact host wire payload.
    const cases = [
      { body: { workerName: 'web' }, want: { workerId: `${team}:web` }, key: `${team}:web` },
      { body: { tags: ['static', 'v3'] }, want: { tags: ['static', 'v3'] }, key: team },
      { body: { pathPrefix: '/assets/' }, want: { pathPrefix: '/assets/' }, key: team },
      { body: { all: true }, want: { all: true }, key: team },
    ]
    for (const { body, want, key } of cases) {
      const res = await purge(body)
      expect(res.status).toBe(202)
      expect(res.body.data.status).toBe('PURGE_PENDING')
      const listed = await call('GET', `${base}/cell-ops?status=PENDING`)
      const op = (listed.body.data.ops as any[]).find((o) => o.id === res.body.data.opId)
      expect(op).toBeTruthy()
      expect(op.kind).toBe('CACHE_PURGE')
      expect(op.resourceKey).toBe(key)
      const [row] = (await pool.query('select payload from plane_cell_ops where id=$1', [op.id]))
        .rows
      expect(row.payload).toEqual({ tenantId: team, ...want })
      // Ack the op so the next case starts from a clean queue.
      const ack = await call('POST', `/api/internal/clusters/${cell}/vrt/cell-ops/ack`, {
        acks: [{ seq: op.seq, status: 'DONE', result: { purged: 3, pods: 2 } }],
      })
      expect(ack.body.data.acked).toBe(1)
    }
    expect(
      ((await call('GET', `${base}/cell-ops?status=PENDING`)).body.data.ops as any[]).length
    ).toBe(0)
  })
})
