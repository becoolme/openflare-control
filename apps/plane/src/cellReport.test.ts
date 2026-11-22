import { describe, expect, it } from 'vitest'
import { aggregateMetrics, percentile, type CellReport } from './cellReport.js'

const report = (over: Partial<CellReport> = {}): CellReport => ({
  schemaVersion: 1,
  cellId: 'cell-1',
  sampledAtMs: 1_000,
  windowMs: 30_000,
  pods: [
    {
      podId: 'pod-0',
      bootId: '1:pod-0',
      windowMs: 30_000,
      firstSample: false,
      reset: false,
      workers: [
        {
          workerId: 'team:w',
          requests: 10,
          errorRequests: 1,
          serverErrors: 1,
          exceptions: 0,
          requestBytes: 100,
          responseBytes: 200,
          inflight: 2,
          requestDuration: {
            count: 10,
            sumSeconds: 0.2,
            buckets: [
              { le: 0.005, count: 5 },
              { le: 0.05, count: 10 },
            ],
          },
        },
      ],
      tenants: [
        {
          tenantId: 'team',
          cpuSeconds: 0.25,
          memoryRssBytes: 1024,
          doStorage: [],
        },
      ],
      launches: { ready: 1, failed: 0 },
      wakes: { ok: 0, failed: 0 },
      wakeSeconds: { count: 0, sumSeconds: 0, buckets: [] },
    },
  ],
  resources: {
    sampledAtMs: 1_000,
    d1: {},
    queues: {},
    workflows: {},
    durableObjects: {},
    errors: [],
  },
  ...over,
})

describe('percentile', () => {
  it('returns the containing bucket upper bound in milliseconds', () => {
    const buckets = new Map([
      [0.005, 5],
      [0.05, 10],
    ])
    expect(percentile(buckets, 10, 0.5)).toBe(5)
    expect(percentile(buckets, 10, 0.99)).toBe(50)
  })

  it('returns null when the quantile is beyond the last finite bucket', () => {
    expect(percentile(new Map([[0.005, 1]]), 10, 0.99)).toBeNull()
    expect(percentile(new Map(), 10, 0.5)).toBeNull()
    expect(percentile(new Map([[0.005, 5]]), 0, 0.5)).toBeNull()
  })
})

describe('aggregateMetrics', () => {
  it('sums deltas across pods and keeps the newest inflight gauge', () => {
    const first = report()
    const second = report({
      sampledAtMs: 2_000,
      pods: [
        {
          ...report().pods[0]!,
          podId: 'pod-1',
          workers: [{ ...report().pods[0]!.workers[0]!, requests: 5, inflight: 0 }],
        },
      ],
    })
    const agg = aggregateMetrics([first, second], 60_000)
    expect(agg.source).toBe('runtime')
    expect(agg.requests).toBe(15)
    expect(agg.cpuMs).toBe(500)
    expect(agg.coldStarts).toBe(0)
    expect(agg.launches).toEqual({ ready: 2, failed: 0 })
    expect(agg.inflight).toBe(2)
    expect(agg.latency).toEqual({ p50: 5, p99: 50 })
    expect(agg.lastEventAt).toBe(new Date(2_000).toISOString())
    expect(agg.workers).toEqual([
      {
        workerId: 'team:w',
        requests: 15,
        errors: 2,
        serverErrors: 2,
        exceptions: 0,
        requestBytes: 200,
        responseBytes: 400,
        inflight: 0,
        latency: { p50: 5, p99: 50 },
      },
    ])
  })

  it('filters worker metrics and refuses to attribute tenant/pod numbers', () => {
    const agg = aggregateMetrics([report()], 60_000, 'team:w')
    expect(agg.requests).toBe(10)
    expect(agg.cpuMs).toBeNull()
    expect(agg.coldStarts).toBeNull()

    const other = aggregateMetrics([report()], 60_000, 'team:other')
    expect(other.requests).toBe(0)
    expect(other.inflight).toBe(0)
    // A worker-scoped response does not leak the other workers' breakdown.
    expect(other.workers).toEqual([])
  })
})
