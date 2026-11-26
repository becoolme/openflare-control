/**
 * VrtControlStore — the persistence port for the VRT runtime adapter.
 *
 * Portable: implementations live on the consumer side (Prisma on the
 * vibeploy side, a SQL store on the OSS plane side). Domain shapes come
 * from ./domainTypes.js; nothing here may import Prisma or platform code.
 */
import type { VrtAckStatus, VrtAckTenantFailure } from './cellContract.js'
import type { VrtCellCapabilities } from './vrtCapabilities.js'
import type {
  VrtBindingRecord,
  VrtCellWorkerView,
  VrtDoClassRow,
  VrtDoMigrationInput,
  VrtObservability,
  VrtQueueConsumerDraft,
  VrtWorkflowInput,
  VrtWorkflowRow,
} from './domainTypes.js'

export interface VrtStoreWorker {
  readonly id: string
  readonly name: string
  readonly teamId: string
  readonly clusterId: string
  readonly runtime: string
  readonly status: string
  readonly activeVrtVersionId: string | null
  readonly entrypoint: string
  readonly compatibilityDate: string
  /** MIG-1b: typed diagnostic for cell-reported deploy failures —
   * `VRT_CELL_APPLY_FAILED:<code>:r<revision>` or null. */
  readonly statusReason: string | null
}

/** MIG-1b: typed `Worker.statusReason` marker for cell-reported deploy
 * failures. The full value is `VRT_CELL_APPLY_FAILED:<code>:r<rev>` —
 * `<code>` is the zod-validated ack failure code (`[a-z][a-z0-9-]{0,63}`)
 * and `<rev>` the publication revision the mark was written for, so a
 * late, lower-revision ack can never recover (or re-mark) past it. */
export const VRT_CELL_APPLY_FAILED_PREFIX = 'VRT_CELL_APPLY_FAILED:'
const CELL_APPLY_FAILED_RE = /^VRT_CELL_APPLY_FAILED:([a-z][a-z0-9-]{0,63}):r(\d{1,15})$/

export function cellApplyFailedReason(code: string, revision: number): string {
  return `${VRT_CELL_APPLY_FAILED_PREFIX}${code}:r${revision}`.slice(0, 160)
}

/** Parse `VRT_CELL_APPLY_FAILED:<code>:r<rev>` → the marking revision,
 * or null for any other statusReason (user/platform causes are never
 * eligible for ack-driven recovery). */
export function cellApplyFailedRevision(statusReason: string | null): number | null {
  if (!statusReason) return null
  const m = CELL_APPLY_FAILED_RE.exec(statusReason)
  return m ? Number(m[2]) : null
}

export interface VrtStoreVersion {
  readonly id: string
  readonly workerId: string
  readonly versionId: string
  readonly bundleSha256: string
  readonly bundleKey: string
  readonly bundleBytes: number
  readonly mainModule: string
  readonly modules: readonly unknown[]
  readonly compatibilityDate: string
  readonly compatibilityFlags: readonly string[]
  readonly crons: readonly { scheduleId: string; expression: string }[]
  /** Queue consumers declared by the serving version (absent on legacy rows). */
  readonly queueConsumers?: readonly VrtQueueConsumerDraft[] | null
  /** Tail Workers: resolved consumer workerIds; `null` on pre-feature rows. */
  readonly tailConsumers: readonly string[] | null
  /** Streaming Tail Workers: resolved consumer workerIds; `null` pre-feature. */
  readonly streamingTailConsumers: readonly string[] | null
  /** CF `[version_metadata]`: env binding name; `null` = none. */
  readonly versionMetadata: string | null
  /** CF `[observability]`: gates + sampling; `null` = defaults. */
  readonly observability?: VrtObservability | null
  /** CF typed `[vars]`: non-string values → `{"type":"json"}` bindings. */
  readonly jsonVars: Readonly<Record<string, unknown>> | null
  readonly quotas: {
    cpuMs: number
    memoryMb: number
    subrequests: number
    outboundConnections: number
  }
  readonly varValues: Readonly<Record<string, string>>
  readonly bindingsFingerprint: string
  /** Complete runtime-config digest — the T9 reuse key; NULL on pre-T9
   * rows which are therefore never reused. */
  readonly runtimeConfigDigest: string | null
  /** T31c: Cloudflare-compatible assets routing mode; `null` = legacy
   * worker-first (no router service). */
  readonly assetsRouting: 'ASSETS_FIRST' | 'WORKER_FIRST' | null
  /** T31c: `run_worker_first` glob rules (bounded at deploy). */
  readonly assetsRunWorkerFirst: readonly string[]
  /** W3-r2: class names the bundle exported at deploy — persisted so
   * rollback revalidates declarations against metadata, never bundle
   * bytes (T15/B2). `null` = row predates W3-r2 → the
   * VRT_ROLLBACK_EXPORTS_UNKNOWN rule applies. */
  readonly exportedClassNames: readonly string[] | null
  readonly status: 'UPLOADED' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED'
  readonly statusReason: string | null
  readonly createdAt: Date
  readonly bindings: readonly VrtBindingRecord[]
}

export type VrtStoreHostnameStatus = 'PENDING' | 'VERIFIED' | 'FAILED'
export type VrtStoreHostnameKind = 'MANAGED' | 'CUSTOM'

export interface VrtStoreHostname {
  readonly id: string
  readonly hostname: string
  /** RV-R61: only VERIFIED rows route / occupy the name. */
  readonly status: VrtStoreHostnameStatus
  readonly kind: VrtStoreHostnameKind
}

/** Max distance a cell-reported fence may outrun the control-plane
 * counter before the report is treated as anomalous (T11/F5). */
export const VRT_FENCE_RAISE_MAX_DELTA = 1000

export interface VrtStorePublication {
  readonly id: string
  readonly cellId: string
  readonly revision: number
  readonly payloadDigest: string
  readonly envelopeDigest: string
}

/** Cell-controller ACK wire statuses (`vrt_desired_publications.ackStatus`
 * values written by the T8 ack path; `PENDING`/`ACKED`/`SUPERSEDED`/
 * `EXPIRED` remain for T7 semantics). */

/** Full publication row for the cell pull/ack surfaces. `envelope` is the
 * signed document verbatim — served only to the authenticated cell. */
/** Result of one atomic ACK write attempt. */
export type VrtAckWriteResult =
  | 'written' // non-terminal → new status persisted
  | 'idempotent' // row already carried the requested status (terminal replay)
  | 'terminal' // row is terminal with a DIFFERENT status — refused
  | 'missing' // no (cellId, revision) row — defensive; callers check first

export interface VrtStorePublicationDetail extends VrtStorePublication {
  readonly clusterId: string
  readonly envelope: unknown
  readonly publishedById: string | null
  readonly publishedBySource: 'USER' | 'SYSTEM_RENEWAL'
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly workerId: string | null
  readonly versionId: string | null
  readonly cause: string
  readonly ackStatus: 'PENDING' | 'ACKED' | 'SUPERSEDED' | 'EXPIRED' | VrtAckStatus
  readonly ackedAt: Date | null
  readonly ackRevision: number | null
  readonly ackEnvelopeDigest: string | null
  readonly ackReason: string | null
  /** MIG-1: tenant-level failures from the latest ACK — `null` when the
   * reporting controller predates MIG-1 (or no failures ever applied). */
  readonly ackTenantFailures: readonly VrtAckTenantFailure[] | null
}

export interface VrtCreateVersionInput {
  readonly workerId: string
  readonly versionId: string
  readonly bundleSha256: string
  readonly bundleKey: string
  readonly bundleBytes: number
  readonly mainModule: string
  readonly modules: readonly unknown[]
  readonly compatibilityDate: string
  readonly compatibilityFlags: readonly string[]
  readonly crons: readonly { scheduleId: string; expression: string }[]
  readonly quotas: VrtStoreVersion['quotas']
  readonly varValues: Readonly<Record<string, string>>
  readonly bindingsFingerprint: string
  readonly runtimeConfigDigest: string
  readonly bindings: readonly VrtBindingRecord[]
  /** Tail Workers: resolved consumer workerIds (absent ⇒ none). */
  readonly tailConsumers?: readonly string[]
  /** Streaming Tail Workers: resolved consumer workerIds (absent ⇒ none). */
  readonly streamingTailConsumers?: readonly string[]
  /** CF `[version_metadata]`: env binding name (absent ⇒ none). */
  readonly versionMetadata?: string | null
  /** CF typed `[vars]`: non-string values → `{"type":"json"}` bindings. */
  readonly jsonVars?: Readonly<Record<string, unknown>> | null
  /** CF `[observability]`: gates + sampling (absent ⇒ defaults). */
  readonly observability?: VrtObservability | null
  /** T37b: resolved queue consumers for this version (empty when the
   * version consumes nothing — older rows simply have no consumer). */
  readonly queueConsumers?: readonly VrtQueueConsumerDraft[]
  /** T31c: Cloudflare-compatible assets routing mode — `null`/absent is
   * the legacy worker-first behavior. */
  readonly assetsRouting?: 'ASSETS_FIRST' | 'WORKER_FIRST' | null
  /** T31c: `run_worker_first` glob rules (zod-bounded at deploy). */
  readonly assetsRunWorkerFirst?: readonly string[]
  /** W3-r2: exports extracted from the in-memory bundle at deploy —
   * persisted metadata for bundle-free rollback revalidation. */
  readonly exportedClassNames?: readonly string[]
  readonly createdById: string
  /** RV-R142: per-team stored-bundle byte quota, enforced inside the
   * version-insert tx under a per-team advisory lock (409
   * TEAM_BUNDLE_QUOTA_EXCEEDED). Absent → not enforced (legacy callers). */
  readonly teamBundleQuotaBytes?: number
}

/** T21 / RV-R58: capability bits a cell self-reports in its ACK. `null`
 * (absent) means "unsupported" — gates fail closed. The key set has ONE
 * source: ./vrtCapabilities.ts. */
export type { VrtCellCapabilities }

/** RV-R53.1: one signed DO deletion tombstone (see VrtDoTombstone).
 * `workerId`/`classKey` nullable for the wider scopes. */
export interface VrtDoTombstoneView {
  readonly tenantId: string
  readonly workerId: string | null
  readonly classKey: string | null
  readonly revision: number
}

export { VRT_DO_TOMBSTONE_MAX, VRT_DO_TOMBSTONE_RETENTION_MS } from './domainTypes.js'

/** RV-R138: a cross-worker reference an activating version carries
 * (SERVICE binding / DO declaring worker / workflow defining worker). */
export interface VrtCrossWorkerTarget {
  readonly workerId: string
  /** SERVICE targets must be serving (ACTIVE version); DO/workflow
   * declaring workers only need to exist (class rowset is
   * version-independent). */
  readonly requireActive: boolean
  readonly kind: 'service' | 'durableObject' | 'workflow'
}

/** Single typed collector shared by both stores: stored binding rows +
 * workflow declaration rows -> cross-worker targets (self excluded;
 * deploy admission owns self-SERVICE rejection). Deduped. */
export function collectCrossWorkerTargets(
  selfWorkerId: string,
  bindings: readonly { type: string; resourceId: string }[],
  workflowServiceWorkerIds: readonly (string | null | undefined)[]
): VrtCrossWorkerTarget[] {
  const seen = new Map<string, VrtCrossWorkerTarget>()
  const put = (t: VrtCrossWorkerTarget): void => {
    if (t.workerId === selfWorkerId) return
    const key = `${t.kind}:${t.workerId}`
    if (!seen.has(key)) seen.set(key, t)
  }
  for (const b of bindings) {
    if (b.type === 'SERVICE') {
      put({ workerId: b.resourceId, requireActive: true, kind: 'service' })
    } else if (b.type === 'DO') {
      const sep = b.resourceId.lastIndexOf(':')
      if (sep > 0) {
        put({ workerId: b.resourceId.slice(0, sep), requireActive: false, kind: 'durableObject' })
      }
    }
  }
  for (const id of workflowServiceWorkerIds) {
    if (typeof id === 'string') put({ workerId: id, requireActive: false, kind: 'workflow' })
  }
  return [...seen.values()]
}

/** Serialized per-cell transaction surface. Implementations must guarantee
 * that everything inside the transaction either commits fully or not at all,
 * and that `allocateRevision` serializes concurrent transactions. */
/** RV-R170: the ONE definition of "other workers still depend on this
 * worker" — shared by the delete pre-check and the in-lock re-check.
 * Mirrors the activation-side `crossWorkerEdges` kinds: SERVICE binding
 * (ACTIVE versions of OTHER workers), DO binding whose declaring worker is
 * this one (resourceId `<workerId>:<class>`, ACTIVE versions of OTHER
 * workers; the DO class data would be tombstoned by the delete) and
 * workflow declarations of OTHER workers whose `script_name` resolves here.
 * Self-references never count. */
export interface VrtCrossWorkerDependents {
  readonly service: number
  readonly durableObject: number
  readonly workflow: number
}

export interface VrtCellTx {
  readonly cellId: string
  readonly clusterId: string
  /** RV-R45: take the per-cell publish mutex (row lock on the cell-state
   * row, held to commit) WITHOUT allocating a revision. Callers that must
   * read "latest publication" and decide (renewal due-check) do it AFTER
   * this call so the decision is made under the lock. Returns false when
   * the cell has never published (no row; nothing is created). */
  lockCell(): Promise<boolean>
  /** Allocate the next compute.desired revision (monotone per cell). */
  allocateRevision(): Promise<number>
  /** CF Flagship: every team's `{appId, config}` — tenant-level flag model
   * that rides the desired document so a flag edit republishes without a
   * redeploy. Empty when no app exists. */
  flagshipApps(): Promise<readonly { tenantId: string; appId: string; config: string }[]>
  /** Activate `versionId` for `workerId`: supersede the worker's other ACTIVE
   * versions and point `workers.activeVrtVersionId` at it. */
  activateVersion(workerId: string, versionId: string): Promise<void>
  /** P3c-1: apply DO class migrations to `workerId`'s rowset inside
   * the cell transaction — atomic with activation; a failed publish
   * mutates nothing (the old version keeps its exact class set). */
  applyDoClasses(
    workerId: string,
    migrations: readonly VrtDoMigrationInput[],
    actorId: string,
    /** RV-R53.1: publication revision — required for class-deletion
     * tombstones; omitted ⇒ deletions are applied but emit no
     * tombstone (test paths / non-publication contexts retain data). */
    revision?: number
  ): Promise<readonly VrtDoClassRow[]>
  /** W2: reconcile `workerId`'s workflow declaration rowset inside the
   * cell transaction — atomic with activation; a failed publish mutates
   * nothing. uniqueKey is always server-minted (never client-supplied). */
  applyWorkflowDeclarations(
    workerId: string,
    declared: readonly VrtWorkflowInput[],
    actorId: string,
    serviceWorkerIds?: ReadonlyMap<string, string | null>
  ): Promise<readonly VrtWorkflowRow[]>
  /** Delete a worker row (cascades versions/bindings/secrets/hostnames).
   * RV-R53.1: when `tombstone` is provided (explicit control-plane
   * deletion inside a publication tx), signed tombstones are minted for
   * the worker scope + every DO class BEFORE the rows are removed —
   * the ONLY authority under which a cell destroys DO data. Omitting
   * `tombstone` means "not published / never reached a cell" — cells
   * then retain any data they may hold (fail closed). */
  deleteWorker(
    workerId: string,
    survivingOpKinds?: readonly string[],
    tombstone?: { revision: number; actorId: string }
  ): Promise<void>
  /** RV-R53.1: pending signed DO deletion tombstones for this cell,
   * bounded + retention-GC'd inside the call. Emitted on EVERY
   * publication until expiry — a cell that missed the window retains
   * the data (fail safe), never deletes wrongly. */
  pendingDoTombstones(now: Date): Promise<readonly VrtDoTombstoneView[]>
  /** RV-R138: re-read, INSIDE the cell lock, every cross-worker target
   * (SERVICE / DO declaring worker / workflow defining worker) that
   * `versionId` of `workerId` carries; throws 409 `SERVICE_TARGET_GONE`
   * when any is missing/deleted/foreign/non-VRT/(SERVICE) not serving.
   * Must run BEFORE `activateVersion` so the old version is never
   * superseded on failure. */
  assertServiceTargetsInTx(workerId: string, versionId: string): Promise<void>
  /** RV-R138: serving-worker census for tenant-capacity admission:
   * `count` = this team's VRT workers with an active version on this
   * cell; `selfServing` = whether `workerId` is among them. */
  tenantServingWorkers(
    teamId: string,
    workerId: string
  ): Promise<{ count: number; selfServing: boolean }>
  /** Recount ACTIVE-version SERVICE dependents INSIDE the cell lock (F3). */
  countServiceDependents(workerId: string): Promise<number>
  /** RV-R170: all cross-worker dependents (service + DO + workflow), same
   * semantics as the store-level counter; used for the in-lock re-check. */
  countCrossWorkerDependents(workerId: string): Promise<VrtCrossWorkerDependents>
  /** RV-R170: re-read the worker row INSIDE the cell lock (null = gone). */
  readWorkerForDelete(
    workerId: string
  ): Promise<{ id: string; activeVrtVersionId: string | null } | null>
  /** MIG-5: re-read (status, statusReason, activeVrtVersionId) inside the
   * cell lock — the auto-rollback CAS must evaluate the row as it is
   * serialized under this lock, never a pre-lock snapshot. */
  readWorkerState(workerId: string): Promise<{
    status: string
    statusReason: string | null
    activeVrtVersionId: string | null
  } | null>
  /** MIG-5: clear a cell-apply FAILED mark only while (status,
   * statusReason) still match exactly — a compare-and-set so a NEWER
   * mark or a user-side write landing mid-transaction is never
   * clobbered back to ACTIVE. `false` = nothing matched (mark moved). */
  clearCellApplyMark(input: { workerId: string; expectStatusReason: string }): Promise<boolean>
  /** MIG-5: flip a NON-SERVING version row to FAILED with `statusReason`
   * — the auto-rollback path marks the failed version AFTER
   * `activateVersion` superseded it (status IN UPLOADED/FAILED/
   * SUPERSEDED only; an ACTIVE or currently-served row is untouched). */
  markVersionApplyFailed(versionId: string, statusReason: string): Promise<void>
  /** MIG-5: `activateVersion` for the system rollback — identical
   * semantics (queue-conflict advisory lock, supersede, activate) but
   * the worker-row write itself carries the CAS predicate
   * `(status='FAILED', statusReason=mark, activeVrtVersionId=failed)`:
   * a user deploy/lock or a NEWER mark committed mid-transaction makes
   * the update a no-op → returns `false` (the caller aborts the tx)
   * instead of overwriting the winner. `readWorkerState` alone cannot
   * close that gap cross-pod (READ COMMITTED staleness inside our own
   * tx). */
  activateVersionForAutoRollback(input: {
    workerId: string
    versionId: string
    expectStatusReason: string
    expectActiveVersionId: string
  }): Promise<boolean>
  /** W7: count OTHER workers' workflow declarations whose `script_name`
   * resolved to `workerId` — same team/cluster enforced at deploy, so
   * dependents are same-tenant siblings. */
  countWfDependents(workerId: string): Promise<number>
  /** Insert a hostname row. The implementation must claim the
   * `hostname:` advisory lock and check the hostname registry inside
   * this transaction (H2) — concurrent claims are serialized by the
   * lock, and whichever commits second observes the winner's row and
   * must throw HttpError 409 `VRT_HOSTNAME_TAKEN`. */
  insertHostname(input: {
    workerId: string
    teamId: string
    hostname: string
    createdById: string
    kind?: 'MANAGED' | 'CUSTOM'
    status?: VrtStoreHostnameStatus
    verifiedAt?: Date
  }): Promise<VrtStoreHostname>
  /** RV-R61: upgrade THIS worker's own non-VERIFIED row for `hostname`
   * (PENDING/FAILED custom claim) to MANAGED+VERIFIED inside the cell
   * transaction. Same lock/occupancy rules as `insertHostname`: another
   * worker's VERIFIED row -> 409 `VRT_HOSTNAME_TAKEN` (nothing mutated);
   * other workers' PENDING rows for the name are failed (they can never
   * win now). Never touches another worker's row otherwise. Returns null
   * when the worker has no such row (caller inserts instead). */
  promoteHostnameToManaged(input: {
    workerId: string
    hostname: string
    verifiedAt: Date
  }): Promise<VrtStoreHostname | null>
  deleteHostname(workerId: string, hostnameId: string): Promise<void>
  /** Latest publication for this cell INSIDE the lock — renewal
   * idempotency depends on re-reading remaining lifetime here, not on a
   * stale view from before the lock. */
  latestPublication(): Promise<VrtStorePublicationDetail | null>
  /** Raise the stored revision floor toward a cell-reported fence value.
   * Bounded by VRT_FENCE_RAISE_MAX_DELTA unless `proven` (a verified fence
   * attestation, issue #63) — T11/F5. */
  raiseRevisionFloor(
    reported: number,
    opts?: { proven?: boolean }
  ): Promise<'raised' | 'ok' | 'rejected'>
  /** T21: persist the latest ACK-reported capability bits (last write
   * wins — capabilities only ever change with a cell binary rollout). */
  setCapabilities(caps: VrtCellCapabilities): Promise<void>
  /** Mark one D1 op terminal inside the cell transaction. Returns the op
   * identity only when this call transitioned PENDING -> terminal (a replay
   * returns null). Used by the PROMOTE side-effect path. */
  ackD1Op(input: {
    seq: number
    status: string
    result: unknown
    error: string | null
  }): Promise<{ databaseId: string; kind: string; payload: unknown } | null>
  /** Monotonic writer update for a D1 database. Returns false for an older or
   * equal epoch, so a late ACK can never roll a newer promotion back. */
  applyD1Writer(input: {
    databaseId: string
    epoch: number
    writerAddr?: string | null
    lsn?: number | null
  }): Promise<boolean>
  /** The desired-state view of the cell AFTER in-transaction mutations:
   * every VRT worker on the cell whose activeVrtVersionId is set. */
  cellView(): Promise<readonly VrtCellWorkerView[]>
  createPublication(input: {
    cause: string
    workerId?: string | null
    versionId?: string
    publishedById: string | null
    publishedBySource?: 'USER' | 'SYSTEM_RENEWAL'
    revision: number
    envelope: Record<string, unknown>
    payloadDigest: string
    envelopeDigest: string
    issuedAt: Date
    expiresAt: Date
  }): Promise<VrtStorePublication>
}

export interface VrtControlStore {
  getWorker(workerId: string, teamId: string): Promise<VrtStoreWorker | null>
  /** Unscoped-by-requester lookup used ONLY for server-side ownership checks
   * (service-binding target, hostname uniqueness) — never to grant access. */
  findWorkerById(workerId: string): Promise<VrtStoreWorker | null>
  findWorkerByName(teamId: string, clusterId: string, name: string): Promise<VrtStoreWorker | null>
  /** PG binding ownership check — returns the database's teamId (or null). */
  findDatabaseTeamId(databaseId: string): Promise<string | null>
  /** T35: D1 binding ownership check — returns the VrtD1Database's
   * (teamId, clusterId) or null. Both must match the worker's: a database
   * is team-owned AND cell-scoped (data plane lives on one cluster). */
  findVrtD1DatabaseScope(databaseId: string): Promise<{ teamId: string; clusterId: string } | null>
  /** T37: queue ownership probe — same no-oracle discipline. */
  findVrtQueueScope(queueId: string): Promise<{ teamId: string; clusterId: string } | null>
  /** CF K2: stream ownership probe — returns the stream's
   * (teamId, clusterId) or null (same no-oracle discipline as D1/queue). */
  findVrtK2Scope(streamId: string): Promise<{ teamId: string; clusterId: string } | null>
  /** P3c-1: DO class rows declared by `workerId` (deploy-time
   * pre-check; the authoritative mutation runs inside the cell tx). */
  listDoClasses(workerId: string): Promise<readonly VrtDoClassRow[]>
  /** W2: workflow declarations of `workerId` (deploy-time pre-check and
   * the management read API; authoritative mutation runs in the cell tx). */
  listWorkflowDeclarations(workerId: string): Promise<readonly VrtWorkflowRow[]>
  /** RV-R58: number of queue consumers persisted on a version (rollback
   * capability gate — consumers need a cell reporting `queue`). */
  countVersionQueueConsumers(versionId: string): Promise<number>
  getVersionByVersionId(workerId: string, versionId: string): Promise<VrtStoreVersion | null>
  findVersionByContent(
    workerId: string,
    bundleSha256: string,
    bindingsFingerprint: string
  ): Promise<VrtStoreVersion | null>
  /** RV-R142: `limit` bounds the list (newest first); `alwaysIncludeVersionId`
   * (the serving version) is appended when the window misses it. */
  listVersions(
    workerId: string,
    opts?: { limit?: number; alwaysIncludeVersionId?: string | null }
  ): Promise<readonly VrtStoreVersion[]>
  listVars(workerId: string): Promise<readonly { key: string; value: string }[]>
  /** Secret names only — values never leave the encrypted store. */
  listSecretKeys(workerId: string): Promise<readonly string[]>
  listHostnames(workerId: string): Promise<readonly VrtStoreHostname[]>
  /** True when `hostname` is already claimed by a VRT hostname row. */
  isHostnameTaken(hostname: string, opts?: { excludeWorkerId?: string }): Promise<boolean>
  /** W3-r2: heal a legacy row whose `exportedClassNames` is NULL by
   * writing the exports extracted from its (already in-memory) bundle
   * during a same-config redeploy. No-op when the row changed. */
  setVersionExportedClassNames(
    versionId: string,
    exportedClassNames: readonly string[]
  ): Promise<void>
  createVersionWithBindings(input: VrtCreateVersionInput): Promise<{
    version: VrtStoreVersion
    created: boolean
  }>
  /** GC1: upsert the global bundle-object registry row and refresh
   * `lastReferencedAt`. Deploy MUST call this BEFORE `bundleStore.put`
   * and before the version-row insert: the row is also the advisory
   * lock that serializes deploy vs a concurrent bundle-GC delete for
   * this digest (GC takes FOR UPDATE on it). */
  registerBundleObject(input: {
    digest: string
    bytes: number
    createdById?: string | null
  }): Promise<void>
  markVersionFailed(versionId: string, reason: string): Promise<void>
  /** MIG-1b: mark the deploy status of the named workers FAILED —
   * each entry already passed the server's changed-set∩ack-candidate
   * check (`recordDesiredAck`); this write re-verifies `teamId ==
   * tenant` in the WHERE clause (a cell can never fail a foreign
   * team's worker) and never clobbers DEPLOYING/DELETED rows.
   * Writes `statusReason = VRT_CELL_APPLY_FAILED:<code>:r<rev>` and a
   * `worker.deploy.cell_failed` op-log per marked row; also attempts
   * `markVersionFailed` on the published version (the CAS inside
   * keeps an actively-served version ACTIVE). */
  markWorkersDeployFailed(input: {
    tenant: string
    workers: readonly { workerId: string; versionId: string }[]
    code: string
    revision: number
  }): Promise<readonly string[]>
  /** MIG-1b: recover workers whose FAILED status was ONLY written by a
   * cell apply mark — `statusReason` parses to a mark revision `<=
   * ackRevision` — when the newer ack no longer names them. Single
   * conditional updateMany per worker (status + exact statusReason in
   * the WHERE) so a concurrent re-mark or user-side failure is never
   * overwritten; `worker.deploy.cell_recovered` op-log per row. */
  /** MIG-1b/MIG-7: lift `VRT_CELL_APPLY_FAILED:` marks the ack no
   * longer names. Marks with `markRev <= ackRevision` are eligible;
   * `markRevision` (MIG-7, PARTIAL-scope recovery) narrows that to an
   * EXACT match — a same-revision PARTIAL may only undo marks its own
   * revision wrote, never an older revision's. */
  recoverCellDeployFailures(input: {
    clusterId: string
    ackRevision: number
    excludeWorkerIds: ReadonlySet<string>
    excludeTeamIds: ReadonlySet<string>
    markRevision?: number
  }): Promise<readonly string[]>
  /** MIG-5: audit entry for one automatic-rollback decision — the
   * idempotency key is (workerId, failedVersionId, markRevision) and
   * the actor is the system (createdById null), never a user. Outcome:
   * `rolled-back` a new revision was published on the fallback;
   * `declined` no safe fallback exists (stays FAILED); `superseded` a
   * newer user-side operation won the CAS (untouched).
   * MIG-6: `reason` is the TYPED decision reason (whitelist slug —
   * `no-applied-baseline`, `baseline-failed`, `rollback-target-failed`,
   * `admission-declined`, `publish-declined`, ...); `detailCode` is the
   * bounded typed error code for the declined-by-check variants. */
  recordAutoRollback(input: {
    workerId: string
    outcome: 'rolled-back' | 'declined' | 'superseded'
    /** MIG-6 typed decision reason — never a concatenated message. */
    reason: string
    /** Typed detail for revalidation/publish declines (error code). */
    detailCode?: string | null
    failedVersionId: string
    rollbackVersionId: string | null
    code: string
    markRevision: number
    publicationRevision?: number
    detail?: string | null
  }): Promise<void>
  /** MIG-6: was this worker's `VRT_CELL_APPLY_FAILED:` mark cleared by
   * the ack that landed at `ackRevision`? The `worker.deploy.cell_recovered`
   * op-log entry is the server-side proof the baseline revision's own
   * verdict saw the worker serving — used by the rollback baseline
   * provenance check so stale diagnostics on an old row cannot poison
   * a fallback the cell actually proved. */
  workerCellApplyRecoveredAtRevision(workerId: string, ackRevision: number): Promise<boolean>
  /** MIG-6: the most recent `worker.auto_rollback` decision for the
   * describe diagnostics surface — whitelisted fields only (never the
   * raw detail text). */
  latestAutoRollbackDecision(workerId: string): Promise<{
    outcome: 'rolled-back' | 'declined' | 'superseded'
    reason: string | null
    detailCode: string | null
    failedVersionId: string | null
    rollbackVersionId: string | null
    code: string | null
    markRevision: number | null
    publicationRevision: number | null
    decidedAt: Date | null
  } | null>
  /** Latest APPLIED publication strictly below `belowRevision` — the
   * "last known-good cell state" the MIG-1b changed set diffs against.
   * `null` ⇒ no applied baseline: caller must not mark any worker. */
  latestAppliedPublicationBelow(
    cellId: string,
    belowRevision: number
  ): Promise<VrtStorePublicationDetail | null>
  /** Latest publication for `cellId` (by revision), or null when the cell
   * has never been published to. Used by the cell desired-pull route. */
  latestPublication(cellId: string): Promise<VrtStorePublicationDetail | null>
  /** T15/B2: newest `limit` publications for `cellId` (any ack state —
   * active, pending, superseded). Used by the cell bundle route to
   * derive the set of artifact digests this cell may fetch; envelopes
   * are trusted server-side content, never client input. */
  recentPublications(cellId: string, limit: number): Promise<readonly VrtStorePublicationDetail[]>
  /** One publication row bound by `(cellId, revision)`. */
  findPublication(cellId: string, revision: number): Promise<VrtStorePublicationDetail | null>
  /** Write the cell-controller ACK onto the `(cellId, revision)` row.
   * Callers are responsible for the digest/revision checks — this only
   * persists the verdict. State machine is enforced atomically:
   * PENDING/PARTIAL are the only writable predecessors; APPLIED and
   * REJECTED are terminal. Same-status rewrite → `idempotent`,
   * cross-status terminal rewrite → `terminal` (callers map to 409). */
  recordPublicationAck(
    cellId: string,
    revision: number,
    ack: {
      status: VrtAckStatus
      ackedAt: Date
      envelopeDigest: string
      reason?: string | null
      /** MIG-1: tenant-level diagnostics for this verdict — `undefined`
       * (field absent on the wire) leaves the stored set alone, so a
       * pre-MIG-1 controller never clobbers a newer report. */
      tenantFailures?: readonly VrtAckTenantFailure[]
    }
  ): Promise<VrtAckWriteResult>
  /** Count ACTIVE-version SERVICE bindings across the cell that target
   * `workerId` — deletion of a still-referenced worker is a 409
   * (T9/M5). Count only; dependents' identities stay server-side. */
  countServiceDependents(workerId: string): Promise<number>
  /** RV-R170: typed all-kinds dependent counter (see VrtCrossWorkerDependents). */
  countCrossWorkerDependents(workerId: string): Promise<VrtCrossWorkerDependents>
  /** W7: count OTHER workers' workflow declarations defining via
   * `serviceWorkerId` = `workerId` — deletion 409, same shape as
   * countServiceDependents. */
  countWfDependents(workerId: string): Promise<number>
  /** First-claim ownership of an ASSETS manifest digest (T9/M8): returns
   * the owning teamId — the caller compares it to the worker's team. The
   * unique PK is the cross-team race arbiter. */
  /** Claim (teamId, digest), record the manifest's object references
   *  AND register/touch the object rows — all in one transaction.
   *  T23/H3: the claim (refs) commits BEFORE the object bytes upload,
   *  so GC can never delete a just-claimed object.
   *  T23/H4: when `quotaBytes` is set, the quota check runs INSIDE the
   *  transaction under a per-team advisory lock — concurrent uploads
   *  serialize on the lock and cannot jointly overshoot. */
  claimAssetsManifest(input: {
    digest: string
    teamId: string
    workerId: string
    createdById?: string
    /** digest+bytes of every object the manifest lists. */
    objects?: readonly { digest: string; bytes: number }[]
    /** the manifest's own totalBytes (persisted for SQL quota sums). */
    totalBytes?: number
    /** per-team quota in bytes; undefined = unlimited. */
    quotaBytes?: number
    /** conservative per-manifest fallback for legacy NULL totalBytes. */
    legacyManifestBytes?: number
  }): Promise<void>
  /** T21: does a (teamId, digest) manifest claim exist — deploy-time
   * existence/ownership check (rollback revalidates the same). A
   * digest claimed by several teams independently must not resolve to
   * "the first claimant" — ownership is a per-team predicate. */
  isAssetsManifestClaimed(digest: string, teamId: string): Promise<boolean>
  /** Latest publication that activated `versionId` on `cellId` — the
   * describe-time "is this version actually effective" read.
   * MIG-5: `cause` tells the auto-rollback bound whether the version
   * was activated by a previous automatic rollback (max one step). */
  latestPublicationForVersion(
    cellId: string,
    versionId: string
  ): Promise<{
    revision: number
    ackStatus: string
    ackedAt: Date | null
    ackReason: string | null
    cause: string
    /** MIG-1: tenant-level failures on the publication's latest ack. */
    ackTenantFailures: readonly VrtAckTenantFailure[] | null
  } | null>
  runCellTransaction<T>(clusterId: string, fn: (tx: VrtCellTx) => Promise<T>): Promise<T>
  /** Raise the stored revision floor toward a cell-reported fence value,
   * bounded (T11/F5) — called from the ACK path. */
  raiseCellRevisionFloor(
    clusterId: string,
    reported: number,
    opts?: { proven?: boolean }
  ): Promise<'raised' | 'ok' | 'rejected'>
  /** T21: latest ACK-reported capability bits, or null when the cell has
   * never declared any (pre-T21 cells → every capability is unsupported). */
  cellCapabilities(clusterId: string): Promise<VrtCellCapabilities | null>
  /** T21: persist capabilities inside the cell lock (ACK path). */
  recordCellCapabilities(clusterId: string, caps: VrtCellCapabilities): Promise<void>
  /** T11/F2 retention: delete terminal-acked publications beyond the newest
   * `keepPerCell` revisions per cell, in bounded batches under a deadline.
   * Non-terminal (PENDING/PARTIAL) rows are never deleted — the cell may
   * still resolve them. */
  pruneTerminalPublications(opts: {
    keepPerCell: number
    batchSize: number
    maxRows: number
    deadlineMs: number
  }): Promise<{ deletedRows: number; truncated: boolean }>
  /** Number of cell-state rows (diagnostics / retention scan size). */
  countCellStates(): Promise<number>
}
