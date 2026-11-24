/**
 * Pure domain types shared by the control-store port, the desired-state
 * builder and both store implementations (Prisma on the vibeploy side,
 * SQL on the OSS plane side).
 *
 * These are wire/row shapes only — no Prisma types, no platform policy.
 * Origin modules re-export them so existing imports keep working.
 */

/** Binding row shape shared by the control store implementations. */
export interface VrtBindingRecord {
  readonly name: string
  readonly type:
    | 'VAR'
    | 'SECRET'
    | 'KV'
    | 'R2'
    | 'PG'
    | 'SERVICE'
    | 'ASSETS'
    | 'D1'
    | 'QUEUE'
    | 'DO'
    | 'HYPERDRIVE'
    | 'RATELIMIT'
    | 'WORKER_LOADER'
    | 'UNSAFE_EVAL'
    | 'ANALYTICS_ENGINE'
    | 'FLAGSHIP'
    | 'K2'
    | 'SEND_EMAIL'
    | 'IMAGES'
    | 'VECTORIZE'
    | 'SECRETS_STORE'
  readonly resourceId: string
  readonly permissionRead: boolean
  readonly permissionWrite: boolean
  /** SERVICE only: named `WorkerEntrypoint` export; null/absent = default. */
  readonly entrypoint?: string | null
  /** SERVICE only: canonical JSON **text** for `ctx.props` (the DB column
   * stores text; the cell embeds it verbatim). Absent/null keeps the signed
   * bytes unchanged; the text must parse to a JSON object and is bounded by
   * `VRT_MAX_SERVICE_PROPS_BYTES`. */
  readonly props?: string | null
  /** QUEUE only: queue-level default delivery delay in seconds
   * (0..86400). Absent = no default; explicit `0` is a real value. */
  readonly deliveryDelaySeconds?: number | null
  /** SEND_EMAIL only: CF send-bindings restriction set (signed into the
   * desired document, enforced provider-side). `destinationAddress`
   * and `allowedDestinationAddresses` are mutually exclusive. */
  readonly destinationAddress?: string
  readonly allowedDestinationAddresses?: readonly string[]
  readonly allowedSenderAddresses?: readonly string[]
  /** VECTORIZE only: index spec signed at deploy. */
  readonly indexName?: string
  readonly dimensions?: number
  readonly metric?: 'cosine' | 'euclidean' | 'dot-product'
  /** SECRETS_STORE only: account/tenant store + secret name. */
  readonly storeId?: string
  readonly secretName?: string
}

/** P3c-1: a DO class DECLARED by the worker — the rowset member the
 * cell turns into a `durableObjectNamespaces` entry. `uniqueKey` is
 * the server-minted storage identity (32-lower-hex); `enableSql`
 * exposes `state.storage.sql` (platform DOs are always SQLite). */
export interface VrtDoClassView {
  readonly className: string
  readonly uniqueKey: string
  readonly enableSql: boolean
  /** DO1: worker the class was transferred out of — emitted as
   * `fromWorkerId` so the cell moves the source data dir in place
   * (never opens an empty one). Omitted on the wire when unset. */
  readonly transferFromWorkerId?: string | null
}

export interface VrtQueueConsumerView {
  readonly queueId: string
  readonly queueName: string
  readonly maxBatchSize: number | null
  readonly maxBatchTimeoutMs: number | null
  readonly maxRetries: number | null
  readonly retryDelaySeconds: number | null
  readonly deadLetterQueueId: string | null
  readonly maxConcurrency: number | null
}

export const VRT_MAX_QUEUE_CONSUMERS_PER_WORKER = 100

export interface VrtCronRecord {
  readonly scheduleId: string
  readonly expression: string
}

export interface VrtQuotasRecord {
  readonly cpuMs: number
  readonly memoryMb: number
  readonly subrequests: number
  readonly outboundConnections: number
}

/** CF `[observability]` — effective Worker Logs gates + head sampling
 * stored on the serving version (`null` = collection defaults). */
export interface VrtObservability {
  readonly enabled: boolean
  readonly logsEnabled: boolean
  readonly invocationLogs: boolean
  readonly headSamplingRatePpm: number
}

/** Wire shape emitted into WorkerDesired.workflows — uniqueKey included;
 * ordering is canonicalized in computeDesired. */
export interface VrtWorkflowView {
  readonly name: string
  readonly binding: string
  readonly className: string
  readonly uniqueKey: string
  readonly limitsSteps: number | null
  readonly successRetentionMs?: number | null
  readonly errorRetentionMs?: number | null
  readonly concurrencyLimit?: number | null
  /** Emitted only when the workflow is defined by another worker —
   * `WorkerDesired.serviceWorkerId` (absent ⇒ same-worker, keeps
   * pre-W7 snapshots byte-identical). */
  readonly serviceWorkerId?: string | null
}

/** One worker's contribution to the cell's desired state — the materialized
 * view of "the version that should serve traffic". */
export interface VrtCellWorkerView {
  readonly workerId: string
  readonly teamId: string
  readonly name: string
  readonly versionId: string
  readonly artifactDigest: string
  readonly compatibilityDate: string
  readonly compatibilityFlags: readonly string[]
  readonly bindings: readonly VrtBindingRecord[]
  readonly hostnames: readonly string[]
  readonly crons: readonly VrtCronRecord[]
  /** T37b: consumers declared by the serving version (rows from
   * `vrt_queue_consumers`); absent/empty ⇒ nothing dispatched. */
  readonly queueConsumers?: readonly VrtQueueConsumerView[]
  /** P3c-1: DO classes the worker DECLARES (rows from `vrt_do_classes`
   * — worker-scoped, uniqueKey stable across versions). Absent ⇒ the
   * worker owns no namespace and any `durableObject` binding pointing
   * at it resolves to nothing (fail closed at validation). */
  readonly durableObjectClasses?: readonly VrtDoClassView[]
  /** W2: workflow declarations (rows from
   * `vrt_workflow_declarations` — worker-scoped, uniqueKey stable
   * across redeploys while the name persists). Absent ⇒ the worker
   * owns no workflow engine namespace. */
  readonly workflows?: readonly VrtWorkflowView[]
  /** Tail Workers: resolved consumer workerIds; absent/empty ⇒ no tails. */
  readonly tailConsumers?: readonly string[]
  /** Streaming Tail Workers: resolved consumer workerIds. */
  readonly streamingTailConsumers?: readonly string[]
  /** CF `[version_metadata]`: env binding name for `{id, tag, timestamp}`. */
  readonly versionMetadata?: string | null
  /** CF `[observability]`: gates + sampling; absent ⇒ defaults. */
  readonly observability?: VrtObservability | null
  /** CF typed `[vars]`: non-string values emitted as `{"type":"json"}`. */
  readonly jsonVars?: Readonly<Record<string, unknown>> | null
  readonly quotas: VrtQuotasRecord
  /** T31c: Cloudflare-compatible assets routing for this version.
   * `null`/absent ⇒ legacy worker-first (no router service emitted). */
  readonly assetsRouting?: 'ASSETS_FIRST' | 'WORKER_FIRST' | null
  /** T31c: `run_worker_first` glob rules (bounded at deploy). */
  readonly assetsRunWorkerFirst?: readonly string[]
  /** Active version's creation time — the tenant's last-change key used
   * for deterministic "most recently changed first" budget eviction
   * (T11/F1). Optional only so legacy test fixtures keep compiling. */
  readonly changedAt?: Date
}

// --- store rows / mutation inputs -------------------------------------------

export interface VrtWorkflowInput {
  readonly name: string
  readonly binding: string
  readonly className: string
  readonly limitsSteps?: number
  readonly successRetentionMs?: number
  readonly errorRetentionMs?: number
  readonly concurrencyLimit?: number
  /** W7 wrangler `script_name` — a worker NAME resolved server-side
   * (never a client-supplied id). */
  readonly scriptName?: string
}

export interface VrtWorkflowRow {
  readonly workerId: string
  readonly name: string
  readonly binding: string
  readonly className: string
  readonly uniqueKey: string
  readonly limitsSteps: number | null
  readonly successRetentionMs: number | null
  readonly errorRetentionMs: number | null
  readonly concurrencyLimit: number | null
  /** Resolved defining-worker id (`script_name`); null = own worker. */
  readonly serviceWorkerId: string | null
}

export interface VrtDoClassRow {
  readonly workerId: string
  readonly className: string
  readonly uniqueKey: string
  readonly enableSql: boolean
  /** DO1: set when this row arrived via `transferred_classes` — the
   * worker whose DO-storage segment may still hold the data dir.
   * Emitted to the cell as `fromWorkerId` so it moves the dir instead
   * of opening an empty one. Permanent on the row (rolling compat:
   * old cells fail closed on the field forever). */
  readonly transferFromWorkerId?: string | null
}

export interface VrtDoMigrationInput {
  readonly tag?: string
  readonly newClasses?: readonly string[]
  readonly newSqliteClasses?: readonly string[]
  readonly renamedClasses?: readonly { readonly from: string; readonly to: string }[]
  readonly deletedClasses?: readonly string[]
  /** DO1: wrangler `transferred_classes` — `{from, from_script, to}`
   * normalized to `fromScript`. The source worker resolves server-side
   * to a same team+cluster worker (never a client-supplied id). */
  readonly transferredClasses?: readonly {
    readonly from: string
    readonly fromScript: string
    readonly to: string
  }[]
}

export interface VrtQueueConsumerDraft {
  readonly queueId: string
  readonly queueName: string
  readonly maxBatchSize: number | null
  readonly maxBatchTimeoutMs: number | null
  readonly maxRetries: number | null
  readonly retryDelaySeconds: number | null
  readonly deadLetterQueueId: string | null
  readonly maxConcurrency: number | null
}

/** Max tombstones emitted per compute.desired — must match the Rust
 * verifier bound (snapshot-protocol MAX_DELETIONS = 256). */
export const VRT_DO_TOMBSTONE_MAX = 256
/** Signed tombstones stay emittable for 24h — generous over the cell
 * poll cadence; expiry only risks retention, never wrongful deletion. */
export const VRT_DO_TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000

export type VrtWorkflowOp =
  { kind: 'upsert'; row: VrtWorkflowRow } | { kind: 'delete'; name: string }
