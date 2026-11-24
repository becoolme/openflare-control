import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, databaseId, mapOp, parse, readJson, rows } from './context.js'

const expires = z.number().int().min(0).max(4_102_444_800).optional()

// Kinds the generic endpoint accepts. Resource-scoped kinds (R2_*, KV_*,
// STORAGE_PURGE, D1) carry server-injected scope — tenantId/bucketId/
// namespaceId/databaseId and a resource_key pointing at the target — so
// they can only be minted by the dedicated per-resource endpoints, which
// verify the row exists on this cell first. Accepting them here with a
// caller-supplied resourceKey would let ops target another team's
// resources. Anything else would sit PENDING forever — fail at the
// boundary instead of enqueueing an op nothing can ack.
const CELL_OP_KINDS = ['WF_CREATE', 'WF_GET', 'WF_ACTION', 'WF_EVENT', 'WF_DELETE'] as const

// The cell trusts op payloads as control-plane-attested scope. The dedicated
// per-resource endpoints inject `tenantId`/`namespaceId`/`bucketId`/…
// server-side from verified rows; this generic endpoint must never let a
// caller write those fields itself (it would mint ops against resources on
// another tenant). Keep in sync with the scope keys each scoped endpoint
// injects — an omitted key is a bypass.
const SCOPE_PAYLOAD_KEYS = [
  'tenantId',
  'namespaceId',
  'physicalId',
  'storageId',
  'storage',
  'databaseId',
  'queueId',
  'bucketName',
  'bucketId',
  'indexId',
  'hyperdriveId',
  'accountId',
] as const

async function findOp(deps: AdminDeps, cell: string, id: string) {
  const [d1] = await rows(
    deps,
    `select id, seq, database_id, kind, status, result, error, expires_at, created_at
       from plane_d1_ops where cell_id=$1 and id=$2`,
    [cell, id]
  )
  if (d1) return { channel: 'd1', op: mapOp(d1) }
  const [cellOp] = await rows(
    deps,
    `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
       from plane_cell_ops where cell_id=$1 and id=$2`,
    [cell, id]
  )
  if (cellOp) return { channel: 'cell', op: mapOp(cellOp) }
  return null
}

export function registerOps(app: Hono, deps: AdminDeps): void {
  app.post('/api/v1/cells/:cellId/d1-ops', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          databaseId,
          kind: z.enum(['EXECUTE', 'MIGRATIONS_APPLY', 'DROP', 'PROMOTE']),
          payload: z.record(z.unknown()),
          expiresAt: expires,
        })
        .strict(),
      await readJson(c)
    )
    const [db] = await rows(
      deps,
      'select 1 from plane_d1_databases where database_id=$1 and cluster_id=$2',
      [body.databaseId, cell]
    )
    if (!db) throw new VrtControlError(404, 'D1 database not found')
    const id = randomUUID()
    await deps.pool.query(
      `insert into plane_d1_ops (id, cell_id, database_id, kind, payload, expires_at)
       values ($1,$2,$3,$4,$5,to_timestamp($6::double precision))`,
      [id, cell, body.databaseId, body.kind, body.payload, body.expiresAt ?? null]
    )
    const [op] = await rows(deps, 'select seq from plane_d1_ops where id=$1', [id])
    return c.json({ data: { id, seq: Number(op!.seq), channel: 'd1' } }, 201)
  })

  app.get('/api/v1/cells/:cellId/d1-ops', async (c) => {
    const status = c.req.query('status')
    const list = await rows(
      deps,
      `select id, seq, database_id, kind, status, result, error, expires_at, created_at
         from plane_d1_ops where cell_id=$1 and ($2::text is null or status=$2)
        order by seq limit 200`,
      [c.req.param('cellId'), status ?? null]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })

  app.post('/api/v1/cells/:cellId/cell-ops', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          kind: z.enum(CELL_OP_KINDS),
          workerId: z.string().min(1).max(128).optional(),
          resourceKey: z.string().max(128).optional(),
          payload: z.record(z.unknown()),
          expiresAt: expires,
        })
        .strict(),
      await readJson(c)
    )
    for (const key of SCOPE_PAYLOAD_KEYS) {
      if (key in body.payload) {
        throw new VrtControlError(400, `payload.${key} is server-managed — use the scoped endpoint`)
      }
    }
    if (body.workerId !== undefined) {
      const [worker] = await rows(
        deps,
        'select 1 from plane_workers where id=$1 and cluster_id=$2',
        [body.workerId, cell]
      )
      if (!worker) throw new VrtControlError(404, 'Worker not found')
    }
    const id = randomUUID()
    await deps.pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision))`,
      [
        id,
        cell,
        body.workerId ?? null,
        body.resourceKey ?? '',
        body.kind,
        body.payload,
        body.expiresAt ?? null,
      ]
    )
    const [op] = await rows(deps, 'select seq from plane_cell_ops where id=$1', [id])
    return c.json({ data: { id, seq: Number(op!.seq), channel: 'cell' } }, 201)
  })

  app.get('/api/v1/cells/:cellId/cell-ops', async (c) => {
    const status = c.req.query('status')
    const list = await rows(
      deps,
      `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
         from plane_cell_ops where cell_id=$1 and ($2::text is null or status=$2)
        order by seq limit 200`,
      [c.req.param('cellId'), status ?? null]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })

  // Unified op lookup, optionally waiting for a terminal state. Data-plane
  // operations (D1 query, R2 get/put, KV, workflows) are asynchronous by
  // design; callers poll one id instead of learning each channel's shape.
  app.get('/api/v1/cells/:cellId/ops/:id', async (c) => {
    const cell = c.req.param('cellId')
    const id = c.req.param('id')
    const waitMs = Math.min(Math.max(Number(c.req.query('waitMs') ?? '0') || 0, 0), 30_000)
    const deadline = Date.now() + waitMs
    for (;;) {
      const found = await findOp(deps, cell, id)
      if (!found) throw new VrtControlError(404, 'Op not found')
      if (found.op.status !== 'PENDING' || Date.now() >= deadline) {
        return c.json({ data: found })
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })
}
