import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  MAX_WORKFLOWS_PER_WORKER,
  MAX_WORKFLOW_STEPS,
  VrtControlError,
  WORKFLOW_IDENT_RE,
  WORKFLOW_NAME_RE,
  missingCapabilities,
  requiredCapabilities,
} from 'openflare-control'
import {
  type AdminDeps,
  generatedId,
  mapOp,
  parse,
  readJson,
  rows,
  sha256,
  workerId,
} from '../context.js'

const WF_KINDS = ['WF_CREATE', 'WF_GET', 'WF_ACTION', 'WF_EVENT', 'WF_DELETE'] as const
const workflowNameSchema = z.string().regex(WORKFLOW_NAME_RE)
const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const RETENTION_UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
}

function retentionMs(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  let ms: number
  if (typeof value === 'number') ms = value
  else if (typeof value === 'string') {
    const m = /^(\d{1,9})\s*([a-z]+)$/i.exec(value.trim())
    const unit = m ? RETENTION_UNITS[m[2]!.toLowerCase()] : undefined
    if (!m || unit === undefined) throw new VrtControlError(400, `Invalid ${field}`)
    ms = Number(m[1]) * unit
  } else throw new VrtControlError(400, `Invalid ${field}`)
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_RETENTION_MS) {
    throw new VrtControlError(400, `Invalid ${field}`)
  }
  return ms
}

export function registerWorkflowService(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/teams/:teamId/workers/:name/workflows'

  app.get(base, async (c) => {
    const list = await rows(
      deps,
      `select workflow_id, worker_id, team_id, cluster_id, name, class_name, binding,
              unique_key, limits_steps, service_worker_id, success_retention_ms,
              error_retention_ms, concurrency_limit, created_at
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
          name: z.string().regex(WORKFLOW_NAME_RE),
          className: z.string().regex(WORKFLOW_IDENT_RE),
          binding: z.string().regex(WORKFLOW_IDENT_RE).optional(),
          limitsSteps: z.number().int().min(1).max(MAX_WORKFLOW_STEPS).nullable().optional(),
          scriptName: z
            .string()
            .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
            .optional(),
          defaultRetention: z
            .object({
              successRetention: z.union([z.number(), z.string()]).optional(),
              errorRetention: z.union([z.number(), z.string()]).optional(),
            })
            .strict()
            .optional(),
          concurrencyLimit: z.number().int().min(1).max(4_500).optional(),
        })
        .strict(),
      await readJson(c)
    )
    if (body.scriptName && body.defaultRetention) {
      throw new VrtControlError(400, 'defaultRetention cannot be combined with scriptName')
    }
    const successRetentionMs = retentionMs(
      body.defaultRetention?.successRetention,
      'defaultRetention.successRetention'
    )
    const errorRetentionMs = retentionMs(
      body.defaultRetention?.errorRetention,
      'defaultRetention.errorRetention'
    )
    const binding = body.binding ?? body.name
    if (!WORKFLOW_IDENT_RE.test(binding)) {
      throw new VrtControlError(400, 'Invalid workflow binding')
    }
    let serviceWorkerId: string | null = null
    if (body.scriptName && body.scriptName !== name) {
      const target = workerId(team, body.scriptName)
      const [targetWorker] = await rows(
        deps,
        `select id from plane_workers
          where id=$1 and team_id=$2 and cluster_id=$3
            and runtime='VRT' and status='ACTIVE' and active_version_id is not null`,
        [target, team, cell]
      )
      if (!targetWorker) throw new VrtControlError(404, 'scriptName worker not found')
      serviceWorkerId = target
    }
    const capabilities = await deps.store.cellCapabilities(cell)
    const required = requiredCapabilities({
      cronCount: 0,
      bindingTypes: [],
      queueConsumerCount: 0,
      workflowCount: 1,
      crossWorkerWorkflowCount: serviceWorkerId ? 1 : 0,
      serviceEntrypointCount: 0,
    })
    const missing = missingCapabilities(required, capabilities)
    if (missing.length > 0) {
      throw new VrtControlError(
        409,
        `Cell lacks capabilities: ${missing.join(', ')}`,
        'VRT_CELL_CAPABILITY_MISSING'
      )
    }

    const target = serviceWorkerId ?? id
    const [collisionTarget] = await rows(
      deps,
      `select 1 from plane_workflows
        where cluster_id=$1 and name=$2 and worker_id<>$3
          and coalesce(service_worker_id, worker_id)=$4
        limit 1`,
      [cell, body.name, id, target]
    )
    if (collisionTarget) {
      throw new VrtControlError(
        409,
        'Another worker already defines this workflow for the same target'
      )
    }

    // Cycle check on the cross-worker workflow graph (worker -> defining worker).
    const edges = await rows(
      deps,
      `select worker_id, coalesce(service_worker_id, worker_id) as target
         from plane_workflows
        where cluster_id=$1 and not (worker_id=$2 and name=$3)`,
      [cell, id, body.name]
    )
    const graph = new Map<string, string[]>()
    for (const edge of edges) {
      const from = String(edge.worker_id)
      const to = String(edge.target)
      if (from === to) continue
      const list = graph.get(from) ?? []
      list.push(to)
      graph.set(from, list)
    }
    if (target !== id) {
      const list = graph.get(id) ?? []
      list.push(target)
      graph.set(id, list)
      const seen = new Set<string>()
      const stack = [target]
      while (stack.length > 0) {
        const node = stack.pop()!
        if (node === id) throw new VrtControlError(409, 'Workflow bindings form a cycle')
        if (seen.has(node)) continue
        seen.add(node)
        for (const next of graph.get(node) ?? []) stack.push(next)
      }
    }

    const [count] = await rows(
      deps,
      'select count(*)::int as n from plane_workflows where worker_id=$1',
      [id]
    )
    const [existing] = await rows(
      deps,
      'select 1 from plane_workflows where worker_id=$1 and name=$2',
      [id, body.name]
    )
    if (!existing && Number(count?.n ?? 0) >= MAX_WORKFLOWS_PER_WORKER) {
      throw new VrtControlError(409, 'Too many workflows for this worker')
    }
    const [collision] = await rows(
      deps,
      `select 1 from plane_workers w
        join plane_versions v on v.worker_id=w.id and v.version_id=w.active_version_id
       where w.id=$1
         and (
           exists (
             select 1 from jsonb_array_elements(
               case when jsonb_typeof(v.row->'bindings')='array'
                 then v.row->'bindings' else '[]'::jsonb end
             ) b where b->>'name'=$2
           )
           or (case when jsonb_typeof(v.row->'jsonVars')='object'
             then v.row->'jsonVars' else '{}'::jsonb end) ? $2
           or v.row->>'versionMetadata'=$2
         )
       union all
       select 1 from plane_vars where worker_id=$1 and key=$2
       union all
       select 1 from plane_secrets where worker_id=$1 and key=$2
       union all
       select 1 from plane_workflows where worker_id=$1 and binding=$2 and name<>$3
       limit 1`,
      [id, binding, body.name]
    )
    if (collision) {
      throw new VrtControlError(409, `Workflow binding "${binding}" collides with another env name`)
    }
    const workflowId = generatedId(`${cell}:${id}:workflow:${body.name}`)
    const uniqueKey = sha256(`${id}:workflow:${body.name}`)
    await deps.pool.query(
      `insert into plane_workflows
         (workflow_id, worker_id, team_id, cluster_id, name, class_name, binding,
          unique_key, limits_steps, service_worker_id, success_retention_ms,
          error_retention_ms, concurrency_limit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (worker_id, name) do update set
         class_name=excluded.class_name,
         binding=excluded.binding,
         unique_key=excluded.unique_key,
         limits_steps=excluded.limits_steps,
         service_worker_id=excluded.service_worker_id,
         success_retention_ms=excluded.success_retention_ms,
         error_retention_ms=excluded.error_retention_ms,
         concurrency_limit=excluded.concurrency_limit`,
      [
        workflowId,
        id,
        team,
        cell,
        body.name,
        body.className,
        binding,
        uniqueKey,
        body.limitsSteps ?? null,
        serviceWorkerId,
        successRetentionMs ?? null,
        errorRetentionMs ?? null,
        body.concurrencyLimit ?? null,
      ]
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
      [
        workerId(c.req.param('teamId'), c.req.param('name')),
        parse(workflowNameSchema, c.req.param('workflowName')),
      ]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Workflow not found')
    return c.json({ data: { deleted: true } })
  })

  app.post(`${base}/:workflowName/ops`, async (c) => {
    const cell = c.req.param('cellId')
    const id = workerId(c.req.param('teamId'), c.req.param('name'))
    const workflowName = parse(workflowNameSchema, c.req.param('workflowName'))
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
        parse(workflowNameSchema, c.req.param('workflowName')),
      ]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })
}
