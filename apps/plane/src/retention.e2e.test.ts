/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions in this e2e test */
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
const TOKEN = 'retention-token'
const TEST_SECRETS_CIPHER = createSecretsCipher('test-secrets-cipher-key-0001')

class NoBundles implements BundleStore {
  async put() {
    return { key: 'x', sha256: 'f'.repeat(64) }
  }
  async get() {
    return null
  }
}

maybe('retention e2e', () => {
  let pool: Pool
  let app: ReturnType<typeof createApp>
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `ret-${suffix}`
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
  const json = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new NoBundles(),
      adminToken: TOKEN,
      secrets: TEST_SECRETS_CIPHER,
      signing: resolvePlaneSigningKey('retention-signing-secret-0123456789abcdef'),
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

  it('prunes old logs, terminal ops and keeps pending ops', async () => {
    expect((await call('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    // Logs (old + fresh).
    for (const seq of [1, 2]) {
      await call('POST', `/api/internal/clusters/${cell}/vrt/logs`, {
        podId: 'p',
        bootId: 'b',
        records: [
          { seq, workerId: `${team}:w`, tsMs: Date.now(), kind: 'request', message: `m${seq}` },
        ],
      })
    }
    // D1 ops: one terminal/old, one pending/old, one fresh. Ops can only
    // target a database that exists on this cell.
    const db = await call('POST', `/api/v1/cells/${cell}/d1/databases`, {
      teamId: team,
      name: `ret-db-${suffix}`.slice(0, 63),
    })
    const databaseId = db.body.data.database.database_id as string
    for (const kind of ['EXECUTE', 'DROP', 'EXECUTE']) {
      await call('POST', `/api/v1/cells/${cell}/d1-ops`, {
        databaseId,
        kind,
        payload: { sql: 'select 1' },
      })
    }
    const ops = (await call('GET', `/api/v1/cells/${cell}/d1-ops`)).body.data.ops as {
      seq: number
    }[]
    // Mark the first DONE; leave the second PENDING; third fresh.
    await call('POST', `/api/internal/clusters/${cell}/vrt/d1-ops/ack`, {
      acks: [{ seq: ops[0]!.seq, status: 'DONE' }],
    })
    // One old metrics report (the retention target) and one fresh.
    await call('POST', `/api/internal/clusters/${cell}/vrt/metrics`, {
      schemaVersion: 1,
      cellId: cell,
      sampledAtMs: Date.now(),
      windowMs: 30000,
      pods: [],
    })
    await pool.query(
      `update plane_cell_metrics set created_at = now() - interval '40 days' where cell_id=$1`,
      [cell]
    )
    // One expired PENDING D1 op and one expired PENDING cell op: they can
    // never be dispatched, so the sweep reclaims them (one-day grace).
    await call('POST', `/api/v1/cells/${cell}/d1-ops`, {
      databaseId,
      kind: 'EXECUTE',
      payload: { sql: 'select 2' },
    })
    const expiredD1 = (await call('GET', `/api/v1/cells/${cell}/d1-ops`)).body.data.ops.findLast(
      (op: { status: string }) => op.status === 'PENDING'
    )
    await pool.query(
      `update plane_d1_ops set expires_at = now() - interval '2 days' where seq=$1`,
      [expiredD1.seq]
    )
    await pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, status, expires_at)
       values ('expired-cell-op',$1,'','','WF_GET','{}','PENDING', now() - interval '2 days')`,
      [cell]
    )
    // Backdate all logs and the first two ops.
    await pool.query(
      `update plane_logs set created_at = now() - interval '40 days' where cell_id=$1`,
      [cell]
    )
    await pool.query(
      `update plane_d1_ops set created_at = now() - interval '40 days'
        where cell_id=$1 and seq = any($2::bigint[])`,
      [cell, [ops[0]!.seq, ops[1]!.seq]]
    )

    const pruned = await call('POST', '/api/v1/maintenance/prune', {
      logRetentionDays: 7,
      opsRetentionDays: 30,
      keepPerCell: 20,
    })
    expect(pruned.status).toBe(200)
    expect(pruned.body.data.logsDeleted).toBe(2)
    expect(pruned.body.data.d1OpsDeleted).toBe(1) // terminal + old only
    expect(pruned.body.data.expiredD1OpsDeleted).toBe(1)
    expect(pruned.body.data.expiredCellOpsDeleted).toBe(1)
    expect(pruned.body.data.metricsDeleted).toBe(1)

    const logCount = await pool.query(
      'select count(*)::int as n from plane_logs where cell_id=$1',
      [cell]
    )
    expect(logCount.rows[0].n).toBe(0)
    const remaining = await pool.query(
      'select count(*)::int as n from plane_d1_ops where cell_id=$1',
      [cell]
    )
    expect(remaining.rows[0].n).toBe(2) // old pending + fresh
    const metrics = await pool.query(
      'select count(*)::int as n from plane_cell_metrics where cell_id=$1',
      [cell]
    )
    expect(metrics.rows[0].n).toBe(0)
    const pending = await pool.query(
      `select count(*)::int as n from plane_d1_ops where cell_id=$1 and status='PENDING'`,
      [cell]
    )
    expect(pending.rows[0].n).toBe(2)

    expect((await call('DELETE', `/api/v1/cells/${cell}`)).status).toBe(200)
  })
})
