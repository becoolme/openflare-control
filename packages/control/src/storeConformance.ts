/**
 * Store conformance suite — the anti-drift gate between the Prisma store
 * (vibeploy) and the SQL store (OSS plane).
 *
 * Both implementations must pass the SAME cases; a new store method that
 * changes observable semantics lands with a case here, otherwise the two
 * deployments can diverge silently. The suite is framework-agnostic on
 * purpose: it throws plain errors so each side can wrap it in vitest (or
 * any other runner) without this module depending on a test framework.
 */
import type { VrtControlStore, VrtCreateVersionInput, VrtStoreWorker } from './vrtStorePort.js'

export interface StoreConformanceHarness {
  readonly store: VrtControlStore
  readonly clusterId: string
  readonly cellId: string
  /** Real team ids: the suite must not invent FKs (the Prisma store is
   * backed by a relational schema that rejects unknown teams). */
  readonly teamId: string
  readonly otherTeamId: string
  /** `createdById` value the store accepts for rows the suite creates. */
  readonly createdById: string
  /** Create (or plant) a VRT worker in `clusterId` and return the row. */
  seedWorker(input: { teamId: string; name: string }): Promise<VrtStoreWorker>
}

export interface StoreConformanceCase {
  readonly name: string
  run(h: StoreConformanceHarness): Promise<void>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[store conformance] ${message}`)
}

const uniq = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function versionInput(
  worker: VrtStoreWorker,
  createdById: string,
  overrides: Partial<VrtCreateVersionInput> = {}
): VrtCreateVersionInput {
  const tag = uniq()
  const digest = `${'a'.repeat(8)}${tag.replace(/-/g, '0').padEnd(56, '0')}`.slice(0, 64)
  return {
    workerId: worker.id,
    versionId: `conf-ver-${tag}`,
    bundleSha256: digest,
    bundleKey: `vrt-bundles/${digest}`,
    bundleBytes: 8,
    mainModule: 'index.js',
    modules: [{ name: 'index.js', digest }],
    compatibilityDate: '2024-01-01',
    compatibilityFlags: [],
    crons: [],
    quotas: { cpuMs: 10, memoryMb: 64, subrequests: 0, outboundConnections: 0 },
    varValues: {},
    bindingsFingerprint: digest.slice(0, 32),
    runtimeConfigDigest: digest,
    bindings: [],
    createdById,
    ...overrides,
  }
}

export const storeConformanceCases: readonly StoreConformanceCase[] = [
  {
    name: 'getWorker is requester-team scoped; findWorkerById is not',
    async run(h) {
      const worker = await h.seedWorker({ teamId: h.teamId, name: `scope-${uniq()}` })
      assert((await h.store.getWorker(worker.id, h.teamId))?.id === worker.id, 'own team reads')
      assert(
        (await h.store.getWorker(worker.id, h.otherTeamId)) === null,
        'foreign team must not read the worker'
      )
      assert(
        (await h.store.findWorkerById(worker.id))?.id === worker.id,
        'findWorkerById is the server-side ownership probe and stays unscoped'
      )
    },
  },
  {
    name: 'findWorkerByName is (team, cluster) scoped',
    async run(h) {
      const name = `name-${uniq()}`
      const worker = await h.seedWorker({ teamId: h.teamId, name })
      assert(
        (await h.store.findWorkerByName(h.teamId, h.clusterId, name))?.id === worker.id,
        'same team + cluster resolves the worker'
      )
      assert(
        (await h.store.findWorkerByName(h.otherTeamId, h.clusterId, name)) === null,
        'another team must not resolve the name'
      )
      assert(
        (await h.store.findWorkerByName(h.teamId, 'other-cluster', name)) === null,
        'another cluster must not resolve the name'
      )
    },
  },
  {
    name: 'createVersionWithBindings is idempotent by content',
    async run(h) {
      const worker = await h.seedWorker({ teamId: h.teamId, name: `ver-${uniq()}` })
      const input = versionInput(worker, h.createdById)
      const first = await h.store.createVersionWithBindings(input)
      assert(first.created, 'first insert must report created=true')
      const second = await h.store.createVersionWithBindings(input)
      assert(!second.created, 'the same content must not create a second version')
      assert(
        second.version.versionId === first.version.versionId,
        'the idempotent call must return the original version'
      )
      const listed = await h.store.listVersions(worker.id, { limit: 10 })
      assert(
        listed.filter((v) => v.versionId === first.version.versionId).length === 1,
        'the version must be listed exactly once'
      )
    },
  },
  {
    name: 'publications allocate monotonic revisions and latestPublication mirrors the write',
    async run(h) {
      const now = new Date()
      const publish = async (): Promise<number> =>
        h.store.runCellTransaction(h.clusterId, async (tx) => {
          const revision = await tx.allocateRevision()
          await tx.createPublication({
            cause: 'DEPLOY',
            publishedById: null,
            revision,
            envelope: { schemaVersion: 1, revision },
            payloadDigest: 'p'.repeat(64),
            envelopeDigest: 'e'.repeat(64),
            issuedAt: now,
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
          })
          return revision
        })

      const first = await publish()
      const second = await publish()
      assert(second === first + 1, `revisions must increase monotonically (${first} -> ${second})`)
      const latest = await h.store.latestPublication(h.cellId)
      assert(latest !== null, 'latestPublication must return the row just written')
      assert(
        latest.revision === second,
        `latest revision must be ${second}, got ${latest.revision}`
      )
      const below = await h.store.latestAppliedPublicationBelow(h.cellId, second)
      assert(below === null || below.revision < second, 'history query must stay below the cursor')
    },
  },
  {
    name: 'capability bits round-trip per cell',
    async run(h) {
      // Ensure the cell row exists (recordCellCapabilities runs inside the
      // per-cell transaction and must not be the first writer to create it
      // on one implementation but not the other).
      await h.store.runCellTransaction(h.clusterId, (tx) => tx.allocateRevision())
      await h.store.recordCellCapabilities(h.clusterId, { cron: true, assets: false, kv: true })
      const caps = await h.store.cellCapabilities(h.clusterId)
      assert(caps?.cron === true, 'cron=true must survive the round trip')
      assert(caps?.assets === false, 'assets=false must survive as false (fail closed)')
      assert(caps?.kv === true, 'optional bits must survive the round trip')
    },
  },
  {
    name: 'retention prunes only terminal publications beyond keep-N',
    async run(h) {
      const digests: string[] = []
      const created: number[] = []
      for (let i = 0; i < 4; i += 1) {
        const digest = `${i}`.repeat(1).padStart(64, '0')
        const revision = await h.store.runCellTransaction(h.clusterId, async (tx) => {
          const rev = await tx.allocateRevision()
          await tx.createPublication({
            cause: 'DEPLOY',
            publishedById: null,
            revision: rev,
            envelope: { schemaVersion: 1, revision: rev },
            payloadDigest: 'p'.repeat(64),
            envelopeDigest: digest,
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          })
          return rev
        })
        created.push(revision)
        digests.push(digest)
        const ack = await h.store.recordPublicationAck(h.cellId, revision, {
          status: 'APPLIED',
          ackedAt: new Date(),
          envelopeDigest: digest,
        })
        assert(
          ack === 'written' || ack === 'idempotent',
          `ack for r${revision} must apply (${ack})`
        )
      }
      const result = await h.store.pruneTerminalPublications({
        keepPerCell: 2,
        batchSize: 10,
        maxRows: 100,
        deadlineMs: 5_000,
      })
      assert(
        result.deletedRows >= 2,
        `expected at least two pruned rows, got ${result.deletedRows}`
      )
      assert(!result.truncated, 'the tiny batch must not hit the budget')
      const oldest = await h.store.findPublication(h.cellId, created[0]!)
      const newest = await h.store.findPublication(h.cellId, created[3]!)
      assert(oldest === null, 'the oldest terminal publication must be pruned')
      assert(newest !== null, 'the newest publication must survive retention')
      assert((await h.store.countCellStates()) >= 1, 'the cell state row must be counted')
    },
  },
  {
    name: 'raiseCellRevisionFloor accepts replay/higher and rejects unbounded jumps',
    async run(h) {
      const revision = await h.store.runCellTransaction(h.clusterId, (tx) => tx.allocateRevision())
      assert(
        (await h.store.raiseCellRevisionFloor(h.clusterId, revision)) === 'ok',
        'replaying the stored revision is a no-op'
      )
      assert(
        (await h.store.raiseCellRevisionFloor(h.clusterId, revision + 5)) === 'raised',
        'a bounded higher report raises the floor'
      )
      assert(
        (await h.store.raiseCellRevisionFloor(h.clusterId, revision)) === 'ok',
        'lower replays never lower the floor'
      )
      assert(
        (await h.store.raiseCellRevisionFloor(h.clusterId, revision + 1_000_000)) === 'rejected',
        'a jump beyond VRT_FENCE_RAISE_MAX_DELTA must be rejected'
      )
    },
  },
]

/** Run every case in order; the first failure surfaces with its case name. */
export async function runStoreConformance(h: StoreConformanceHarness): Promise<void> {
  for (const testCase of storeConformanceCases) {
    try {
      await testCase.run(h)
    } catch (error) {
      throw new Error(
        `store conformance case failed: ${testCase.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}
