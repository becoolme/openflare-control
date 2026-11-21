import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError, validVrtBucketName } from 'openflare-control'
import { type AdminDeps, generatedId, mapOp, parse, readJson, rows, teamId } from '../context.js'

const R2_KINDS = ['R2_LIST', 'R2_HEAD', 'R2_GET', 'R2_PUT', 'R2_DELETE'] as const

export function registerR2Service(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/r2/buckets', async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select bucket_name, bucket_id, team_id, cluster_id, created_at from plane_r2_buckets
        where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, bucket_name`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { buckets: list } })
  })

  app.post('/api/v1/cells/:cellId/r2/buckets', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          bucketName: z.string().min(3).max(63),
        })
        .strict(),
      await readJson(c)
    )
    if (!validVrtBucketName(body.bucketName)) {
      throw new VrtControlError(400, 'Invalid bucket name')
    }
    const physical = `vrt-${generatedId(`${cell}:${body.teamId}:r2:${body.bucketName}`)}`
    await deps.pool.query(
      `insert into plane_r2_buckets (bucket_name, bucket_id, team_id, cluster_id)
       values ($1,$2,$3,$4) on conflict (bucket_name) do nothing`,
      [body.bucketName, physical, body.teamId, cell]
    )
    const [bucket] = await rows(deps, 'select * from plane_r2_buckets where bucket_name=$1', [
      body.bucketName,
    ])
    return c.json({ data: { bucket } }, 201)
  })

  app.delete('/api/v1/cells/:cellId/r2/buckets/:bucketName', async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_r2_buckets where bucket_name=$1 and cluster_id=$2',
      [c.req.param('bucketName'), c.req.param('cellId')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'R2 bucket not found')
    return c.json({ data: { deleted: true } })
  })

  // R2 data operations ride the generic cell-op channel (the cell derives the
  // physical prefix from the control-plane-attested scope, never the payload).
  app.post('/api/v1/cells/:cellId/r2/buckets/:bucketName/ops', async (c) => {
    const cell = c.req.param('cellId')
    const name = c.req.param('bucketName')
    const [bucket] = await rows(
      deps,
      'select * from plane_r2_buckets where bucket_name=$1 and cluster_id=$2',
      [name, cell]
    )
    if (!bucket) throw new VrtControlError(404, 'R2 bucket not found')
    const body = parse(
      z
        .object({
          kind: z.enum(R2_KINDS),
          payload: z.record(z.unknown()).default({}),
          expiresAt: z.number().int().optional(),
        })
        .strict(),
      await readJson(c)
    )
    if ('tenantId' in body.payload || 'bucketId' in body.payload) {
      throw new VrtControlError(400, 'Scope fields are server-injected')
    }
    const opId = randomUUID()
    await deps.pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,null,$3,$4,$5,to_timestamp($6::double precision))`,
      [
        opId,
        cell,
        bucket.bucket_id,
        body.kind,
        { tenantId: bucket.team_id, bucketId: bucket.bucket_id, ...body.payload },
        body.expiresAt ?? null,
      ]
    )
    return c.json({ data: { opId, channel: 'cell' } }, 202)
  })

  app.get('/api/v1/cells/:cellId/r2/buckets/:bucketName/ops', async (c) => {
    const [bucket] = await rows(
      deps,
      'select bucket_id from plane_r2_buckets where bucket_name=$1 and cluster_id=$2',
      [c.req.param('bucketName'), c.req.param('cellId')]
    )
    if (!bucket) throw new VrtControlError(404, 'R2 bucket not found')
    const list = await rows(
      deps,
      `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
         from plane_cell_ops
        where cell_id=$1 and resource_key=$2 and kind like 'R2\\_%'
        order by seq desc limit 100`,
      [c.req.param('cellId'), bucket.bucket_id]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })
}
