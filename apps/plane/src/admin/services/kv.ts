import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import {
  type AdminDeps,
  generatedId,
  mapOp,
  opExpiresAt,
  parse,
  readJson,
  rows,
  teamId,
} from '../context.js'

const KV_KINDS = [
  'KV_GET',
  'KV_PUT',
  'KV_DELETE',
  'KV_LIST',
  'KV_BULK_PUT',
  'KV_BULK_DELETE',
] as const

export function registerKvService(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/kv/namespaces', async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select namespace_id, physical_id, team_id, cluster_id, title, created_at
         from plane_kv_namespaces
        where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, title`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { namespaces: list } })
  })

  app.post('/api/v1/cells/:cellId/kv/namespaces', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          title: z.string().min(1).max(63),
        })
        .strict(),
      await readJson(c)
    )
    const namespaceId = generatedId(`${cell}:${body.teamId}:kv:${body.title}`)
    const physicalId = `vrtkv_${namespaceId}`
    await deps.pool.query(
      `insert into plane_kv_namespaces (namespace_id, physical_id, team_id, cluster_id, title)
       values ($1,$2,$3,$4,$5) on conflict (namespace_id) do nothing`,
      [namespaceId, physicalId, body.teamId, cell, body.title]
    )
    const [namespace] = await rows(
      deps,
      'select * from plane_kv_namespaces where namespace_id=$1',
      [namespaceId]
    )
    return c.json({ data: { namespace } }, 201)
  })

  app.delete('/api/v1/cells/:cellId/kv/namespaces/:namespaceId', async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_kv_namespaces where namespace_id=$1 and cluster_id=$2',
      [c.req.param('namespaceId'), c.req.param('cellId')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'KV namespace not found')
    return c.json({ data: { deleted: true } })
  })

  app.post('/api/v1/cells/:cellId/kv/namespaces/:namespaceId/ops', async (c) => {
    const cell = c.req.param('cellId')
    const id = c.req.param('namespaceId')
    const [ns] = await rows(
      deps,
      'select * from plane_kv_namespaces where namespace_id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!ns) throw new VrtControlError(404, 'KV namespace not found')
    const body = parse(
      z
        .object({
          kind: z.enum(KV_KINDS),
          payload: z.record(z.unknown()).default({}),
          expiresAt: opExpiresAt,
        })
        .strict(),
      await readJson(c)
    )
    if ('tenantId' in body.payload || 'namespaceId' in body.payload) {
      throw new VrtControlError(400, 'Scope fields are server-injected')
    }
    const opId = randomUUID()
    await deps.pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,null,$3,$4,$5,to_timestamp($6::double precision))`,
      [
        opId,
        cell,
        ns.physical_id,
        body.kind,
        { tenantId: ns.team_id, namespaceId: ns.physical_id, ...body.payload },
        body.expiresAt ?? null,
      ]
    )
    return c.json({ data: { opId, channel: 'cell' } }, 202)
  })

  app.get('/api/v1/cells/:cellId/kv/namespaces/:namespaceId/ops', async (c) => {
    const [ns] = await rows(
      deps,
      'select physical_id from plane_kv_namespaces where namespace_id=$1 and cluster_id=$2',
      [c.req.param('namespaceId'), c.req.param('cellId')]
    )
    if (!ns) throw new VrtControlError(404, 'KV namespace not found')
    const list = await rows(
      deps,
      `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
         from plane_cell_ops
        where cell_id=$1 and resource_key=$2 and kind like 'KV\\_%'
        order by seq desc limit 100`,
      [c.req.param('cellId'), ns.physical_id]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })
}
