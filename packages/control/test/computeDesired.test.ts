import { describe, expect, it } from 'vitest'
import {
  buildComputeDesiredPayload,
  VRT_DO_TOMBSTONE_MAX,
  type VrtCellWorkerView,
} from '../src/index.js'

const view = (over: Partial<VrtCellWorkerView> = {}): VrtCellWorkerView => ({
  workerId: 'w1',
  teamId: 't1',
  name: 'hello',
  versionId: 'v1',
  artifactDigest: 'a'.repeat(64),
  compatibilityDate: '2024-01-01',
  compatibilityFlags: [],
  bindings: [],
  hostnames: ['hello.example.com'],
  crons: [],
  quotas: { cpuMs: 10_000, memoryMb: 128, subrequests: 50, outboundConnections: 6 },
  ...over,
})

const build = (workers: VrtCellWorkerView[], deletions: unknown[] = []) =>
  buildComputeDesiredPayload({ cellId: 'c1', revision: 3, workers, deletions: deletions as never })

describe('compute.desired builder', () => {
  it('groups workers by tenant and keeps routes and bindings', () => {
    const built = build([
      view(),
      view({
        workerId: 'w2',
        name: 'other',
        versionId: 'v2',
        bindings: [
          {
            name: 'KV',
            type: 'KV',
            resourceId: 'kv1',
            permissionRead: true,
            permissionWrite: false,
          },
        ],
        hostnames: [],
      }),
      view({ workerId: 'w3', teamId: 't2', name: 'third', hostnames: ['third.example.com'] }),
    ])
    expect(built.excluded).toEqual([])
    const tenants = built.payload.tenants
    expect(tenants.map((t) => t.tenantId)).toEqual(['t1', 't2'])
    expect(tenants[0]!.workers.map((w) => w.workerId)).toEqual(['w1', 'w2'])
    expect(tenants[0]!.workers[0]!.routes).toEqual([{ hostname: 'hello.example.com' }])
    expect(tenants[0]!.workers[1]!.bindings).toHaveLength(1)
  })

  it('is byte-stable for the same input (the signer canonicalizes it once)', () => {
    const a = build([view()])
    const b = build([view()])
    expect(JSON.stringify(a.payload)).toBe(JSON.stringify(b.payload))
  })

  it('excludes a poisoned row instead of failing the whole cell', () => {
    const built = build([
      view(),
      view({
        workerId: 'bad',
        quotas: { cpuMs: 0, memoryMb: 128, subrequests: 1, outboundConnections: 1 },
      }),
    ])
    expect(built.payload.tenants[0]!.workers.map((w) => w.workerId)).toEqual(['w1'])
    expect(built.excluded).toEqual([
      { workerId: 'bad', reason: expect.stringContaining('quotas.cpuMs') },
    ])
  })

  it('rejects a deletion set above the protocol bound', () => {
    const deletions = Array.from({ length: VRT_DO_TOMBSTONE_MAX + 1 }, (_, i) => ({
      tenantId: 't1',
      workerId: `w${i}`,
      classKey: null,
      revision: i + 1,
    }))
    expect(() => build([view()], deletions)).toThrow(/deletions/)
  })

  it('emits tombstones only for workers present in the deletion set', () => {
    const built = build(
      [view()],
      [{ tenantId: 't1', workerId: 'w1', classKey: 'c'.repeat(64), revision: 9 }]
    )
    expect(built.payload.deletions).toEqual([
      { tenantId: 't1', workerId: 'w1', classKey: 'c'.repeat(64), revision: 9 },
    ])
  })
})

describe('compute.desired validation and eviction', () => {
  const buildWith = (
    workers: VrtCellWorkerView[],
    opts: { deletions?: unknown[]; capacity?: { memoryBudgetMb?: number } } = {}
  ) =>
    buildComputeDesiredPayload({
      cellId: 'c1',
      revision: 1,
      workers,
      deletions: (opts.deletions ?? []) as never,
      ...(opts.capacity ? { capacity: opts.capacity } : {}),
    })

  it('excludes a worker with an invalid name instead of failing the cell', () => {
    const built = buildWith([view(), view({ workerId: 'w2', name: 'Bad Name' })])
    expect(built.payload.tenants[0]!.workers.map((w) => w.workerId)).toEqual(['w1'])
    expect(built.excluded).toEqual([
      expect.objectContaining({ workerId: 'w2', reason: expect.stringContaining('name') }),
    ])
  })

  it('bounds bindings per worker', () => {
    const bindings = Array.from({ length: 65 }, (_, i) => ({
      name: `B${i}`,
      type: 'VAR' as const,
      resourceId: 'v',
      permissionRead: true,
      permissionWrite: false,
    }))
    const built = buildWith([view({ bindings: bindings as never })])
    expect(built.excluded[0]?.reason).toContain('bindings')
  })

  it('evicts tenants over the cell memory budget (stable one kept)', () => {
    // A tenant's committed memory is capped at 512 MB, so the budget fits the
    // first tenant exactly and must evict the second.
    const built = buildWith(
      [
        view({ workerId: 'a1', teamId: 't1', quotas: { ...view().quotas, memoryMb: 4096 } }),
        view({ workerId: 'b1', teamId: 't2', quotas: { ...view().quotas, memoryMb: 4096 } }),
      ],
      { capacity: { memoryBudgetMb: 512 } }
    )
    expect(built.payload.tenants.map((t) => t.tenantId)).toEqual(['t1'])
    expect(built.excluded).toEqual([
      expect.objectContaining({ workerId: 'b1', reason: expect.stringContaining('memory budget') }),
    ])
  })

  it('deduplicates identical tombstones', () => {
    const deletion = { tenantId: 't1', workerId: 'w1', classKey: null, revision: 2 }
    const built = buildWith([view()], { deletions: [deletion, deletion] })
    expect(built.payload.deletions).toHaveLength(1)
  })
})
