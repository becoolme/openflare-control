import type { Hono } from 'hono'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, rows, workerId } from './context.js'

/**
 * Stats surfaces. Numbers that the reference plane actually stores (op counts,
 * log-derived request/error counts, consumer/producer rows) are real; data that
 * only the data plane can measure is explicitly `null` with a note, never a
 * fabricated value. Instance-list endpoints that the runtime does not expose
 * answer a typed 501 so the console can render the gap honestly.
 */
export function registerStats(app: Hono, deps: AdminDeps): void {
  const metrics = async (cell: string, worker?: string | null, window?: string | null) => {
    const windowMs = Math.min(
      Math.max(Number(window ?? '86400000') || 86_400_000, 1000),
      30 * 86_400_000
    )
    const since = Date.now() - windowMs
    const [row] = await rows(
      deps,
      `select
         count(*) filter (where kind='request')::int as requests,
         count(*) filter (where kind='request' and coalesce(outcome,'') <> 'ok')::int as errors,
         count(*) filter (where status >= 500)::int as server_errors,
         max(ts_ms) as last_event_ms
       from plane_logs
       where cell_id=$1 and ($2::text is null or worker_id=$2) and ts_ms >= $3`,
      [cell, worker ?? null, since]
    )
    return {
      windowMs,
      requests: Number(row?.requests ?? 0),
      errors: Number(row?.errors ?? 0),
      serverErrors: Number(row?.server_errors ?? 0),
      lastEventAt: row?.last_event_ms ? new Date(Number(row.last_event_ms)).toISOString() : null,
      // Not emitted by the runtime logs channel yet.
      cpuMs: null,
      coldStarts: null,
      note: 'request/error counts come from ingested logs; CPU and cold starts are not reported by the runtime',
    }
  }

  app.get('/api/v1/cells/:cellId/metrics', async (c) => {
    const data = await metrics(
      c.req.param('cellId'),
      c.req.query('workerId'),
      c.req.query('windowMs')
    )
    return c.json({ data })
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/metrics', async (c) => {
    const data = await metrics(
      c.req.param('cellId'),
      workerId(c.req.param('teamId'), c.req.param('name')),
      c.req.query('windowMs')
    )
    return c.json({ data })
  })

  app.get('/api/v1/cells/:cellId/d1/databases/:databaseId/stats', async (c) => {
    const cell = c.req.param('cellId')
    const id = c.req.param('databaseId')
    const [db] = await rows(
      deps,
      'select database_id from plane_d1_databases where database_id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!db) throw new VrtControlError(404, 'D1 database not found')
    const [ops] = await rows(
      deps,
      `select count(*)::int as total,
              count(*) filter (where status='PENDING')::int as pending,
              count(*) filter (where status='FAILED')::int as failed,
              max(created_at) as last_op_at
         from plane_d1_ops where cell_id=$1 and database_id=$2`,
      [cell, id]
    )
    return c.json({
      data: {
        databaseId: id,
        ops: Number(ops?.total ?? 0),
        pendingOps: Number(ops?.pending ?? 0),
        failedOps: Number(ops?.failed ?? 0),
        lastOpAt: ops?.last_op_at ?? null,
        sizeBytes: null,
        tableCount: null,
        pendingMigrations: null,
        note: 'size/tables/migrations require a live D1 data-plane query',
      },
    })
  })

  app.get('/api/v1/cells/:cellId/r2/buckets/:bucketName/stats', async (c) => {
    const cell = c.req.param('cellId')
    const name = c.req.param('bucketName')
    const [bucket] = await rows(
      deps,
      'select bucket_id from plane_r2_buckets where bucket_name=$1 and cluster_id=$2',
      [name, cell]
    )
    if (!bucket) throw new VrtControlError(404, 'R2 bucket not found')
    const [ops] = await rows(
      deps,
      `select count(*)::int as total,
              count(*) filter (where status='PENDING')::int as pending,
              count(*) filter (where status='FAILED')::int as failed,
              max(created_at) as last_op_at
         from plane_cell_ops
        where cell_id=$1 and resource_key=$2 and kind like 'R2\\_%'`,
      [cell, bucket.bucket_id]
    )
    return c.json({
      data: {
        bucketName: name,
        ops: Number(ops?.total ?? 0),
        pendingOps: Number(ops?.pending ?? 0),
        failedOps: Number(ops?.failed ?? 0),
        lastOpAt: ops?.last_op_at ?? null,
        objects: null,
        sizeBytes: null,
        classAOps: null,
        classBOps: null,
        note: 'object/size/class counts require the R2 data plane',
      },
    })
  })

  app.get('/api/v1/cells/:cellId/queues/:queueId/stats', async (c) => {
    const cell = c.req.param('cellId')
    const id = c.req.param('queueId')
    const [queue] = await rows(
      deps,
      'select * from plane_queues where queue_id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!queue) throw new VrtControlError(404, 'Queue not found')
    const [consumers] = await rows(
      deps,
      `select count(*)::int as n
         from plane_versions v,
              jsonb_array_elements(coalesce(v.row->'queueConsumers','[]'::jsonb)) c
        where c->>'queueId'=$1`,
      [id]
    )
    const [producers] = await rows(
      deps,
      `select count(*)::int as n
         from plane_versions v,
              jsonb_array_elements(coalesce(v.row->'bindings','[]'::jsonb)) b
        where b->>'type'='queue' and b->>'resourceId'=$1`,
      [id]
    )
    return c.json({
      data: {
        queueId: id,
        deliveryDelaySeconds: queue.delivery_delay_seconds,
        consumers: Number(consumers?.n ?? 0),
        producers: Number(producers?.n ?? 0),
        backlog: null,
        delivered: null,
        oldestMessageAgeMs: null,
        deadLetterDepth: null,
        note: 'backlog/delivery metrics require the queue data plane',
      },
    })
  })

  app.get(
    '/api/v1/cells/:cellId/teams/:teamId/workers/:name/workflows/:workflowName/stats',
    async (c) => {
      const cell = c.req.param('cellId')
      const id = workerId(c.req.param('teamId'), c.req.param('name'))
      const workflowName = c.req.param('workflowName')
      const [workflow] = await rows(
        deps,
        'select * from plane_workflows where worker_id=$1 and name=$2',
        [id, workflowName]
      )
      if (!workflow) throw new VrtControlError(404, 'Workflow not found')
      const [ops] = await rows(
        deps,
        `select count(*)::int as total,
                count(*) filter (where status='PENDING')::int as pending,
                count(*) filter (where status='FAILED')::int as failed
           from plane_cell_ops
          where cell_id=$1 and worker_id=$2 and resource_key=$3 and kind like 'WF\\_%'`,
        [cell, id, workflowName]
      )
      return c.json({
        data: {
          workflow: workflowName,
          className: workflow.class_name,
          ops: Number(ops?.total ?? 0),
          pendingOps: Number(ops?.pending ?? 0),
          failedOps: Number(ops?.failed ?? 0),
          runningInstances: null,
          waitingInstances: null,
          completedInstances: null,
          erroredInstances: null,
          note: 'instance counters require a workflow instance index in the runtime',
        },
      })
    }
  )

  app.get('/api/v1/cells/:cellId/durable-objects/:className/stats', async (c) => {
    const cell = c.req.param('cellId')
    const className = c.req.param('className')
    const [declared] = await rows(
      deps,
      `select count(*)::int as n
         from plane_workers w join plane_versions v on v.version_id = w.active_version_id
        where w.cluster_id=$1 and coalesce(v.row->'exportedClassNames','[]'::jsonb) ? $2`,
      [cell, className]
    )
    if (!declared || Number(declared.n) === 0) {
      throw new VrtControlError(404, 'Durable Object class not found')
    }
    const [bindings] = await rows(
      deps,
      `select count(*)::int as n
         from plane_workers w join plane_versions v on v.version_id = w.active_version_id,
              jsonb_array_elements(coalesce(v.row->'bindings','[]'::jsonb)) b
        where w.cluster_id=$1 and b->>'type'='DO'
          and split_part(b->>'resourceId', ':', 2) = $2`,
      [cell, className]
    )
    return c.json({
      data: {
        className,
        workers: Number(declared.n),
        bindings: Number(bindings?.n ?? 0),
        instances: null,
        activeInstances: null,
        storageBytes: null,
        note: 'instance/storage counts require a DO registry in the runtime',
      },
    })
  })

  // Explicit unsupported surfaces: a typed 501 lets the console distinguish
  // "API missing" from "network/auth failure" without guessing.
  const unsupported = (what: string) =>
    new VrtControlError(501, `${what} is not exposed by the runtime`, 'VRT_NOT_SUPPORTED')

  app.get('/api/v1/cells/:cellId/workflows/:name/instances', () => {
    throw unsupported('Workflow instance listing')
  })
  app.get('/api/v1/cells/:cellId/durable-objects/:className/instances', () => {
    throw unsupported('Durable Object instance listing')
  })
}
