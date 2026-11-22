import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import { VrtControlError } from 'openflare-control'
import {
  aggregateMetrics,
  type CellReport,
  type CellReportInstanceSet,
  type CellReportResources,
} from '../cellReport.js'
import { type AdminDeps, rows, workerId } from './context.js'

/** Reuse a bucket scan for a minute; a refresh (or a stale result) rescans. */
const R2_STATS_TTL_MS = 60_000

interface R2Aggregate {
  objects: number
  sizeBytes: number
  truncated: boolean
  sampledAtMs: number
}

/** Validate the cell's op result before exposing it; a malformed result is
 * treated as "no stats", never rendered as a huge/negative number. */
function parseR2Stats(value: unknown): R2Aggregate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const objects = Number(v.objects)
  const sizeBytes = Number(v.sizeBytes)
  const sampledAtMs = Number(v.sampledAtMs)
  if (!Number.isSafeInteger(objects) || objects < 0) return null
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null
  return {
    objects,
    sizeBytes,
    truncated: v.truncated === true,
    sampledAtMs:
      Number.isFinite(sampledAtMs) && sampledAtMs > 0 ? Math.trunc(sampledAtMs) : Date.now(),
  }
}

/**
 * Stats surfaces. Values are real wherever the runtime reports them:
 * - request/error/latency/CPU/cold-start metrics come from the periodic
 *   cell report (falling back to ingested logs only when no report exists);
 * - D1 size/tables, queue backlog, workflow/DO instances come from the
 *   report's data-plane snapshot;
 * - R2 object counts are fetched on demand with an `R2_STATS` cell op
 *   (bucket ids are control-plane knowledge, so they cannot ride the
 *   desired-driven periodic report).
 * A value the runtime cannot measure is `null` with an explicit note, never
 * a fabricated number.
 */
export function registerStats(app: Hono, deps: AdminDeps): void {
  const windowFrom = (raw: string | null | undefined): number =>
    Math.min(Math.max(Number(raw ?? '86400000') || 86_400_000, 1000), 30 * 86_400_000)

  const loadReports = async (cell: string, windowMs: number): Promise<CellReport[]> => {
    const list = await rows(
      deps,
      `select payload from plane_cell_metrics
        where cell_id=$1 and sampled_at >= now() - ($2::bigint * interval '1 millisecond')
        order by sampled_at asc limit 10000`,
      [cell, windowMs]
    )
    return list.map((r) => r.payload as CellReport)
  }

  const loadResources = async (
    cell: string
  ): Promise<{ resources: CellReportResources; sampledAt: string | null } | null> => {
    const [row] = await rows(
      deps,
      'select payload, sampled_at from plane_cell_resources where cell_id=$1',
      [cell]
    )
    if (!row) return null
    return {
      resources: row.payload as CellReportResources,
      sampledAt: row.sampled_at ? new Date(String(row.sampled_at)).toISOString() : null,
    }
  }

  const metrics = async (cell: string, worker?: string | null, window?: string | null) => {
    const windowMs = windowFrom(window)
    const reports = await loadReports(cell, windowMs)
    if (reports.length > 0) {
      return aggregateMetrics(reports, windowMs, worker ?? null)
    }
    // Older cells before the report channel existed: logs are the only
    // source of request/error counts.
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
      exceptions: 0,
      requestBytes: 0,
      responseBytes: 0,
      inflight: 0,
      cpuMs: null,
      coldStarts: null,
      latency: { p50: null, p99: null },
      durationCount: 0,
      durationSumSeconds: 0,
      lastEventAt: row?.last_event_ms ? new Date(Number(row.last_event_ms)).toISOString() : null,
      source: 'logs' as const,
      note: 'fallback: request/error counts come from ingested logs; the runtime report has not arrived yet (CPU/cold starts/latency unavailable)',
      workers: [],
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
              count(*) filter (where kind='MIGRATIONS_APPLY' and status='PENDING')::int as pending_migrations,
              max(created_at) as last_op_at
         from plane_d1_ops where cell_id=$1 and database_id=$2`,
      [cell, id]
    )
    const snapshot = await loadResources(cell)
    const stats = snapshot?.resources.d1[id]
    return c.json({
      data: {
        databaseId: id,
        ops: Number(ops?.total ?? 0),
        pendingOps: Number(ops?.pending ?? 0),
        failedOps: Number(ops?.failed ?? 0),
        lastOpAt: ops?.last_op_at ?? null,
        pendingMigrations: Number(ops?.pending_migrations ?? 0),
        sizeBytes: stats?.sizeBytes ?? null,
        pageCount: stats?.pageCount ?? null,
        pageSize: stats?.pageSize ?? null,
        tableCount: stats?.tableCount ?? null,
        tables: stats?.tables ?? null,
        indexCount: stats?.indexCount ?? null,
        userVersion: stats?.userVersion ?? null,
        sampledAt: snapshot?.sampledAt ?? null,
        note: stats
          ? 'size/tables from the D1 data plane; op counts from the control-plane ledger'
          : 'the runtime has not reported D1 stats yet (it reports every collection interval)',
      },
    })
  })

  app.get('/api/v1/cells/:cellId/r2/buckets/:bucketName/stats', async (c) => {
    const cell = c.req.param('cellId')
    const name = c.req.param('bucketName')
    const [bucket] = await rows(
      deps,
      'select * from plane_r2_buckets where bucket_name=$1 and cluster_id=$2',
      [name, cell]
    )
    if (!bucket) throw new VrtControlError(404, 'R2 bucket not found')
    const [ops] = await rows(
      deps,
      `select count(*)::int as total,
              count(*) filter (where status='PENDING')::int as pending,
              count(*) filter (where status='FAILED')::int as failed,
              count(*) filter (where kind in ('R2_LIST','R2_PUT'))::int as class_a,
              count(*) filter (where kind in ('R2_GET','R2_HEAD'))::int as class_b,
              max(created_at) as last_op_at
         from plane_cell_ops
        where cell_id=$1 and resource_key=$2
          and kind in ('R2_LIST','R2_HEAD','R2_GET','R2_PUT','R2_DELETE')`,
      [cell, bucket.bucket_id]
    )
    const waitMs = Math.min(Math.max(Number(c.req.query('waitMs') ?? '5000') || 0, 0), 15_000)
    const refresh = c.req.query('refresh') === '1'
    const [cached] = await rows(
      deps,
      `select result, status, created_at from plane_cell_ops
        where cell_id=$1 and resource_key=$2 and kind='R2_STATS'
        order by seq desc limit 1`,
      [cell, bucket.bucket_id]
    )
    let stats = parseR2Stats(cached?.status === 'DONE' ? cached.result : null)
    const cachedAtMs = cached?.created_at ? new Date(String(cached.created_at)).getTime() : 0
    const stale =
      !stats || !Number.isFinite(cachedAtMs) || Date.now() - cachedAtMs > R2_STATS_TTL_MS
    let pending = false
    let opError: string | null = null
    if ((refresh || stale) && waitMs > 0) {
      const [cellRow] = await rows(deps, 'select capabilities from plane_cells where cell_id=$1', [
        cell,
      ])
      const caps = (cellRow?.capabilities ?? {}) as Record<string, unknown>
      if (caps.r2 === true) {
        // Coalesce concurrent refreshes: wait on an in-flight op instead of
        // enqueueing one scan per console request.
        const [pendingOp] = await rows(
          deps,
          `select id from plane_cell_ops
            where cell_id=$1 and resource_key=$2 and kind='R2_STATS' and status='PENDING'
              and (expires_at is null or expires_at > now())
            order by seq desc limit 1`,
          [cell, bucket.bucket_id]
        )
        const opId = (pendingOp?.id as string | undefined) ?? randomUUID()
        if (!pendingOp) {
          await deps.pool.query(
            `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
             values ($1,$2,'',$3,'R2_STATS',$4, now() + interval '30 seconds')`,
            [opId, cell, bucket.bucket_id, { tenantId: bucket.team_id, bucketId: bucket.bucket_id }]
          )
        }
        const deadline = Date.now() + waitMs
        while (Date.now() < deadline) {
          const [op] = await rows(
            deps,
            'select status, result, error from plane_cell_ops where id=$1',
            [opId]
          )
          if (op?.status === 'DONE' && op.result) {
            stats = parseR2Stats(op.result) ?? stats
            break
          }
          if (op?.status === 'FAILED' || op?.status === 'EXPIRED') {
            opError = String(op.error ?? op.status)
            break
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        pending = !stats && !opError
      } else if (!stats) {
        opError = 'cell does not advertise the r2 capability'
      }
    }
    return c.json({
      data: {
        bucketName: name,
        ops: Number(ops?.total ?? 0),
        pendingOps: Number(ops?.pending ?? 0),
        failedOps: Number(ops?.failed ?? 0),
        classAOps: Number(ops?.class_a ?? 0),
        classBOps: Number(ops?.class_b ?? 0),
        lastOpAt: ops?.last_op_at ?? null,
        objects: stats?.objects ?? null,
        sizeBytes: stats?.sizeBytes ?? null,
        truncated: stats?.truncated ?? null,
        sampledAt: stats ? new Date(stats.sampledAtMs).toISOString() : null,
        stale: stats ? stale : null,
        pending,
        error: opError,
        note: stats
          ? stale
            ? 'cached R2 stats; refresh with refresh=1&waitMs=... to rescan the bucket'
            : 'object/size counts from a bounded R2 list scan; class A/B from the control-plane op ledger'
          : opError
            ? `bucket stats unavailable: ${opError}`
            : pending
              ? 'the R2 stats op is still pending on the cell'
              : 'no R2 stats yet; request one with waitMs (add refresh=1 to bypass the cache)',
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
    const snapshot = await loadResources(cell)
    const stats = snapshot?.resources.queues[id]
    const oldest = stats?.oldestMessageTimestampMs ?? null
    return c.json({
      data: {
        queueId: id,
        deliveryDelaySeconds: queue.delivery_delay_seconds,
        consumers: Number(consumers?.n ?? 0),
        producers: Number(producers?.n ?? 0),
        backlog: stats?.backlog ?? null,
        backlogBytes: stats?.backlogBytes ?? null,
        visible: stats?.visible ?? null,
        inFlight: stats?.inFlight ?? null,
        delayed: stats?.delayed ?? null,
        oldestMessageAgeMs: oldest === null ? null : Math.max(0, Date.now() - oldest),
        deadLetterDepth: stats?.dead ?? null,
        // The delivered counter lives in the cell-controller's local
        // registry; it is not part of the pod scrape yet.
        delivered: null,
        sampledAt: snapshot?.sampledAt ?? null,
        note: stats
          ? 'backlog/visible/in-flight/delayed/DLQ from the queue data plane; delivered is not reported yet'
          : 'the runtime has not reported queue stats yet',
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
      const snapshot = await loadResources(cell)
      const set = snapshot?.resources.workflows[id]?.[workflowName]
      return c.json({
        data: {
          workflow: workflowName,
          className: workflow.class_name,
          ops: Number(ops?.total ?? 0),
          pendingOps: Number(ops?.pending ?? 0),
          failedOps: Number(ops?.failed ?? 0),
          instances: set?.instanceCount ?? null,
          storageBytes: set?.storageBytes ?? null,
          truncated: set?.truncated ?? null,
          sampledAt: snapshot?.sampledAt ?? null,
          runningInstances: null,
          waitingInstances: null,
          completedInstances: null,
          erroredInstances: null,
          note: set
            ? 'instance count/storage from the engine class dir; per-state counters (running/waiting/completed) need engine status indexing'
            : 'the runtime has not reported workflow instances yet',
        },
      })
    }
  )

  app.get('/api/v1/cells/:cellId/durable-objects/:className/stats', async (c) => {
    const cell = c.req.param('cellId')
    const className = c.req.param('className')
    const declared = await rows(
      deps,
      `select w.id
         from plane_workers w join plane_versions v on v.version_id = w.active_version_id
        where w.cluster_id=$1 and coalesce(v.row->'exportedClassNames','[]'::jsonb) ? $2`,
      [cell, className]
    )
    if (declared.length === 0) {
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
    const snapshot = await loadResources(cell)
    const sets = declared
      .map((w) => snapshot?.resources.durableObjects[w.id as string]?.[className])
      .filter((s): s is CellReportInstanceSet => Boolean(s))
    const instances = sets.reduce((n, s) => n + s.instanceCount, 0)
    const storageBytes = sets.reduce((n, s) => n + s.storageBytes, 0)
    return c.json({
      data: {
        className,
        workers: declared.length,
        bindings: Number(bindings?.n ?? 0),
        instances: sets.length > 0 ? instances : null,
        activeInstances: null,
        storageBytes: sets.length > 0 ? storageBytes : null,
        truncated: sets.some((s) => s.truncated),
        sampledAt: snapshot?.sampledAt ?? null,
        note:
          sets.length > 0
            ? 'instances/storage from the declared class dirs; activeInstances needs engine liveness indexing'
            : 'the runtime has not reported DO instances yet',
      },
    })
  })

  const instanceList = async (
    cell: string,
    kind: 'workflow' | 'durableObject',
    name: string
  ): Promise<{
    instances: { id: string; bytes: number; workerId: string }[]
    total: number
    storageBytes: number
    truncated: boolean
    sampledAt: string | null
    waiting: boolean
  }> => {
    const snapshot = await loadResources(cell)
    const pairs: { workerId: string; set: CellReportInstanceSet | undefined }[] = []
    if (kind === 'workflow') {
      const workflows = await rows(
        deps,
        'select worker_id from plane_workflows where cluster_id=$1 and name=$2',
        [cell, name]
      )
      for (const w of workflows) {
        pairs.push({
          workerId: w.worker_id as string,
          set: snapshot?.resources.workflows[w.worker_id as string]?.[name],
        })
      }
    } else {
      const workers = await rows(
        deps,
        `select w.id
           from plane_workers w join plane_versions v on v.version_id = w.active_version_id
          where w.cluster_id=$1 and coalesce(v.row->'exportedClassNames','[]'::jsonb) ? $2`,
        [cell, name]
      )
      for (const w of workers) {
        pairs.push({
          workerId: w.id as string,
          set: snapshot?.resources.durableObjects[w.id as string]?.[name],
        })
      }
    }
    const instances = pairs.flatMap(({ workerId, set }) =>
      (set?.instances ?? []).map((i) => ({ id: i.id, bytes: i.bytes, workerId }))
    )
    return {
      instances,
      total: pairs.reduce((n, { set }) => n + (set?.instanceCount ?? 0), 0),
      storageBytes: pairs.reduce((n, { set }) => n + (set?.storageBytes ?? 0), 0),
      truncated: pairs.some(({ set }) => set?.truncated === true),
      sampledAt: snapshot?.sampledAt ?? null,
      waiting: pairs.length === 0 || pairs.every(({ set }) => !set),
    }
  }

  app.get('/api/v1/cells/:cellId/workflows/:name/instances', async (c) => {
    const cell = c.req.param('cellId')
    const name = c.req.param('name')
    const workflows = await rows(
      deps,
      'select worker_id from plane_workflows where cluster_id=$1 and name=$2',
      [cell, name]
    )
    if (workflows.length === 0) throw new VrtControlError(404, 'Workflow not found')
    const list = await instanceList(cell, 'workflow', name)
    return c.json({
      data: {
        workflow: name,
        ...list,
        note: list.waiting
          ? 'the runtime has not reported instances yet (collection runs every interval)'
          : 'instance ids are the engine class-dir file stems',
      },
    })
  })

  app.get('/api/v1/cells/:cellId/durable-objects/:className/instances', async (c) => {
    const cell = c.req.param('cellId')
    const className = c.req.param('className')
    const declared = await rows(
      deps,
      `select w.id
         from plane_workers w join plane_versions v on v.version_id = w.active_version_id
        where w.cluster_id=$1 and coalesce(v.row->'exportedClassNames','[]'::jsonb) ? $2`,
      [cell, className]
    )
    if (declared.length === 0) {
      throw new VrtControlError(404, 'Durable Object class not found')
    }
    const list = await instanceList(cell, 'durableObject', className)
    return c.json({
      data: {
        className,
        ...list,
        note: list.waiting
          ? 'the runtime has not reported instances yet (collection runs every interval)'
          : 'instance ids are the DO class-dir sqlite stems',
      },
    })
  })
}
