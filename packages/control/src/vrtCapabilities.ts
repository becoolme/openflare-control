/**
 * RV-R58: single typed source for the capability bits a cell reports in its
 * desired-state ACK, plus the pure "what does this config need" gate shared by
 * deploy and rollback.
 *
 * Rules (fail closed):
 *  - Every consumer (ACK zod schema, Prisma read path, in-memory store,
 *    change detection) derives from `VRT_CELL_CAPABILITY_KEYS`; adding a bit
 *    here is the only edit needed for it to survive a store round trip.
 *  - A missing / non-`true` bit is "unsupported", never "supported".
 */

import { z } from 'zod'

export const VRT_CELL_CAPABILITY_KEYS = [
  'cron',
  'assets',
  'd1',
  'queue',
  'workflows',
  'workflowsOps',
  'workflowsCrossWorker',
  'd1CellOps',
  'storagePurge',
  /** KV namespaces served (cell reports it only when a KV backend is wired). */
  'kv',
  /** R2 object data ops served (cell reports it only when an R2 backend is wired). */
  'r2',
  /** SERVICE bindings that name a `WorkerEntrypoint` export are rendered. */
  'serviceEntrypoint',
  /** `workerLoader` bindings render to the pinned workerd fork's loader cap. */
  'workerLoader',
  /** Per-worker quotas render into workerd's `limits` block. */
  'quotas',
  /** SERVICE `props` (`ctx.props`) is understood by this cell generation. */
  'serviceProps',
  /** Queue-level `deliveryDelaySeconds` is understood by this cell generation. */
  'queueDeliveryDelay',
  // Runtime generations may understand features this control plane does not
  // emit yet. They MUST still be accepted in an ACK: a strict schema that
  // rejects a newer cell's capability bit would fail the whole publication
  // (the cell is healthy; the control plane is simply older). Deploy gating
  // for these features is added here when the corresponding desired fields
  // are implemented.
  'analyticsEngine',
  'flagship',
  'email',
  'images',
  'k2',
  'observability',
  'streamingTailConsumers',
  'unsafeEval',
] as const

export type VrtCellCapabilityKey = (typeof VRT_CELL_CAPABILITY_KEYS)[number]

/** `cron` / `assets` predate the optional bits and stay mandatory on the wire. */
export type VrtCellCapabilities = Record<'cron' | 'assets', boolean> &
  Partial<Record<Exclude<VrtCellCapabilityKey, 'cron' | 'assets'>, boolean>>

/** Read a stored (untrusted JSON) capability object: every known key is
 * normalised to a strict boolean; unknown keys are dropped. */
export function normalizeVrtCellCapabilities(raw: unknown): VrtCellCapabilities | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const key of VRT_CELL_CAPABILITY_KEYS) out[key] = obj[key] === true
  return out as VrtCellCapabilities
}

/** ACK wire schema, DERIVED from the key list so it cannot drift: `cron` /
 * `assets` mandatory (pre-T21 shape), every other bit optional and read as
 * unsupported when absent. Strict: an unknown bit is a malformed ACK. */
export const vrtCellCapabilitiesSchema = z
  .object(
    Object.fromEntries(
      VRT_CELL_CAPABILITY_KEYS.map((k) => [
        k,
        k === 'cron' || k === 'assets' ? z.boolean() : z.boolean().optional(),
      ])
    ) as Record<'cron' | 'assets', z.ZodBoolean> &
      Record<Exclude<VrtCellCapabilityKey, 'cron' | 'assets'>, z.ZodOptional<z.ZodBoolean>>
  )
  .strict()

export interface VrtCapabilityNeeds {
  readonly cronCount: number
  /** Binding `type` strings of the version (only the typed subset matters). */
  readonly bindingTypes: readonly string[]
  readonly queueConsumerCount: number
  readonly workflowCount: number
  /** Workflow declarations that point at another worker (`script_name`). */
  readonly crossWorkerWorkflowCount: number
  /** SERVICE bindings that name a non-default entrypoint. A cell that does
   * not understand the wire field would reject the WHOLE snapshot. */
  readonly serviceEntrypointCount: number
  /** SERVICE bindings that carry `props` (optional for older callers). */
  readonly servicePropsCount?: number
  /** QUEUE bindings with a queue-level `deliveryDelaySeconds`. */
  readonly queueDeliveryDelayCount?: number
  /** `workerLoader` bindings. */
  readonly workerLoaderCount?: number
  /** Workers declaring non-default quotas (limits block rendered). */
  readonly nonDefaultQuotaCount?: number
}

/** Pure: capability bits a config needs. Deploy and rollback both call it. */
export function requiredCapabilities(needs: VrtCapabilityNeeds): VrtCellCapabilityKey[] {
  const out = new Set<VrtCellCapabilityKey>()
  if (needs.cronCount > 0) out.add('cron')
  if (needs.queueConsumerCount > 0) out.add('queue')
  for (const t of needs.bindingTypes) {
    if (t === 'ASSETS') out.add('assets')
    // D1 and QUEUE bindings are both served by vrt-sql.
    if (t === 'D1' || t === 'QUEUE') out.add('d1')
    // KV needs a KV backend behind the provider; v1 base cells have none.
    if (t === 'KV') out.add('kv')
  }
  if (needs.workflowCount > 0) out.add('workflows')
  if (needs.crossWorkerWorkflowCount > 0) out.add('workflowsCrossWorker')
  if (needs.serviceEntrypointCount > 0) out.add('serviceEntrypoint')
  if ((needs.servicePropsCount ?? 0) > 0) out.add('serviceProps')
  if ((needs.queueDeliveryDelayCount ?? 0) > 0) out.add('queueDeliveryDelay')
  if ((needs.workerLoaderCount ?? 0) > 0) out.add('workerLoader')
  if ((needs.nonDefaultQuotaCount ?? 0) > 0) out.add('quotas')
  return VRT_CELL_CAPABILITY_KEYS.filter((k) => out.has(k))
}

/** Required bits the cell does not report as exactly `true` (null caps ⇒ all). */
export function missingCapabilities(
  required: readonly VrtCellCapabilityKey[],
  caps: Partial<Record<VrtCellCapabilityKey, boolean>> | null
): VrtCellCapabilityKey[] {
  return required.filter((k) => caps?.[k] !== true)
}
