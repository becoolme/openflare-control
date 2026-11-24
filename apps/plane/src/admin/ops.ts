import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, databaseId, mapOp, parse, readJson, rows } from './context.js'

const expires = z.number().int().optional()

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
          kind: z.string().min(1).max(64),
          workerId: z.string().optional(),
          resourceKey: z.string().max(128).optional(),
          payload: z.record(z.unknown()),
          expiresAt: expires,
        })
        .strict(),
      await readJson(c)
    )
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
