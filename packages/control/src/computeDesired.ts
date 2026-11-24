/**
 * compute.desired payload builder — produces the exact payload shape
 * consumed by `snapshot-protocol`'s `compute_desired.rs`:
 *
 *   {schemaVersion, cellId, revision, tenants: [{tenantId, workers: [
 *     {workerId, name, activeVersion: {versionId, artifactDigest,
 *      compatibilityDate, compatibilityFlags}, bindings, routes, crons,
 *      quotas}]}]}
 *
 * Invariants honored here (all fail-closed, mirroring the Rust validator):
 *  - complete replacement set for the cell — never a partial patch;
 *  - every binding name is a valid JS identifier and unique per worker;
 *  - service bindings only target workers of the SAME tenant;
 *  - hostnames are globally unique across the whole payload;
 *  - var/secret bindings carry references only — never values;
 *  - deterministic ordering (tenants/workers/bindings/routes sorted) so the
 *    canonical payload digest is stable for identical desired state.
 */
import { createHash } from 'node:crypto'
import {
  hyperdriveBindingId,
  hyperdriveCredentialRef,
  parseHyperdriveResourceId,
} from './hyperdriveCodec.js'
import { WORKER_DO_CLASS_NAME_MAX_LEN } from './bindingName.js'
import { isTenantAllowedCompatFlag } from './compatFlags.js'
import { findCompatFlagConflict } from './compatFlagConflicts.js'
import {
  isLowerHex,
  validVrtBindingName,
  validVrtBucketName,
  validVrtCompatDate,
  validVrtCompatFlag,
  validVrtCronExpression,
  validVrtHostname,
  validVrtIdentifier,
  validVrtServiceEntrypoint,
  validVrtWorkerName,
  VRT_MAX_BINDINGS_PER_WORKER,
  VRT_MAX_COMPAT_FLAGS,
  VRT_MAX_CRONS_PER_WORKER,
  VRT_MAX_IDENTIFIER_LEN,
  VRT_MAX_JSON_BINDING_BYTES,
  VRT_MAX_OUTBOUND_CONNECTIONS,
  VRT_MAX_REF_LEN,
  VRT_MAX_ROUTES_PER_WORKER,
  VRT_MAX_CPU_MS,
  VRT_MAX_MEMORY_MB,
  VRT_DEFAULT_CELL_MEMORY_BUDGET_MB,
  VRT_MAX_CELL_MEMORY_BUDGET_MB,
  VRT_TENANT_MAX_COMMIT_MB,
  VRT_MAX_SUBREQUESTS,
  VRT_MAX_TENANTS,
  VRT_MAX_WORKERS_PER_TENANT,
  VRT_MIN_CPU_MS,
  VRT_MIN_MEMORY_MB,
} from './vrtValidation.js'

export const COMPUTE_DESIRED_SCHEMA_VERSION = 1
export const computeDesiredKind = 'compute.desired' as const
export const computeDesiredScope = (cellId: string) => `cell:${cellId}`

/** Cloudflare `services[].props` bound (Rust `MAX_SERVICE_PROPS_BYTES`) —
 * same 16 KiB cap as a `{"type":"json"}` literal binding. */
export const VRT_MAX_SERVICE_PROPS_BYTES = 16 * 1024
/** Cloudflare queue-level `delivery_delay` bound (Rust
 * `MAX_QUEUE_DELIVERY_DELAY_SECS`). */
export const VRT_MAX_QUEUE_DELIVERY_DELAY_SECONDS = 86_400

import {
  MAX_WORKFLOWS_PER_WORKER,
  MAX_WORKFLOW_STEPS,
  WORKFLOW_IDENT_RE,
  WORKFLOW_NAME_RE,
} from './workflowConstants.js'
import {
  VRT_DO_TOMBSTONE_MAX,
  VRT_MAX_QUEUE_CONSUMERS_PER_WORKER,
  type VrtBindingRecord,
  type VrtCellWorkerView,
  type VrtCronRecord,
  type VrtDoClassView,
  type VrtQueueConsumerView,
  type VrtQuotasRecord,
  type VrtWorkflowView,
} from './domainTypes.js'
import { flagshipConfigIsValid } from './flagshipConfig.js'

export type {
  VrtBindingRecord,
  VrtCellWorkerView,
  VrtCronRecord,
  VrtDoClassView,
  VrtQueueConsumerView,
  VrtQuotasRecord,
  VrtWorkflowView,
}
export { VRT_MAX_QUEUE_CONSUMERS_PER_WORKER }

export interface ComputeDesiredPayload {
  readonly schemaVersion: 1
  readonly cellId: string
  readonly revision: number
  readonly tenants: readonly TenantDesired[]
  /** RV-R53.1: signed deletion tombstones — the ONLY authority under
   * which a cell may destroy durable DO data. Emitted ONLY for
   * explicit control-plane deletions; exclusion/eviction/poisoning
   * NEVER produce entries. Omitted when empty: an absent field
   * deserializes to "no deletions" on new cells and keeps
   * tombstone-free snapshots byte-identical for old cells (their
   * `deny_unknown_fields` verifier fails closed — destruction simply
   * waits for the cell binary upgrade). */
  readonly deletions?: readonly DeletionDesired[]
}

/** RV-R53.1: one signed deletion tombstone (mirrors
 * snapshot-protocol `DeletionDesired`). `classKey` requires
 * `workerId`; both absent ⇒ tenant-scoped. */
export interface DeletionDesired {
  readonly tenantId: string
  readonly workerId?: string
  readonly classKey?: string
  readonly revision: number
}

export interface ComputeDesiredBuild {
  readonly payload: ComputeDesiredPayload
  /** Workers excluded from this payload because their persisted state is
   * invalid (T9/M5 — one poisoned row must not block every tenant on the
   * cell). Each entry is `{workerId, reason}` — a bounded diagnostic for
   * logs/counters, deliberately NOT part of the signed document (the
   * Rust verifier strict-parses the payload; extra members must never
   * leak into it). */
  readonly excluded: readonly { workerId: string; reason: string }[]
}

export interface TenantDesired {
  readonly tenantId: string
  readonly workers: readonly WorkerDesired[]
  /** CF Flagship — serialized `{appId, config}` per app, sorted by appId.
   * Tenant-level: flag edits republish without a redeploy. Omitted when
   * empty so old cells (deny_unknown_fields) keep accepting non-flagship
   * snapshots. */
  readonly flagshipApps?: readonly { readonly appId: string; readonly config: string }[]
}

export interface WorkerDesired {
  readonly workerId: string
  readonly name: string
  readonly activeVersion: {
    readonly versionId: string
    readonly artifactDigest: string
    readonly compatibilityDate: string
    readonly compatibilityFlags: readonly string[]
  }
  readonly bindings: readonly Record<string, unknown>[]
  readonly routes: readonly { readonly hostname: string }[]
  readonly crons: readonly VrtCronRecord[]
  readonly quotas: VrtQuotasRecord
  /** T37b: queue consumers (wire unit for timeouts is whole seconds —
   * see QueueConsumerDesired in snapshot-protocol). Empty for workers
   * that consume nothing. */
  readonly queueConsumers: readonly Record<string, unknown>[]
  /** Tail Workers: `[{workerId}]` — omitted when empty so old cells
   * (deny_unknown_fields) keep accepting non-tail snapshots. */
  readonly tailConsumers?: readonly Record<string, unknown>[]
  readonly streamingTailConsumers?: readonly Record<string, unknown>[]
  /** CF `[observability]` — `{enabled, logsEnabled, invocationLogs,
   * headSamplingRatePpm}`; omitted when absent so old cells keep
   * accepting pre-observability snapshots. */
  readonly observability?: Record<string, unknown>
  /** P3c-1: declared DO classes → `durableObjectNamespaces` +
   * `durableObjectStorage.localDisk` in capnp. Optional: omitted
   * entirely when empty so old cells (deny_unknown_fields) keep
   * accepting non-DO snapshots. */
  readonly durableObjectClasses?: readonly Record<string, unknown>[]
  /** W2: declared workflows → engine-DO binding + durableObject
   * namespace in capnp. Optional: omitted when empty so old cells
   * (deny_unknown_fields) keep accepting non-workflow snapshots —
   * same wire-compat rule as durableObjectClasses. */
  readonly workflows?: readonly Record<string, unknown>[]
  /** Active version's creation time — the tenant's last-change key used
   * for deterministic "most recently changed first" budget eviction
   * (T11/F1). Optional only so legacy test fixtures keep compiling. */
  readonly changedAt?: Date
}

function invalid(detail: string): Error {
  // Publishing-time validation failures are a control-plane bug or corrupted
  // state — a generic Error surfaces as a logged 500, never a silent pass.
  return new Error(`compute.desired payload invalid: ${detail}`)
}

/** Exported for unit tests (binding → snapshot wire record). */
export function serializeBinding(
  binding: VrtBindingRecord,
  selfWorkerId: string,
  assetsRouting: 'ASSETS_FIRST' | 'WORKER_FIRST' | null,
  assetsRunWorkerFirst: readonly string[]
): Record<string, unknown> {
  const { name, type, resourceId } = binding
  switch (type) {
    case 'VAR':
      if (!validVrtIdentifier(resourceId, VRT_MAX_REF_LEN)) throw invalid('bindings.varRef')
      return { type: 'var', name, varRef: resourceId }
    case 'SECRET':
      if (!validVrtIdentifier(resourceId, VRT_MAX_REF_LEN)) throw invalid('bindings.secretRef')
      return { type: 'secret', name, secretRef: resourceId }
    case 'KV':
      if (!validVrtIdentifier(resourceId)) throw invalid('bindings.namespaceId')
      return {
        type: 'kv',
        name,
        namespaceId: resourceId,
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    case 'R2':
      if (!validVrtBucketName(resourceId)) throw invalid('bindings.bucket')
      return {
        type: 'r2',
        name,
        bucket: resourceId,
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    case 'D1':
      // Snapshot-side validation mirrors the Rust validator
      // (compute_desired.rs: /^[a-z0-9]{26}$/) — storage identity is
      // server-minted and never client-shaped.
      if (!/^[a-z0-9]{26}$/.test(resourceId)) throw invalid('bindings.databaseId')
      if (
        binding.epoch !== undefined &&
        (!Number.isSafeInteger(binding.epoch) || binding.epoch < 1)
      ) {
        throw invalid('bindings.epoch')
      }
      let writerAddr: string | undefined
      if (binding.writerAddr !== undefined) {
        if (
          typeof binding.writerAddr !== 'string' ||
          binding.writerAddr.length === 0 ||
          binding.writerAddr.length > 256 ||
          binding.writerAddr.endsWith('/') ||
          /\s/.test(binding.writerAddr) ||
          !/^https?:\/\//.test(binding.writerAddr)
        ) {
          throw invalid('bindings.writerAddr')
        }
        writerAddr = binding.writerAddr
      }
      return {
        type: 'd1',
        name,
        databaseId: resourceId,
        epoch: binding.epoch ?? 1,
        ...(writerAddr !== undefined ? { writerAddr } : {}),
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    case 'QUEUE':
      // T37: queueId is server-minted — same 26-char namespace as
      // databaseId (compute_desired.rs validates identically).
      // `queueName` is producer-side display metadata (routing is always
      // by queueId) and Rust validates it as an IDENTIFIER
      // `[A-Za-z0-9_.:-]`. RV-R69 #2: the binding env name may contain
      // `$`, so it must never flow into this field — emit the
      // server-minted queueId (always a valid identifier).
      if (!/^[a-z0-9]{26}$/.test(resourceId)) throw invalid('bindings.queueId')
      {
        const out: Record<string, unknown> = {
          type: 'queue',
          name,
          queueId: resourceId,
          queueName: resourceId,
          permissions: { read: binding.permissionRead, write: binding.permissionWrite },
        }
        if (binding.deliveryDelaySeconds != null) {
          if (
            !Number.isInteger(binding.deliveryDelaySeconds) ||
            binding.deliveryDelaySeconds < 0 ||
            binding.deliveryDelaySeconds > VRT_MAX_QUEUE_DELIVERY_DELAY_SECONDS
          ) {
            throw invalid('bindings.deliveryDelaySeconds')
          }
          // 0 is a real value (explicit "no queue default"), so emit it.
          out.deliveryDelaySeconds = binding.deliveryDelaySeconds
        }
        return out
      }
    case 'PG': {
      // P1: `vrtpg:<databaseTenantId>` — slug/endpoint/token arrive via
      // render-inputs under `credentialRef`; desired carries references
      // only. New `credentialRef` field makes OLD cells fail closed
      // (deny_unknown_fields in snapshot-protocol).
      const tenantId = resourceId.startsWith('vrtpg:') ? resourceId.slice(6) : ''
      if (!validVrtIdentifier(tenantId)) throw invalid('bindings.databaseId')
      return {
        type: 'pg',
        name,
        databaseId: resourceId,
        credentialRef: `vrtpgcred:${tenantId}`,
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    }
    case 'HYPERDRIVE': {
      // MIG-15: `vrthd:<databaseTenantId>` — credentials (incl. the TCP
      // login role) arrive via render-inputs under `credentialRef`;
      // desired carries references only. `syntheticHost` is the
      // platform-minted unresolvable name the worker-visible
      // connectionString points at — the egress layer resolves it to
      // the internal TCP target provider, so tenants can never supply
      // or select another binding's identity.
      const ref = parseHyperdriveResourceId(resourceId)
      if (!ref || !validVrtIdentifier(ref.targetId)) throw invalid('bindings.databaseId')
      const bindingId = hyperdriveBindingId(ref.kind, ref.targetId, name)
      const syntheticHost = `hd${createHash('sha256').update(bindingId).digest('hex').slice(0, 24)}.hyperdrive.vrt.internal`
      return {
        type: 'hyperdrive',
        name,
        bindingId,
        syntheticHost,
        credentialRef: hyperdriveCredentialRef(ref.kind, ref.targetId),
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    }
    case 'RATELIMIT': {
      // MIG-16: resourceId = `<namespaceId>:<limit>:<period>` (minted by
      // the adapter from validated input) — re-parsed fail closed; the
      // Rust side re-validates the same ranges.
      const m = /^([0-9]{1,32}):([1-9][0-9]{0,6}):(10|60)$/.exec(resourceId)
      if (!m) throw invalid('bindings.ratelimit')
      const limit = Number(m[2])
      if (limit > 1_000_000) throw invalid('bindings.limit')
      return { type: 'ratelimit', name, namespaceId: m[1], limit, period: Number(m[3]) }
    }
    case 'WORKER_LOADER': {
      // Pure capability — the only identity is the binding name.
      // `resourceId` is the constant sentinel minted by the adapter;
      // anything else means a corrupted or hand-built record.
      if (resourceId !== 'loader') throw invalid('bindings.workerLoader')
      return { type: 'workerLoader', name }
    }
    case 'UNSAFE_EVAL': {
      // Pure capability like WORKER_LOADER — constant sentinel.
      if (resourceId !== 'unsafe-eval') throw invalid('bindings.unsafeEval')
      return { type: 'unsafeEval', name }
    }
    case 'ANALYTICS_ENGINE': {
      // `resourceId` IS the dataset name minted by the adapter —
      // charset-bound because it renders as a workerd service name, an
      // `--external-addr` token and a filesystem path segment.
      if (!/^[A-Za-z0-9_]{1,256}$/.test(resourceId)) throw invalid('bindings.dataset')
      return { type: 'analyticsEngine', name, dataset: resourceId }
    }
    case 'FLAGSHIP': {
      // `resourceId` IS the appId — resolved against
      // `tenants[].flagshipApps` in build() (same-tenant rule);
      // charset-bound because it renders into an innerBinding name.
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(resourceId)) throw invalid('bindings.flagshipApp')
      return { type: 'flagship', name, appId: resourceId }
    }
    case 'K2': {
      // K2: streamId is server-minted 32-hex — the same whitelist the
      // Rust `K2Binding::validate` enforces. Routing is always by
      // streamId; the display name never leaves the control plane.
      if (!/^[0-9a-f]{32}$/.test(resourceId)) throw invalid('bindings.streamId')
      return {
        type: 'k2',
        name,
        streamId: resourceId,
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    }
    case 'SEND_EMAIL': {
      // CF send binding — resourceId is the binding NAME itself; the
      // restriction set is signed into desired state and enforced
      // provider-side.
      const dest = binding.destinationAddress
      const allowedDest = binding.allowedDestinationAddresses ?? []
      if (dest !== undefined && allowedDest.length > 0) {
        throw invalid('bindings.destinationAddress')
      }
      return {
        type: 'sendEmail',
        name,
        ...(dest !== undefined ? { destinationAddress: dest } : {}),
        ...(allowedDest.length ? { allowedDestinationAddresses: [...allowedDest] } : {}),
        ...(binding.allowedSenderAddresses?.length
          ? { allowedSenderAddresses: [...binding.allowedSenderAddresses] }
          : {}),
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    }
    case 'VECTORIZE': {
      if (!/^[0-9a-z]{26}$/.test(resourceId)) throw invalid('bindings.vectorize.indexId')
      if (
        binding.indexName == null ||
        binding.indexName.length > 64 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(binding.indexName)
      ) {
        throw invalid('bindings.vectorize.indexName')
      }
      const dims = binding.dimensions
      if (dims == null || !Number.isInteger(dims) || dims < 1 || dims > 1536) {
        throw invalid('bindings.vectorize.dimensions')
      }
      const metric = binding.metric
      if (metric !== 'cosine' && metric !== 'euclidean' && metric !== 'dot-product') {
        throw invalid('bindings.vectorize.metric')
      }
      return {
        type: 'vectorize',
        name,
        indexId: resourceId,
        indexName: binding.indexName,
        dimensions: dims,
        metric,
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
    }
    case 'SECRETS_STORE': {
      const storeId = binding.storeId
      const secretName = binding.secretName
      if (!storeId || !validVrtIdentifier(storeId)) throw invalid('bindings.storeId')
      if (!secretName || !validVrtIdentifier(secretName)) throw invalid('bindings.secretName')
      const secretRef = `secrets-store:${storeId}:${secretName}`
      if (!validVrtIdentifier(secretRef, VRT_MAX_REF_LEN)) throw invalid('bindings.secretRef')
      return { type: 'secretsStore', name, storeId, secretName, secretRef }
    }
    case 'IMAGES':
      // CF Images: pure capability — the transform engine lives in the
      // facade-images system worker, so the wire carries name only.
      return { type: 'images', name }
    case 'SERVICE': {
      // Target membership in the same tenant is checked in build() where the
      // tenant worker set is known. Optional fields are emitted only when set,
      // so default-export bindings keep their exact signed bytes.
      const out: Record<string, unknown> = { type: 'service', name, workerId: resourceId }
      if (binding.entrypoint != null) {
        if (!validVrtServiceEntrypoint(binding.entrypoint)) throw invalid('bindings.entrypoint')
        out.entrypoint = binding.entrypoint
      }
      if (binding.props != null) {
        // Canonical JSON text — re-validated at this trust boundary so a
        // corrupted row can never sign a non-object `ctx.props`.
        if (Buffer.byteLength(binding.props) > VRT_MAX_SERVICE_PROPS_BYTES) {
          throw invalid('bindings.props')
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(binding.props)
        } catch {
          throw invalid('bindings.props')
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw invalid('bindings.props')
        }
        out.props = binding.props
      }
      return out
    }
    case 'DO': {
      // P3c-1: resourceId encodes `<declaringWorkerId>:<className>` —
      // minted + ownership-checked at deploy; re-parse fail-closed.
      const sep = resourceId.lastIndexOf(':')
      const declaringId = sep === -1 ? '' : resourceId.slice(0, sep)
      const className = sep === -1 ? '' : resourceId.slice(sep + 1)
      if (!validVrtIdentifier(declaringId) || !validDoClassName(className)) {
        throw invalid('bindings.durableObject')
      }
      const out: Record<string, unknown> = { type: 'durableObject', name, className }
      // `serviceWorkerId` names the DECLARING worker — omitted for
      // self-bindings (workerd default: the class lives in this
      // worker) so same-worker snapshots stay minimal.
      if (declaringId !== selfWorkerId) out.serviceWorkerId = declaringId
      return out
    }
    case 'ASSETS': {
      if (!isLowerHex(resourceId)) throw invalid('bindings.manifestDigest')
      const out: Record<string, unknown> = {
        type: 'assets',
        name,
        manifestDigest: resourceId,
        permissions: { read: binding.permissionRead, write: binding.permissionWrite },
      }
      // T31c: the routing mode is VERSION-scoped — emit it on the assets
      // binding so the cell can wire `router-<workerId>` only for
      // opted-in deployments. Absent fields = legacy worker-first.
      if (assetsRouting === 'ASSETS_FIRST' || assetsRouting === 'WORKER_FIRST') {
        out.assetsFirst = true
        if (assetsRouting === 'WORKER_FIRST') {
          out.runWorkerFirst = true
        } else if (assetsRunWorkerFirst.length > 0) {
          out.runWorkerFirst = [...assetsRunWorkerFirst]
        }
      }
      return out
    }
    default:
      throw invalid('bindings.type')
  }
}

/** RV-R138: the ONE typed cross-worker edge constructor. SERVICE,
 * cross-worker DO (`serviceWorkerId` ≠ self) and cross-worker workflow
 * declarations all make `from` depend on `to` for dispatch, so a mixed
 * cycle (A→DO of B, B→SERVICE A) is as unbounded as a pure SERVICE one.
 * Callers (stored cell view, desired payload, deploy lock) adapt their
 * shape into `CrossWorkerRefs`; the Rust twin
 * (snapshot-protocol compute_desired.rs) must mirror this — queued. */
export type CrossWorkerEdgeKind = 'service' | 'durableObject' | 'workflow'
export interface CrossWorkerEdge {
  readonly from: string
  readonly to: string
  readonly kind: CrossWorkerEdgeKind
}
export interface CrossWorkerRefs {
  /** SERVICE binding target workerIds. */
  readonly service?: readonly string[]
  /** DO binding DECLARING workerIds (self allowed; ignored). */
  readonly durableObject?: readonly string[]
  /** workflow declaration defining workerIds (null/self ignored). */
  readonly workflow?: readonly (string | null | undefined)[]
}
export function crossWorkerEdges(workerId: string, refs: CrossWorkerRefs): CrossWorkerEdge[] {
  const out: CrossWorkerEdge[] = []
  for (const to of refs.service ?? []) out.push({ from: workerId, to, kind: 'service' })
  for (const to of refs.durableObject ?? []) {
    if (to !== workerId) out.push({ from: workerId, to, kind: 'durableObject' })
  }
  for (const to of refs.workflow ?? []) {
    if (typeof to === 'string' && to !== workerId) {
      out.push({ from: workerId, to, kind: 'workflow' })
    }
  }
  return out
}

/** Parse a stored DO binding resourceId `<declaringWorkerId>:<className>`
 * into the declaring worker id (null when malformed). */
export function doBindingDeclaringWorkerId(resourceId: string): string | null {
  const sep = resourceId.lastIndexOf(':')
  return sep <= 0 ? null : resourceId.slice(0, sep)
}

/** Stored-view adapter (bindings use the stored enum, resourceId = target). */
export function crossWorkerEdgesOfView(worker: VrtCellWorkerView): CrossWorkerEdge[] {
  const service: string[] = []
  const durableObject: string[] = []
  for (const binding of worker.bindings) {
    if (binding.type === 'SERVICE') service.push(binding.resourceId)
    else if (binding.type === 'DO') {
      const id = doBindingDeclaringWorkerId(binding.resourceId)
      if (id !== null) durableObject.push(id)
    }
  }
  return crossWorkerEdges(worker.workerId, {
    service,
    durableObject,
    workflow: (worker.workflows ?? []).map((w) => w.serviceWorkerId),
  })
}

/** Desired-payload adapter (wire shape). */
function crossWorkerEdgesOfDesired(worker: WorkerDesired): CrossWorkerEdge[] {
  const service: string[] = []
  const durableObject: string[] = []
  for (const binding of worker.bindings) {
    if (binding.type === 'service' && typeof binding.workerId === 'string') {
      service.push(binding.workerId)
    } else if (binding.type === 'durableObject' && typeof binding.serviceWorkerId === 'string') {
      durableObject.push(binding.serviceWorkerId)
    }
  }
  return crossWorkerEdges(worker.workerId, {
    service,
    durableObject,
    workflow: (worker.workflows ?? []).map((w) =>
      typeof w.serviceWorkerId === 'string' ? w.serviceWorkerId : null
    ),
  })
}

/** Three-color DFS over typed edges; a gray back-edge marks every stack
 * frame from the target onward as cyclic. Self-loops are skipped — not a
 * ≥2 cycle. Edges to ids outside `ids` are ignored. */
function cycleMembersOfEdges(ids: readonly string[], all: readonly CrossWorkerEdge[]): Set<string> {
  const idSet = new Set(ids)
  const edges = new Map<string, string[]>()
  for (const e of all) {
    const list = edges.get(e.from) ?? []
    list.push(e.to)
    edges.set(e.from, list)
  }
  const color = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const onCycle = new Set<string>()
  const visit = (node: string): void => {
    color.set(node, 1)
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      if (next === node || !idSet.has(next)) continue
      const state = color.get(next) ?? 0
      if (state === 1) {
        for (let i = stack.indexOf(next); i < stack.length; i++) onCycle.add(stack[i]!)
      } else if (state === 0) {
        visit(next)
      }
    }
    stack.pop()
    color.set(node, 2)
  }
  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) visit(id)
  }
  return onCycle
}

/** T21/F4 + RV-R138: workerIds on a cross-worker (SERVICE/DO/workflow)
 * cycle of the desired payload. */
function serviceCycleMembers(workers: readonly WorkerDesired[]): Set<string> {
  return cycleMembersOfEdges(
    workers.map((w) => w.workerId),
    workers.flatMap(crossWorkerEdgesOfDesired)
  )
}

/** RV-R69 #5: final-shape backstop mirroring Rust per-binding validation
 * (binding name = JS identifier <= 64; identifier-typed fields use
 * `valid_identifier`; DO className = binding-name rule). Throws the same
 * typed `invalid()` the per-worker catch converts into an exclusion. */
function assertBindingWireShape(b: Record<string, unknown>): void {
  if (typeof b.name !== 'string' || !validVrtBindingName(b.name)) throw invalid('bindings.name')
  if (b.type === 'queue') {
    if (!validVrtIdentifier(String(b.queueName))) throw invalid('bindings.queueName')
    if (b.deliveryDelaySeconds !== undefined) {
      const d = b.deliveryDelaySeconds
      if (
        typeof d !== 'number' ||
        !Number.isInteger(d) ||
        d < 0 ||
        d > VRT_MAX_QUEUE_DELIVERY_DELAY_SECONDS
      ) {
        throw invalid('bindings.deliveryDelaySeconds')
      }
    }
  }
  if (b.type === 'service' && b.props !== undefined) {
    const text = b.props
    if (typeof text !== 'string' || Buffer.byteLength(text) > VRT_MAX_SERVICE_PROPS_BYTES) {
      throw invalid('bindings.props')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw invalid('bindings.props')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalid('bindings.props')
    }
  }
  if (b.type === 'durableObject') {
    if (typeof b.className !== 'string' || !validDoClassName(b.className)) {
      throw invalid('bindings.className')
    }
    if (b.serviceWorkerId !== undefined && !validVrtIdentifier(String(b.serviceWorkerId))) {
      throw invalid('bindings.serviceWorkerId')
    }
  }
}

/** P3c-1: DO class name — JS identifier, same rule as Rust
 * `valid_binding_name` (RV-R69 #1: <= 64, was wrongly 128). */
export function validDoClassName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= WORKER_DO_CLASS_NAME_MAX_LEN &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
  )
}

/** T22/G3 + RV-R138: same cycle detection over the stored cell view
 * (used by deploy/rollback inside the cell transaction). */
export function serviceCycleMemberIds(
  workers: readonly VrtCellWorkerView[],
  teamId: string
): Set<string> {
  const team = workers.filter((w) => w.teamId === teamId)
  return cycleMembersOfEdges(
    team.map((w) => w.workerId),
    team.flatMap(crossWorkerEdgesOfView)
  )
}

/** RV-R53.1: max signed tombstones per compute.desired — must match
 * the Rust verifier bound (snapshot-protocol MAX_DELETIONS). */

/** RV-R55: cell capacity parameters supplied by the cell/cluster config. */
export interface VrtCellCapacity {
  readonly memoryBudgetMb?: number
}

export function resolveCellMemoryBudgetMb(capacity?: VrtCellCapacity): number {
  const v = capacity?.memoryBudgetMb
  if (v === undefined) return VRT_DEFAULT_CELL_MEMORY_BUDGET_MB
  if (
    !Number.isSafeInteger(v) ||
    v < VRT_TENANT_MAX_COMMIT_MB ||
    v > VRT_MAX_CELL_MEMORY_BUDGET_MB
  ) {
    throw invalid('capacity.memoryBudgetMb')
  }
  return v
}

/** A tenant's effective committed memory: summed worker quotas, capped by
 * the single-process RSS ceiling. Unparseable quotas count at the ceiling
 * (fail closed — the per-worker validator excludes them later anyway). */
function tenantCommitMb(workers: readonly VrtCellWorkerView[]): number {
  let sum = 0
  for (const w of workers) {
    const m = w.quotas?.memoryMb
    sum += Number.isFinite(m) && m >= VRT_MIN_MEMORY_MB ? m : VRT_TENANT_MAX_COMMIT_MB
  }
  return Math.min(sum, VRT_TENANT_MAX_COMMIT_MB)
}

/** Build + validate the compute.desired payload for one cell revision. */
export function buildComputeDesiredPayload(input: {
  cellId: string
  revision: number
  workers: readonly VrtCellWorkerView[]
  /** RV-R53.1: signed tombstone rows from `vrt_do_tombstones` (already
   * retention-filtered + bounded by the caller — the store fetches at
   * most VRT_DO_TOMBSTONE_MAX). Re-validated here (defense in depth):
   * a malformed row fails the whole publication rather than leaking a
   * bad deletion into a signed document. */
  deletions?: readonly {
    tenantId: string
    workerId: string | null
    classKey: string | null
    revision: number
  }[]
  /** RV-R55: typed cell capacity (committed-memory budget, MB). Absent ⇒
   * VRT_DEFAULT_CELL_MEMORY_BUDGET_MB; present-but-invalid fails closed. */
  capacity?: VrtCellCapacity
  /** CF Flagship: every team's flag apps (`{tenantId, appId, config}`).
   * Tenant-level: a flag edit republishes without a redeploy. Absent ⇒
   * no tenant carries `flagshipApps`. */
  flagshipApps?: readonly { tenantId: string; appId: string; config: string }[]
}): ComputeDesiredBuild {
  const { cellId, revision } = input
  const memoryBudgetMb = resolveCellMemoryBudgetMb(input.capacity)
  if (!validVrtIdentifier(cellId)) throw invalid('cellId')
  if (!Number.isSafeInteger(revision) || revision < 1) throw invalid('revision')

  const deletions: DeletionDesired[] = []
  const seenDeletions = new Set<string>()
  for (const d of input.deletions ?? []) {
    if (!validVrtIdentifier(d.tenantId)) throw invalid('deletions.tenantId')
    if (d.workerId !== null && !validVrtIdentifier(d.workerId)) {
      throw invalid('deletions.workerId')
    }
    if (d.classKey !== null && !/^[0-9a-f]{64}$/.test(d.classKey)) {
      throw invalid('deletions.classKey')
    }
    if (d.classKey !== null && d.workerId === null) throw invalid('deletions.classKey')
    if (!Number.isSafeInteger(d.revision) || d.revision < 0) {
      throw invalid('deletions.revision')
    }
    const dedupe = `${d.tenantId} ${d.workerId ?? ''} ${d.classKey ?? ''}`
    if (seenDeletions.has(dedupe)) continue
    seenDeletions.add(dedupe)
    deletions.push({
      tenantId: d.tenantId,
      ...(d.workerId !== null ? { workerId: d.workerId } : {}),
      ...(d.classKey !== null ? { classKey: d.classKey } : {}),
      revision: d.revision,
    })
  }
  if (deletions.length > VRT_DO_TOMBSTONE_MAX) throw invalid('deletions')

  const tenants = new Map<string, VrtCellWorkerView[]>()
  for (const worker of input.workers) {
    if (!validVrtIdentifier(worker.teamId)) throw invalid('tenantId')
    const list = tenants.get(worker.teamId) ?? []
    list.push(worker)
    tenants.set(worker.teamId, list)
  }
  const excluded: { workerId: string; reason: string }[] = []

  // T11/F1: a tenant-count overflow must not fail the whole cell — evict
  // the most-recently-changed tenants first (stable tenants keep serving)
  // deterministically: recency desc, then tenantId desc.
  let tenantIds = [...tenants.keys()]
  if (tenantIds.length > VRT_MAX_TENANTS) {
    const recency = (tenantId: string) =>
      Math.max(
        0,
        ...tenants.get(tenantId)!.map((w) => (w.changedAt ? new Date(w.changedAt).getTime() : 0))
      )
    const ranked = tenantIds
      .map((t) => ({ t, r: recency(t) }))
      .sort((a, b) => (a.r !== b.r ? b.r - a.r : a.t < b.t ? 1 : -1))
    for (const { t } of ranked.slice(VRT_MAX_TENANTS)) {
      for (const w of tenants.get(t)!) {
        excluded.push({ workerId: w.workerId, reason: 'tenant evicted: cell tenant capacity' })
      }
      tenants.delete(t)
    }
    tenantIds = [...tenants.keys()]
  }
  // RV-R55: committed-memory admission. Keep the stable (least recently
  // changed) tenants while the running sum fits the cell budget; later ones
  // are excluded with a typed reason. Exclusion never emits a deletion
  // tombstone (RV-R53.1) — the tenant's data stays on disk and returns when
  // capacity does.
  {
    const recency = (tenantId: string) =>
      Math.max(
        0,
        ...tenants.get(tenantId)!.map((w) => (w.changedAt ? new Date(w.changedAt).getTime() : 0))
      )
    const ordered = tenantIds
      .map((t) => ({ t, r: recency(t), mb: tenantCommitMb(tenants.get(t)!) }))
      .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.t < b.t ? -1 : 1))
    let used = 0
    for (const { t, mb } of ordered) {
      if (used + mb > memoryBudgetMb) {
        for (const w of tenants.get(t)!) {
          excluded.push({ workerId: w.workerId, reason: 'tenant evicted: cell memory budget' })
        }
        tenants.delete(t)
      } else {
        used += mb
      }
    }
    tenantIds = [...tenants.keys()]
  }
  tenantIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const hostnames = new Set<string>()
  const workerIds = new Set<string>()

  // T37b: one serving consumer per queue per tenant — claims recorded
  // while materializing so a second claimant is a poisoned worker
  // (excluded + diagnostic), never a poisoned publication. The
  // activation-time advisory-lock check in the store is the primary
  // gate; this is the publication-side fail-closed backstop.
  const queueConsumerClaims = new Map<string, string>()

  // CF Flagship: group app rows per tenant — proven once up front so a
  // malformed row fails the publication rather than dropping every bound
  // worker one by one (the doc would never carry a bad flag model).
  const flagshipAppsByTenant = new Map<string, { appId: string; config: string }[]>()
  const flagshipAppIdsByTenant = new Map<string, Set<string>>()
  for (const app of input.flagshipApps ?? []) {
    if (!validVrtIdentifier(app.tenantId)) throw invalid('flagshipApps.tenantId')
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(app.appId)) throw invalid('flagshipApps.appId')
    if (!flagshipConfigIsValid(app.config)) throw invalid('flagshipApps.config')
    const ids = flagshipAppIdsByTenant.get(app.tenantId) ?? new Set<string>()
    if (ids.has(app.appId)) continue
    ids.add(app.appId)
    flagshipAppIdsByTenant.set(app.tenantId, ids)
    const list = flagshipAppsByTenant.get(app.tenantId) ?? []
    list.push({ appId: app.appId, config: app.config })
    flagshipAppsByTenant.set(app.tenantId, list)
  }
  for (const [tenantId, list] of flagshipAppsByTenant) {
    if (list.length > 64) throw invalid('flagshipApps capacity')
    list.sort((a, b) => (a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0))
    flagshipAppsByTenant.set(tenantId, list)
  }

  const tenantList: TenantDesired[] = tenantIds.map((tenantId) => {
    const list = [...tenants.get(tenantId)!].sort((a, b) =>
      a.workerId < b.workerId ? -1 : a.workerId > b.workerId ? 1 : 0
    )
    // T11/F1: over-capacity tail (by workerId order — deterministic) is
    // excluded, not a cell failure. Deploy-time admission checks are the
    // primary guard; this only trips for pre-existing rows after a limit
    // is tightened.
    if (list.length > VRT_MAX_WORKERS_PER_TENANT) {
      for (const w of list.slice(VRT_MAX_WORKERS_PER_TENANT)) {
        excluded.push({ workerId: w.workerId, reason: 'tenant worker capacity exceeded' })
      }
      list.length = VRT_MAX_WORKERS_PER_TENANT
    }
    const workerNames = new Set<string>()
    /** Every worker id of this tenant — tail consumers must resolve here. */
    const allWorkerIds = new Set(list.map((w) => w.workerId))

    const excludedHere: { workerId: string; reason: string }[] = []
    const candidateIds = new Set<string>()
    const workers: WorkerDesired[] = []
    for (const worker of list) {
      try {
        if (!validVrtIdentifier(worker.workerId)) throw invalid('workerId')
        if (workerIds.has(worker.workerId) || candidateIds.has(worker.workerId)) {
          throw invalid('duplicate workerId')
        }
        if (!validVrtWorkerName(worker.name)) throw invalid('worker name')
        if (workerNames.has(worker.name)) throw invalid('duplicate workerName')

        if (!validVrtIdentifier(worker.versionId)) throw invalid('activeVersion.versionId')
        if (!isLowerHex(worker.artifactDigest)) throw invalid('activeVersion.artifactDigest')
        if (!validVrtCompatDate(worker.compatibilityDate)) throw invalid('compatibilityDate')
        if (worker.compatibilityFlags.length > VRT_MAX_COMPAT_FLAGS) {
          throw invalid('compatibilityFlags capacity')
        }
        if (worker.compatibilityFlags.some((f) => !validVrtCompatFlag(f))) {
          throw invalid('compatibilityFlags')
        }
        // T37b-r2: tenant flags must be KNOWN STABLE — same vendored
        // workerd list as the zod gate and the Rust emit check.
        if (worker.compatibilityFlags.some((f) => !isTenantAllowedCompatFlag(f))) {
          throw invalid('compatibilityFlags experimental/unknown')
        }
        // RV-R137: a stored version with duplicate / enable+disable flags would
        // make workerd refuse the whole cell config. Exclude THIS worker only
        // (same per-worker path as the other invalid fields) so the rest of the
        // tenant/cell keeps being published.
        if (findCompatFlagConflict(worker.compatibilityFlags)) {
          throw invalid('compatibilityFlags conflict (COMPAT_FLAG_CONFLICT)')
        }

        if (worker.bindings.length > VRT_MAX_BINDINGS_PER_WORKER) throw invalid('bindings capacity')
        const bindingNames = new Set<string>()
        const bindings = [...worker.bindings]
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map((binding) => {
            if (bindingNames.has(binding.name)) throw invalid('duplicate bindingName')
            bindingNames.add(binding.name)
            if (!validVrtBindingName(binding.name)) throw invalid('binding name')
            const serialized = serializeBinding(
              binding,
              worker.workerId,
              worker.assetsRouting ?? null,
              worker.assetsRunWorkerFirst ?? []
            )
            // CF Flagship: a `FLAGSHIP` binding names an appId that must be
            // one of THIS tenant's `flagshipApps` — the wrapped `innerBinding`
            // render reads the tenant set, so an unresolved appId would
            // produce a worker that cannot evaluate. Same per-worker
            // isolation as other binding faults.
            if (
              serialized.type === 'flagship' &&
              !flagshipAppIdsByTenant.get(tenantId)?.has(serialized.appId as string)
            ) {
              throw invalid('bindings.flagshipApp')
            }
            return serialized
          })

        // CF `[version_metadata]`: `env.<binding>` is `{id, tag,
        // timestamp}` of the SERVING version — synthesized here (not stored
        // as a literal) so a rollback reports the reactivated version's own
        // values. `timestamp` is the version's createdAt in epoch-ms string
        // form (wrangler shape).
        if (worker.versionMetadata != null) {
          if (bindingNames.has(worker.versionMetadata)) {
            throw invalid('versionMetadata.binding')
          }
          if (!validVrtBindingName(worker.versionMetadata)) {
            throw invalid('versionMetadata.binding')
          }
          bindingNames.add(worker.versionMetadata)
          bindings.push({
            type: 'json',
            name: worker.versionMetadata,
            value: JSON.stringify({
              id: worker.versionId,
              tag: '',
              timestamp: String(worker.changedAt?.getTime() ?? 0),
            }),
          })
        }

        // CF typed `[vars]`: non-string values reach env as real JS values
        // via `{"type":"json"}` literals — version-scoped state, so a
        // rollback restores the served version's own values.
        for (const [name, raw] of Object.entries(worker.jsonVars ?? {})) {
          if (bindingNames.has(name)) throw invalid('vars')
          if (!validVrtBindingName(name)) throw invalid('vars')
          const value = JSON.stringify(raw)
          if (value === undefined || value.length > VRT_MAX_JSON_BINDING_BYTES) {
            throw invalid('vars')
          }
          bindingNames.add(name)
          bindings.push({ type: 'json', name, value })
        }

        if (worker.hostnames.length > VRT_MAX_ROUTES_PER_WORKER) throw invalid('routes capacity')
        // Hostname claims commit only when the whole worker validates —
        // an excluded worker must not keep squatting on its routes.
        const routes = [...worker.hostnames]
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .map((hostname) => {
            if (!validVrtHostname(hostname)) throw invalid('routes.hostname')
            if (hostnames.has(hostname)) throw invalid('duplicate hostname')
            return { hostname }
          })

        if (worker.crons.length > VRT_MAX_CRONS_PER_WORKER) throw invalid('crons capacity')
        const crons = [...worker.crons]
          .sort((a, b) => (a.scheduleId < b.scheduleId ? -1 : a.scheduleId > b.scheduleId ? 1 : 0))
          .map((cron) => {
            if (!validVrtIdentifier(cron.scheduleId)) throw invalid('crons.scheduleId')
            if (!validVrtCronExpression(cron.expression)) throw invalid('crons.expression')
            return cron
          })

        const quotas = worker.quotas
        if (!(quotas.cpuMs >= VRT_MIN_CPU_MS && quotas.cpuMs <= VRT_MAX_CPU_MS)) {
          throw invalid('quotas.cpuMs')
        }
        if (!(quotas.memoryMb >= VRT_MIN_MEMORY_MB && quotas.memoryMb <= VRT_MAX_MEMORY_MB)) {
          throw invalid('quotas.memoryMb')
        }
        if (quotas.subrequests > VRT_MAX_SUBREQUESTS) throw invalid('quotas.subrequests')
        if (quotas.outboundConnections > VRT_MAX_OUTBOUND_CONNECTIONS) {
          throw invalid('quotas.outboundConnections')
        }

        const queueConsumers = (worker.queueConsumers ?? []).map((c) => {
          if (!/^[a-z0-9]{26}$/.test(c.queueId)) throw invalid('queueConsumers.queueId')
          if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(c.queueName)) {
            throw invalid('queueConsumers.queueName')
          }
          if (c.deadLetterQueueId !== null) {
            if (!/^[a-z0-9]{26}$/.test(c.deadLetterQueueId)) {
              throw invalid('queueConsumers.deadLetterQueueId')
            }
            if (c.deadLetterQueueId === c.queueId) {
              throw invalid('queueConsumers.deadLetterQueueId')
            }
          }
          const bounded = (v: number | null, lo: number, hi: number, field: string) => {
            if (v === null) return null
            if (!Number.isInteger(v) || v < lo || v > hi) {
              throw invalid(`queueConsumers.${field}`)
            }
            return v
          }
          const maxBatchTimeoutMs = bounded(c.maxBatchTimeoutMs, 0, 60_000, 'maxBatchTimeoutMs')
          if (maxBatchTimeoutMs !== null && maxBatchTimeoutMs % 1000 !== 0) {
            throw invalid('queueConsumers.maxBatchTimeoutMs')
          }
          return {
            queueId: c.queueId,
            queueName: c.queueName,
            deadLetterQueueId: c.deadLetterQueueId,
            maxBatchSize: bounded(c.maxBatchSize, 1, 100, 'maxBatchSize'),
            // Wire unit is whole seconds (QueueConsumerDesired).
            maxBatchTimeoutSecs: maxBatchTimeoutMs === null ? null : maxBatchTimeoutMs / 1000,
            maxRetries: bounded(c.maxRetries, 0, 100, 'maxRetries'),
            retryDelaySecs: bounded(c.retryDelaySeconds, 0, 86_400, 'retryDelaySecs'),
            maxConcurrency: bounded(c.maxConcurrency, 1, 1000, 'maxConcurrency'),
          }
        })
        if (queueConsumers.length > VRT_MAX_QUEUE_CONSUMERS_PER_WORKER) {
          throw invalid('queueConsumers capacity')
        }
        const seenConsumerQueues = new Set<string>()
        for (const c of queueConsumers) {
          if (seenConsumerQueues.has(c.queueId)) throw invalid('queueConsumers.queueId')
          seenConsumerQueues.add(c.queueId)
          const claimKey = `${worker.teamId}:${c.queueId}`
          if (queueConsumerClaims.has(claimKey)) throw invalid('queueConsumers.queueId')
          queueConsumerClaims.set(claimKey, worker.workerId)
        }

        // Tail Workers: stored consumer workerIds must all be members of
        // this tenant's worker set (fail closed on a corrupted row);
        // dedupe — a duplicated id would emit a duplicate tail service.
        const seenTailConsumers = new Set<string>()
        const tailConsumers = (worker.tailConsumers ?? []).map((workerId) => {
          if (!validVrtIdentifier(workerId) || !allWorkerIds.has(workerId)) {
            throw invalid('tailConsumers.workerId')
          }
          if (seenTailConsumers.has(workerId)) throw invalid('tailConsumers.workerId')
          seenTailConsumers.add(workerId)
          return { workerId }
        })

        // Streaming Tail Workers: identical same-tenant rule and dedupe as
        // `tailConsumers`, emitted as `streamingTails` designators.
        const seenStreamingTailConsumers = new Set<string>()
        const streamingTailConsumers = (worker.streamingTailConsumers ?? []).map((workerId) => {
          if (!validVrtIdentifier(workerId) || !allWorkerIds.has(workerId)) {
            throw invalid('streamingTailConsumers.workerId')
          }
          if (seenStreamingTailConsumers.has(workerId)) {
            throw invalid('streamingTailConsumers.workerId')
          }
          seenStreamingTailConsumers.add(workerId)
          return { workerId }
        })

        // P3c-1: declared DO classes — validate like the Rust
        // validator (fail closed, same field names) so a poisoned row
        // is excluded here, never emitted.
        const seenClasses = new Set<string>()
        const durableObjectClasses = [...(worker.durableObjectClasses ?? [])]
          .sort((a, b) => (a.className < b.className ? -1 : a.className > b.className ? 1 : 0))
          .map((c) => {
            if (!validDoClassName(c.className)) throw invalid('durableObjectClasses.className')
            if (seenClasses.has(c.className)) throw invalid('durableObjectClasses.className')
            seenClasses.add(c.className)
            if (!/^[0-9a-f]+$/.test(c.uniqueKey) || c.uniqueKey.length > 64) {
              throw invalid('durableObjectClasses.uniqueKey')
            }
            // DB column `transferFromWorkerId` → wire `fromWorkerId`
            // (same name the Rust validator uses).
            if (
              c.transferFromWorkerId != null &&
              !validVrtIdentifier(c.transferFromWorkerId, VRT_MAX_IDENTIFIER_LEN)
            ) {
              throw invalid('durableObjectClasses.fromWorkerId')
            }
            return {
              className: c.className,
              uniqueKey: c.uniqueKey,
              enableSql: c.enableSql,
              // `skip_serializing_if = "Option::is_none"` parity — the
              // key is omitted when unset (signed canonical form).
              ...(c.transferFromWorkerId != null ? { fromWorkerId: c.transferFromWorkerId } : {}),
            }
          })
        if (durableObjectClasses.length > 64) throw invalid('durableObjectClasses capacity')

        // W2: declared workflows — validated like the Rust
        // `validate_workflows` (name ^[A-Za-z0-9_-]{1,64}$, binding /
        // class_name JS ident <=64, uniqueKey exactly-64 lower-hex,
        // limits 1..100_000, binding not colliding with the env
        // surface) so a poisoned row is excluded, never emitted.
        const seenWorkflowNames = new Set<string>()
        const workflows = [...(worker.workflows ?? [])]
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map((w) => {
            if (!WORKFLOW_NAME_RE.test(w.name)) throw invalid('workflows.name')
            if (seenWorkflowNames.has(w.name)) throw invalid('workflows.name')
            seenWorkflowNames.add(w.name)
            if (!WORKFLOW_IDENT_RE.test(w.binding)) throw invalid('workflows.binding')
            if (!WORKFLOW_IDENT_RE.test(w.className)) throw invalid('workflows.className')
            if (!/^[0-9a-f]{64}$/.test(w.uniqueKey)) throw invalid('workflows.uniqueKey')
            if (bindingNames.has(w.binding)) {
              throw invalid('workflows.binding collides with a binding')
            }
            bindingNames.add(w.binding)
            if (
              w.limitsSteps != null &&
              (!Number.isInteger(w.limitsSteps) ||
                w.limitsSteps < 1 ||
                w.limitsSteps > MAX_WORKFLOW_STEPS)
            ) {
              throw invalid('workflows.limitsSteps')
            }
            for (const [key, value] of [
              ['successRetentionMs', w.successRetentionMs],
              ['errorRetentionMs', w.errorRetentionMs],
            ] as const) {
              if (
                value != null &&
                (!Number.isSafeInteger(value) || value < 0 || value > 30 * 24 * 60 * 60 * 1000)
              ) {
                throw invalid(`workflows.${key}`)
              }
            }
            if (
              w.concurrencyLimit != null &&
              (!Number.isInteger(w.concurrencyLimit) ||
                w.concurrencyLimit < 1 ||
                w.concurrencyLimit > 4_500)
            ) {
              throw invalid('workflows.concurrencyLimit')
            }
            // W7: `serviceWorkerId` (wrangler script_name resolved
            // server-side at deploy) — emitted only when it names a
            // DIFFERENT worker (Rust `skip_serializing_if` parity);
            // the cross-tenant/dangling case is filtered out below
            // like a bad service-binding target.
            const sw = typeof w.serviceWorkerId === 'string' ? w.serviceWorkerId : null
            return {
              name: w.name,
              binding: w.binding,
              className: w.className,
              uniqueKey: w.uniqueKey,
              // Rust `skip_serializing_if = "Option::is_none"` — the key
              // is OMITTED when absent so TS and Rust canonical bytes
              // stay identical (emitting `null` would diverge the
              // signed canonical form across implementations).
              ...(w.limitsSteps != null ? { limitsSteps: w.limitsSteps } : {}),
              ...(w.successRetentionMs != null ? { successRetentionMs: w.successRetentionMs } : {}),
              ...(w.errorRetentionMs != null ? { errorRetentionMs: w.errorRetentionMs } : {}),
              ...(w.concurrencyLimit != null ? { concurrencyLimit: w.concurrencyLimit } : {}),
              ...(sw !== null && sw !== worker.workerId ? { serviceWorkerId: sw } : {}),
            }
          })
        if (workflows.length > MAX_WORKFLOWS_PER_WORKER) {
          throw invalid('workflows capacity')
        }

        // RV-R69 #5 backstop: re-check every identifier-shaped wire field
        // that Rust validates, on the FINAL per-worker value. A future
        // drift in any one mapping above then excludes just this worker
        // (typed reason in `excluded`) instead of signing an envelope the
        // cell rejects whole.
        for (const b of bindings) assertBindingWireShape(b as unknown as Record<string, unknown>)
        for (const c of queueConsumers) {
          if (!validVrtIdentifier(c.queueName)) throw invalid('queueConsumers.queueName')
        }

        workers.push({
          workerId: worker.workerId,
          name: worker.name,
          activeVersion: {
            versionId: worker.versionId,
            artifactDigest: worker.artifactDigest,
            compatibilityDate: worker.compatibilityDate,
            compatibilityFlags: [...worker.compatibilityFlags],
          },
          bindings,
          routes,
          crons,
          quotas,
          queueConsumers,
          // Tail Workers — omitted when empty (same wire-compat rule as
          // durableObjectClasses: old cells deny_unknown_fields).
          ...(tailConsumers.length ? { tailConsumers } : {}),
          ...(streamingTailConsumers.length ? { streamingTailConsumers } : {}),
          // `[observability]` — re-bounds-checked at the snapshot boundary
          // (a corrupted version row must never emit an out-of-range rate);
          // omitted when absent for wire-compat.
          ...(worker.observability != null
            ? {
                observability: (() => {
                  const o = worker.observability!
                  if (
                    !Number.isSafeInteger(o.headSamplingRatePpm) ||
                    o.headSamplingRatePpm < 0 ||
                    o.headSamplingRatePpm > 1_000_000
                  ) {
                    throw invalid('observability.headSamplingRatePpm')
                  }
                  return {
                    enabled: o.enabled,
                    logsEnabled: o.logsEnabled,
                    invocationLogs: o.invocationLogs,
                    headSamplingRatePpm: o.headSamplingRatePpm,
                  }
                })(),
              }
            : {}),
          // Wire-compat (P3c-1-r1): the field is emitted ONLY when the
          // worker declares classes. Old cells parse with
          // `deny_unknown_fields` — an unconditional empty array would
          // make them reject every snapshot, forcing cell-first
          // rollouts. Omitting keeps non-DO payloads byte-identical to
          // pre-P3c-1, so the control plane may roll before or with
          // the cells; DO workers require the new cell anyway (the
          // capnp fields are meaningless to an old binary). New cells
          // read old snapshots fine (`#[serde(default)]`).
          ...(durableObjectClasses.length ? { durableObjectClasses } : {}),
          ...(workflows.length ? { workflows } : {}),
        })
        workerIds.add(worker.workerId)
        candidateIds.add(worker.workerId)
        workerNames.add(worker.name)
        for (const route of routes) hostnames.add(route.hostname)
      } catch (error) {
        // One poisoned worker must not take down the whole cell's
        // publication (T9/M5): exclude it — equivalent to "this worker is
        // not serving" — and report it in the diagnostic list.
        excludedHere.push({
          workerId: validVrtIdentifier(worker.workerId) ? worker.workerId : '<invalid>',
          reason: error instanceof Error ? error.message.slice(0, 160) : 'invalid worker state',
        })
      }
    }

    // Service bindings may only target workers that actually serve. A
    // target excluded above (or never present) poisons its referrer the
    // same way — resolve to a fixed point so cascaded exclusions are
    // deterministic (bounded by the worker count).
    //
    // T21/F4: cyclic service graphs (A→B→A, length ≥ 2) are rejected
    // outright — the dispatch happens inside workerd's isolate where
    // no depth header or per-hop timeout can be injected, so the only
    // honest bound is structural. Every worker ON a cycle is excluded;
    // dropping it may orphan acyclic referrers, hence the two checks
    // run in one fixpoint loop. Self-loops (length 1) are not cycles
    // here — deploy admission rejects them earlier (assertServiceTarget).
    for (;;) {
      const serving = new Set(workers.map((w) => w.workerId))
      // Discriminated drop: the exclusion reason must name the real
      // cause (a generic "service binding" reason on a workflow drop
      // misleads diagnostics).
      const bad = (worker: (typeof workers)[number]): string | null =>
        worker.bindings.some((binding) => {
          if (binding.type === 'service') {
            return (
              typeof binding.workerId !== 'string' ||
              !validVrtIdentifier(binding.workerId, VRT_MAX_IDENTIFIER_LEN) ||
              !serving.has(binding.workerId)
            )
          }
          // P3c-1: a durableObject binding resolves only when its
          // declaring worker serves AND declares the class — anything
          // else poisons the referrer, same rule as service bindings.
          if (binding.type === 'durableObject') {
            const target =
              typeof binding.serviceWorkerId === 'string'
                ? binding.serviceWorkerId
                : worker.workerId
            if (!serving.has(target)) return true
            const declaring = workers.find((w) => w.workerId === target)
            return !declaring?.durableObjectClasses?.some((c) => c.className === binding.className)
          }
          return false
        })
          ? 'service binding target is not serving in this tenant'
          : // W7: a cross-worker workflow binding resolves only when its
            // DEFINING worker serves in this tenant. The class-declaration
            // check itself is validated server-side at deploy (the row can
            // only carry an id that resolved then); a target excluded here
            // poisons the referrer, mirroring the service/DO rule above.
            // (Rust-side tenant validation additionally enforces
            // (defining-worker, name) uniqueness — the signing plane must
            // never emit a spec the cell would reject whole.)
            (worker.workflows ?? []).some((w) => {
                const target =
                  typeof w.serviceWorkerId === 'string' ? w.serviceWorkerId : worker.workerId
                if (!serving.has(target)) return true
                // same-tenant uniqueness on (defining worker, workflow name):
                // keep the decl where workerId == target (the defining
                // worker's own declaration wins), else the lowest workerId —
                // deterministic so fixpoint convergence stays bounded.
                return workers.some(
                  (o) =>
                    o !== worker &&
                    (o.workflows ?? []).some(
                      (ow) =>
                        ow.name === w.name &&
                        (typeof ow.serviceWorkerId === 'string'
                          ? ow.serviceWorkerId
                          : o.workerId) === target &&
                        (o.workerId === target ||
                          (worker.workerId !== target && o.workerId < worker.workerId))
                    )
                )
              })
            ? 'workflow defining worker is not serving or (worker, name) collides'
            : null
      const index = workers.findIndex((worker) => bad(worker) !== null)
      if (index !== -1) {
        const dropped = workers.splice(index, 1)[0]!
        excludedHere.push({
          workerId: dropped.workerId,
          reason: bad(dropped) ?? 'excluded',
        })
        continue
      }
      const cyclic = serviceCycleMembers(workers)
      if (cyclic.size === 0) break
      for (let i = workers.length - 1; i >= 0; i--) {
        if (cyclic.has(workers[i]!.workerId)) {
          const dropped = workers.splice(i, 1)[0]!
          excludedHere.push({
            workerId: dropped.workerId,
            reason: 'service bindings form a cycle',
          })
        }
      }
    }
    excluded.push(...excludedHere)
    const tenantFlagshipApps = flagshipAppsByTenant.get(tenantId)
    return {
      tenantId,
      workers,
      ...(tenantFlagshipApps && tenantFlagshipApps.length > 0
        ? { flagshipApps: tenantFlagshipApps }
        : {}),
    }
  })

  return {
    payload: {
      schemaVersion: COMPUTE_DESIRED_SCHEMA_VERSION,
      cellId,
      revision,
      tenants: tenantList,
      // Omitted when empty — tombstone-free snapshots stay
      // byte-compatible with cells that predate the field.
      ...(deletions.length > 0 ? { deletions } : {}),
    },
    excluded,
  }
}
