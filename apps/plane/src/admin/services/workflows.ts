import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, generatedId, mapOp, parse, readJson, rows, workerId } from '../context.js'

const WF_KINDS = ['WF_CREATE', 'WF_GET', 'WF_ACTION', 'WF_EVENT', 'WF_DELETE'] as const

export function registerWorkflowService(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/teams/:teamId/workers/:name/workflows'

  app.get(base, async (c) => {
    const list = await rows(
      deps,
      `select workflow_id, worker_id, team_id, cluster_id, name, class_name, created_at
         from plane_workflows where worker_id=$1 order by name`,
      [workerId(c.req.param('teamId'), c.req.param('name'))]
    )
    return c.json({ data: { workflows: list } })
  })

  app.post(base, async (c) => {
    const cell = c.req.param('cellId')
    const team = c.req.param('teamId')
    const name = c.req.param('name')
    const id = workerId(team, name)
    const [worker] = await rows(
      deps,
      'select id from plane_workers where id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    const body = parse(
      z
        .object({
          name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/),
          className: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/),
        })
        .strict(),
      await readJson(c)
    )
    const workflowId = generatedId(`${cell}:${id}:workflow:${body.name}`)
    await deps.pool.query(
      `insert into plane_workflows (workflow_id, worker_id, team_id, cluster_id, name, class_name)
       values ($1,$2,$3,$4,$5,$6) on conflict (worker_id, name) do nothing`,
      [workflowId, id, team, cell, body.name, body.className]
    )
    const [workflow] = await rows(
      deps,
      'select * from plane_workflows where worker_id=$1 and name=$2',
      [id, body.name]
    )
    return c.json({ data: { workflow } }, 201)
  })

  app.delete(`${base}/:workflowName`, async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_workflows where worker_id=$1 and name=$2',
      [workerId(c.req.param('teamId'), c.req.param('name')), c.req.param('workflowName')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Workflow not found')
    return c.json({ data: { deleted: true } })
  })

  app.post(`${base}/:workflowName/ops`, async (c) => {
    const cell = c.req.param('cellId')
    const id = workerId(c.req.param('teamId'), c.req.param('name'))
    const workflowName = c.req.param('workflowName')
    const [workflow] = await rows(
      deps,
      'select 1 from plane_workflows where worker_id=$1 and name=$2',
      [id, workflowName]
    )
    if (!workflow) throw new VrtControlError(404, 'Workflow not found')
    const body = parse(
      z
        .object({
          kind: z.enum(WF_KINDS),
          instanceId: z.string().min(1).max(256).optional(),
          params: z.unknown().optional(),
          action: z.string().min(1).max(64).optional(),
          eventType: z.string().min(1).max(128).optional(),
          payload: z.unknown().optional(),
          expiresAt: z.number().int().optional(),
        })
        .strict(),
      await readJson(c)
    )
    const payload: Record<string, unknown> = { workflow: workflowName }
    if (body.instanceId !== undefined) payload.instanceId = body.instanceId
    if (body.params !== undefined) payload.params = body.params
    if (body.action !== undefined) payload.action = body.action
    if (body.eventType !== undefined) payload.eventType = body.eventType
    if (body.payload !== undefined) payload.payload = body.payload
    const opId = randomUUID()
    await deps.pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision))`,
      [opId, cell, id, workflowName, body.kind, payload, body.expiresAt ?? null]
    )
    return c.json({ data: { opId, channel: 'cell' } }, 202)
  })

  app.get(`${base}/:workflowName/ops`, async (c) => {
    const list = await rows(
      deps,
      `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
         from plane_cell_ops
        where cell_id=$1 and worker_id=$2 and resource_key=$3 and kind like 'WF\\_%'
        order by seq desc limit 100`,
      [
        c.req.param('cellId'),
        workerId(c.req.param('teamId'), c.req.param('name')),
        c.req.param('workflowName'),
      ]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })
}
