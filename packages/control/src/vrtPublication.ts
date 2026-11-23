/**
 * Shared "sign + record" tail of every compute.desired publication —
 * used by the request-driven adapter path (deploy/rollback/delete/
 * hostname) AND the T9 renewal job so both produce identical envelopes.
 *
 * Cell byte budget (T11/F1): the whole cell shares one
 * `SNAPSHOT_MAX_BYTES` envelope. A mutation that would overflow it must
 * not kill every tenant — on REQUEST paths the offending request is
 * rejected (413 VRT_CELL_BUDGET_EXCEEDED, whole tx rolls back including
 * the reserved revision); on system paths (renewal/republish) the most
 * recently changed tenants are evicted deterministically until the
 * envelope fits. Each tenant also has a share cap (budget/divisor) so a
 * single team cannot starve the cell — a requester over the cap is
 * rejected; on system paths the over-cap tenant is evicted.
 */
import { canonicalControlPlaneSnapshotV2 } from './canonicalSnapshot.js'
import { VrtControlError } from './errors.js'
import { noopControlLogger, type ControlLogger } from './logging.js'
import {
  buildComputeDesiredPayload,
  computeDesiredKind,
  computeDesiredScope,
  type VrtCellWorkerView,
} from './computeDesired.js'
import {
  signSnapshotProtocolEnvelope,
  SNAPSHOT_MAX_BYTES,
  type SnapshotSigningContext,
} from './snapshotSigner.js'
import { vrtPublicationNeedsRenewal } from './vrtRenewalDue.js'
import type { VrtCellTx, VrtStorePublication, VrtStorePublicationDetail } from './vrtStorePort.js'

/** Default tenant share: one team may occupy at most 1/8 of the cell
 * envelope budget. Overridable via `vrt_runtime.tenantShareDivisor`. */
export const VRT_DEFAULT_TENANT_SHARE_DIVISOR = 8

export interface CellPublicationResult {
  readonly publication: VrtStorePublication
  /** Workers excluded from the payload (poisoned state, capacity tail, or
   * tenant-level budget eviction). Callers log + count these; if the
   * request's target worker appears here the request itself must fail. */
  readonly excluded: readonly { workerId: string; reason: string }[]
  /** Tenants fully evicted by the byte budget (T11/F1) — request path
   * never evicts the requester (it 413s instead); system paths evict the
   * most recently changed first. */
  readonly evictedTenants: readonly string[]
}

/**
 * RV-R46: typed publish de-duplication. `true` only when the cell's latest
 * publication (a) was not rejected/partially applied/expired, (b) is not yet
 * due for renewal and (c) the payload rebuilt from CURRENT state at the SAME
 * revision is byte-identical to the stored one — i.e. a new revision would
 * carry exactly the same desired state. Any doubt (build error, eviction
 * differences, missing envelope) answers `false` so the caller publishes
 * normally (fail toward publishing, never toward a stale cell).
 * Callers opt in explicitly (`dedupe: 'skip-if-unchanged'`); renewal never
 * calls this — it exists to refresh `expiresAt`.
 */
export async function publicationCoversDesired(
  tx: VrtCellTx,
  previous: Pick<
    VrtStorePublicationDetail,
    'revision' | 'envelope' | 'ackStatus' | 'issuedAt' | 'expiresAt'
  >,
  now: Date
): Promise<boolean> {
  if (!['PENDING', 'ACKED', 'APPLIED'].includes(previous.ackStatus)) return false
  if (vrtPublicationNeedsRenewal(previous, now)) return false
  const stored = (previous.envelope as { payload?: unknown } | null)?.payload
  if (stored === undefined || stored === null) return false
  try {
    const view = (await tx.cellView()) as readonly VrtCellWorkerView[]
    const deletions = await tx.pendingDoTombstones(now)
    const flagshipApps = await tx.flagshipApps()
    const built = buildComputeDesiredPayload({
      cellId: tx.cellId,
      revision: previous.revision,
      workers: view,
      deletions,
      flagshipApps,
    })
    if (built.excluded.length > 0) return false
    return (
      canonicalControlPlaneSnapshotV2(built.payload) === canonicalControlPlaneSnapshotV2(stored)
    )
  } catch {
    return false
  }
}

function envelopeSizeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('size bound')
}

function tenantShareBytes(
  tenants: readonly { tenantId: string; workers: readonly unknown[] }[]
): Map<string, number> {
  const shares = new Map<string, number>()
  for (const tenant of tenants) {
    shares.set(tenant.tenantId, Buffer.byteLength(canonicalControlPlaneSnapshotV2(tenant), 'utf8'))
  }
  return shares
}

/** Deterministic eviction order for a tenant: most recent change wins
 * exclusion; ties break on the larger share, then tenantId desc. */
function tenantRecency(workers: readonly VrtCellWorkerView[], tenantId: string): number {
  return Math.max(
    0,
    ...workers
      .filter((w) => w.teamId === tenantId)
      .map((w) => (w.changedAt ? new Date(w.changedAt).getTime() : 0))
  )
}

/**
 * RV-R146: dry-run of the tenant share cap against a cell view — returns the
 * tenants whose canonical share would exceed `SNAPSHOT_MAX_BYTES / divisor`.
 * Pure (no signing, no writes): used by config writes to detect a divisor
 * change that the next publication/renewal would turn into evictions.
 */
export function tenantsOverShareCap(
  cellId: string,
  view: readonly VrtCellWorkerView[],
  tenantShareDivisor: number,
  flagshipApps: readonly { tenantId: string; appId: string; config: string }[] = []
): string[] {
  const shareCap = Math.floor(SNAPSHOT_MAX_BYTES / Math.max(2, tenantShareDivisor))
  const built = buildComputeDesiredPayload({
    cellId,
    revision: 1,
    workers: view,
    deletions: [],
    flagshipApps,
  })
  return [...tenantShareBytes(built.payload.tenants).entries()]
    .filter(([, bytes]) => bytes > shareCap)
    .map(([tenantId]) => tenantId)
    .sort()
}

export async function signAndRecordCellPublication(
  tx: VrtCellTx,
  args: {
    revision: number
    cause: string
    workerId?: string | null
    versionId?: string
    /** NULL for system publications (SYSTEM_RENEWAL) — user identity is
     * preserved for request-driven causes. */
    publishedById: string | null
    publishedBySource?: 'USER' | 'SYSTEM_RENEWAL'
    now: Date
    signing: SnapshotSigningContext
    /** Request path: the team whose mutation must land. It is NEVER
     * evicted — its overflow rejects the request (413) instead. */
    requestTeamId?: string
    tenantShareDivisor?: number
    /** Optional platform logger; defaults to a no-op. */
    logger?: ControlLogger
  }
): Promise<CellPublicationResult> {
  const log = args.logger ?? noopControlLogger
  const shareCap = Math.floor(
    SNAPSHOT_MAX_BYTES / Math.max(2, args.tenantShareDivisor ?? VRT_DEFAULT_TENANT_SHARE_DIVISOR)
  )
  const evicted = new Set<string>()
  let view = (await tx.cellView()) as readonly VrtCellWorkerView[]
  // RV-R53.1: signed DO deletion tombstones ride EVERY publication
  // until they age out — fetched once (they are constant across the
  // eviction rebuild loop, which only shrinks `view`). Expiry inside
  // the call only ever causes retention, never wrongful deletion.
  const deletions = await tx.pendingDoTombstones(args.now)
  // CF Flagship rows are constant across the eviction rebuild loop (it only
  // shrinks `view`) — fetched once so every rebuild signs the same model.
  const flagshipApps = await tx.flagshipApps()
  // Eviction rows live outside the rebuild loop so each iteration's
  // rebuild doesn't lose them (build only sees remaining workers).
  const evictedExcluded: { workerId: string; reason: string }[] = []
  const excluded: { workerId: string; reason: string }[] = []

  // Bound the rebuild loop by the tenant count — every iteration either
  // finishes or removes one tenant, so it always terminates.
  for (;;) {
    const built = buildComputeDesiredPayload({
      cellId: tx.cellId,
      revision: args.revision,
      workers: view,
      deletions,
      flagshipApps,
    })
    excluded.length = 0
    excluded.push(...evictedExcluded, ...built.excluded)
    try {
      const signed = signSnapshotProtocolEnvelope({
        kind: computeDesiredKind,
        scope: computeDesiredScope(tx.cellId),
        revision: args.revision,
        payload: built.payload,
        now: args.now,
        signing: args.signing,
      })
      const shares = tenantShareBytes(built.payload.tenants)

      // Tenant share cap — always enforced. Requester over cap → reject;
      // otherwise the over-cap tenant is evicted (recency order).
      const overCap = [...shares.entries()].filter(([, b]) => b > shareCap).map(([t]) => t)
      if (overCap.length > 0) {
        if (args.requestTeamId && overCap.includes(args.requestTeamId)) {
          throw new VrtControlError(
            413,
            `team share of the cell envelope exceeds the ${shareCap}-byte tenant cap`,
            'VRT_CELL_BUDGET_EXCEEDED'
          )
        }
        for (const t of overCap) evicted.add(t)
        for (const w of view.filter((w) => evicted.has(w.teamId))) {
          evictedExcluded.push({
            workerId: w.workerId,
            reason: 'tenant evicted: share cap exceeded',
          })
        }
        view = view.filter((w) => !evicted.has(w.teamId))
        continue
      }

      const publication = await tx.createPublication({
        cause: args.cause,
        workerId: args.workerId,
        versionId: args.versionId,
        publishedById: args.publishedById,
        publishedBySource: args.publishedBySource ?? 'USER',
        revision: args.revision,
        envelope: signed.envelope as unknown as Record<string, unknown>,
        payloadDigest: signed.payloadDigest,
        envelopeDigest: signed.envelopeDigest,
        issuedAt: new Date(signed.envelope.issuedAt),
        expiresAt: new Date(signed.envelope.expiresAt),
      })
      const evictedTenants = [...evicted].sort()
      if (evictedTenants.length > 0) {
        log.error(
          { cellId: tx.cellId, revision: args.revision, evictedTenants, shareCap },
          '[Workers] cell envelope budget evicted tenants — they are no longer served'
        )
      }
      return { publication, excluded, evictedTenants }
    } catch (error) {
      if (!envelopeSizeError(error)) throw error
      // Whole-envelope overflow. Evict the most-recently-changed tenant
      // that is NOT the requester; if only the requester is left, the
      // request itself overflowed the budget → 413.
      const candidates = [...new Set(view.map((w) => w.teamId))]
        .filter((t) => t !== args.requestTeamId)
        .sort((a, b) => {
          const ra = tenantRecency(view, a)
          const rb = tenantRecency(view, b)
          return ra !== rb ? rb - ra : a < b ? 1 : -1
        })
      const victim = candidates[0]
      if (victim === undefined) {
        throw new VrtControlError(
          413,
          'cell envelope exceeds the 512 KiB snapshot budget',
          'VRT_CELL_BUDGET_EXCEEDED'
        )
      }
      evicted.add(victim)
      for (const w of view.filter((w) => w.teamId === victim)) {
        evictedExcluded.push({
          workerId: w.workerId,
          reason: 'tenant evicted: cell envelope budget',
        })
      }
      view = view.filter((w) => w.teamId !== victim)
      log.error(
        { cellId: tx.cellId, evictedTenant: victim },
        '[Workers] cell envelope over budget — evicted most-recent tenant'
      )
    }
  }
}
