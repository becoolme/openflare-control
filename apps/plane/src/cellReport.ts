/**
 * Wire contract for the runtime's periodic cell report (`cell-controller`
 * `report.rs` → `POST /api/internal/clusters/{cell}/vrt/metrics`).
 *
 * The runtime owns the shape; this module validates it strictly (unknown
 * fields fail closed, every count is bounded) and aggregates the deltas into
 * the read API. A report is a *window sample*: counters are already
 * differenced by the runtime, gauges are point-in-time values.
 */
import { z } from 'zod'

const count = z.number().int().min(0)
const workerId = z.string().min(1).max(160)
const tenantId = z.string().min(1).max(128)

export const histogramSchema = z
  .object({
    count,
    sumSeconds: z.number().min(0),
    buckets: z.array(z.object({ le: z.number().finite(), count }).strict()).max(256),
  })
  .strict()

const workerSchema = z
  .object({
    workerId,
    requests: count,
    errorRequests: count,
    serverErrors: count,
    exceptions: count,
    requestBytes: count,
    responseBytes: count,
    inflight: count,
    requestDuration: histogramSchema,
  })
  .strict()

const tenantSchema = z
  .object({
    tenantId,
    cpuSeconds: z.number().min(0),
    memoryRssBytes: count,
    doStorage: z
      .array(
        z
          .object({
            workerId,
            objects: count,
            storageBytes: count,
          })
          .strict()
      )
      .max(5000),
  })
  .strict()

const podSchema = z
  .object({
    podId: z.string().min(1).max(160),
    bootId: z.string().max(200),
    windowMs: count,
    firstSample: z.boolean(),
    reset: z.boolean(),
    workers: z.array(workerSchema).max(5000),
    tenants: z.array(tenantSchema).max(1000),
    launches: z.object({ ready: count, failed: count }).strict(),
    wakes: z.object({ ok: count, failed: count }).strict(),
    wakeSeconds: histogramSchema,
    processStartTimeSeconds: z.number().optional(),
  })
  .strict()

const instanceSchema = z.object({ id: z.string().min(1).max(256), bytes: count }).strict()

const instanceSetSchema = z
  .object({
    declared: z.boolean(),
    instances: z.array(instanceSchema).max(1000),
    instanceCount: count,
    storageBytes: count,
    truncated: z.boolean(),
    sampledAtMs: count,
  })
  .strict()

const d1StatsSchema = z
  .object({
    sizeBytes: count,
    pageCount: count,
    pageSize: count,
    tableCount: count,
    tables: z.array(z.string().max(256)).max(5000),
    indexCount: count,
    userVersion: count,
  })
  .strict()

const queueStatsSchema = z
  .object({
    backlog: z.number().int(),
    backlogBytes: z.number().int(),
    oldestMessageTimestampMs: z.number().int().nullable(),
    visible: z.number().int(),
    inFlight: z.number().int(),
    delayed: z.number().int(),
    dead: z.number().int(),
  })
  .strict()

const resourceKey = z.string().min(1).max(160)
const classKey = z.string().min(1).max(64)

const resourcesSchema = z
  .object({
    sampledAtMs: count,
    d1: z.record(z.string().regex(/^[a-z0-9]{26}$/), d1StatsSchema),
    queues: z.record(z.string().regex(/^[a-z0-9]{26}$/), queueStatsSchema),
    workflows: z.record(resourceKey, z.record(classKey, instanceSetSchema)),
    durableObjects: z.record(resourceKey, z.record(classKey, instanceSetSchema)),
    errors: z.array(z.string().max(512)).max(500),
  })
  .strict()

export const cellReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    cellId: z.string().min(1).max(128),
    sampledAtMs: count,
    windowMs: count,
    pods: z.array(podSchema).max(64),
    resources: resourcesSchema.optional(),
  })
  .strict()

export type CellReport = z.output<typeof cellReportSchema>
export type CellReportResources = z.output<typeof resourcesSchema>
export type CellReportInstanceSet = z.output<typeof instanceSetSchema>

export interface LatencySummary {
  p50: number | null
  p99: number | null
}

export interface MetricsAggregate {
  windowMs: number
  requests: number
  errors: number
  serverErrors: number
  exceptions: number
  requestBytes: number
  responseBytes: number
  inflight: number
  cpuMs: number | null
  coldStarts: number | null
  latency: LatencySummary
  durationCount: number
  durationSumSeconds: number
  lastEventAt: string | null
  source: 'runtime'
  note: string
}

type Report = CellReport

/**
 * Aggregate the deltas of every report in the requested window. `workerId`
 * restricts request/latency numbers; CPU and cold starts are pod/tenant
 * scoped in the runtime, so they stay null for a worker view rather than
 * being attributed to the wrong process.
 */
export function aggregateMetrics(
  reports: readonly Report[],
  windowMs: number,
  workerIdFilter?: string | null
): MetricsAggregate {
  let requests = 0
  let errors = 0
  let serverErrors = 0
  let exceptions = 0
  let requestBytes = 0
  let responseBytes = 0
  let cpuSeconds = 0
  let coldStarts = 0
  let durationCount = 0
  let durationSum = 0
  let lastEventMs = 0
  const buckets = new Map<number, number>()
  // Gauges: newest pod sample wins, never a sum over time.
  const newest = new Map<string, { at: number; inflight: number }>()

  for (const report of reports) {
    lastEventMs = Math.max(lastEventMs, report.sampledAtMs)
    for (const pod of report.pods) {
      for (const tenant of pod.tenants) cpuSeconds += tenant.cpuSeconds
      coldStarts += pod.launches.ready
      for (const worker of pod.workers) {
        if (workerIdFilter && worker.workerId !== workerIdFilter) continue
        requests += worker.requests
        errors += worker.errorRequests
        serverErrors += worker.serverErrors
        exceptions += worker.exceptions
        requestBytes += worker.requestBytes
        responseBytes += worker.responseBytes
        durationCount += worker.requestDuration.count
        durationSum += worker.requestDuration.sumSeconds
        for (const bucket of worker.requestDuration.buckets) {
          buckets.set(bucket.le, (buckets.get(bucket.le) ?? 0) + bucket.count)
        }
        const prev = newest.get(pod.podId)
        if (!prev || report.sampledAtMs >= prev.at) {
          newest.set(pod.podId, { at: report.sampledAtMs, inflight: worker.inflight })
        }
      }
    }
  }
  const inflight = [...newest.values()].reduce((sum, v) => sum + v.inflight, 0)
  return {
    windowMs,
    requests,
    errors,
    serverErrors,
    exceptions,
    requestBytes,
    responseBytes,
    inflight,
    cpuMs: workerIdFilter ? null : Math.round(cpuSeconds * 1000),
    coldStarts: workerIdFilter ? null : coldStarts,
    latency: {
      p50: percentile(buckets, durationCount, 0.5),
      p99: percentile(buckets, durationCount, 0.99),
    },
    durationCount,
    durationSumSeconds: durationSum,
    lastEventAt: lastEventMs ? new Date(lastEventMs).toISOString() : null,
    source: 'runtime',
    note: workerIdFilter
      ? 'request/latency metrics are per worker; CPU and cold starts are reported per tenant/pod, so they stay null here'
      : 'metrics from the runtime cell report; CPU is tenant CPU (all workers of the team)',
  }
}

/** Bucket upper bound at the requested quantile. The runtime sends
 * cumulative bucket counts; when the sample lies between buckets the upper
 * bound is reported (a conservative, never-understated latency). */
export function percentile(
  buckets: ReadonlyMap<number, number>,
  total: number,
  q: number
): number | null {
  if (total <= 0 || buckets.size === 0) return null
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  const target = total * q
  for (const [le, cumulative] of sorted) {
    if (cumulative >= target) return Math.round(le * 1000 * 100) / 100
  }
  return Math.round(sorted[sorted.length - 1]![0] * 1000 * 100) / 100
}
