/**
 * Cell wire contract — the JSON/Zod shapes the cell-controller exchanges
 * with the control plane, plus the pure helpers derived from them.
 *
 * Portable: this is the part both the vibeploy control plane and the OSS
 * plane must interpret identically. Stateful ACK handling stays in
 * `vrtCellSync` until the error/logger ports land.
 */
import { z } from 'zod'
import { vrtCellCapabilitiesSchema, type VrtCellCapabilities } from './vrtCapabilities.js'

/** ACK verdict for one publication revision. */
export type VrtAckStatus = 'APPLIED' | 'REJECTED' | 'PARTIAL'
export const VRT_ACK_STATUSES: readonly VrtAckStatus[] = ['APPLIED', 'REJECTED', 'PARTIAL']

/** MIG-1: one tenant-level apply/switch failure inside an ACK —
 * `{tenant, workerIds?, code, detail?}`; every field bounded (the pod
 * side bounds earlier, this is the untrusted-input boundary). */
export const vrtAckTenantFailureSchema = z
  .object({
    tenant: z.string().min(1).max(191),
    workerIds: z.array(z.string().min(1).max(191)).max(64).optional(),
    code: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    detail: z.string().max(512).optional(),
  })
  .strict()

export type VrtAckTenantFailure = z.infer<typeof vrtAckTenantFailureSchema>

/**
 * Wire schema for `POST /vrt/desired/ack` — the contract the route
 * validates before calling `recordDesiredAck` (RV-R68: lives beside
 * the service so the cross-language wire fixtures feed THE schema the
 * route uses). `.strict()` — unknown fields are a malformed ack.
 */
/**
 * Revision-fence proof (issue #63). A cell that persisted a signed document
 * whose revision is ahead of the acked one echoes the compact attestation the
 * plane delivered with that document. Only then may the floor be raised past
 * the bounded delta. `.strict()`: unknown fields are a malformed proof.
 */
export const vrtFenceProofSchema = z
  .object({
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
    envelopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
    attestation: z.string().min(1).max(512),
  })
  .strict()

export const vrtDesiredAckSchema = z
  .object({
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
    // T11/F11: binds the full signed envelope, not just the payload —
    // required (MVP: no backwards-compat mode is needed pre-release).
    envelopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
    // T11/F5: the cell reports its persisted revision fence so a restored
    // control-plane DB never re-signs an already-fenced revision.
    fenceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    // Issue #63: optional cryptographic proof for a fence ahead of the acked
    // revision (typically after a control-plane restore). Old cells omit it and
    // keep the bounded-integer path.
    fenceProof: vrtFenceProofSchema.optional(),
    status: z.enum(['APPLIED', 'REJECTED', 'PARTIAL']),
    reason: z.string().max(256).optional(),
    appliedAt: z.string().datetime({ offset: true }).optional(),
    // Optional belt-and-suspenders check: when the client echoes its own
    // cell id it must match the identity-derived one — mismatch is a
    // cross-cell attempt and rejected 403 (fail closed, not a guess).
    cellId: z.string().max(128).optional(),
    // T21: cell-declared runtime capability bits — absent for pre-T21
    // cells (read as unsupported server-side, fail closed).
    capabilities: vrtCellCapabilitiesSchema.optional(),
    // MIG-1: per-tenant apply/switch failures the pod processed for
    // this revision — diagnostics carried BESIDE the pod-level verdict.
    // Absent on pre-MIG-1 controllers (and empty when every tenant
    // applied cleanly). Bounded everywhere; codes are pattern-validated
    // and echoed verbatim, details are sanitized upstream + bounded.
    tenantFailures: z.array(vrtAckTenantFailureSchema).max(128).optional(),
    // MIG-7: explicit "every assigned pod proved it loaded this
    // revision" bit — forward-compat alternative evidence for
    // PARTIAL-scope mark recovery beside the `tenant-failed` reason
    // (which post-MIG-4 cells already emit only when all pods
    // applied). Absent on every cell shipping today — treated as
    // unproven (fail closed, never recovered by ambiguity).
    podsApplied: z.boolean().optional(),
  })
  .strict() // unknown fields are a malformed ack, not silently ignored

export interface VrtDesiredAckInput {
  readonly revision: number
  readonly payloadDigest: string
  /** sha256 of the full signed envelope the cell verified — must equal
   * the stored publication's (T11/F11). Required for new controllers. */
  readonly envelopeDigest: string
  /** The cell's persisted revision fence (T11/F5) — the control plane
   * raises its own counter toward it (bounded) so a restored DB cannot
   * sign a revision the cell already fenced. */
  readonly fenceRevision: number
  /** Optional proof for `fenceRevision` when it is ahead of `revision`
   * (issue #63). Required for raises beyond VRT_FENCE_RAISE_MAX_DELTA. */
  readonly fenceProof?: {
    readonly revision: number
    readonly payloadDigest: string
    readonly envelopeDigest: string
    readonly attestation: string
  }
  readonly status: VrtAckStatus
  readonly reason?: string
  /** T21: cell-declared capabilities — persisted verbatim (latest wins);
   * absent ⇒ leave the stored value alone (old cells never upgrade
   * themselves to "capable" by omitting the field). */
  readonly capabilities?: VrtCellCapabilities
  /** MIG-1: tenant-level failures for this revision — persisted
   * verbatim (bounded at the wire schema); absent ⇒ leave the stored
   * diagnostics alone (pre-MIG-1 controllers keep null). */
  readonly tenantFailures?: readonly VrtAckTenantFailure[]
  /** MIG-7: explicit all-pods-applied proof for PARTIAL-scope
   * recovery — see the schema comment; `tenant-failed` reason is the
   * evidence post-MIG-4 cells already send. */
  readonly podsApplied?: boolean
}

/** T12/G8: a publication stuck in PARTIAL past this age escalates to a
 * structured warning — the cell reported partial pod delivery but has not
 * converged. Age is measured from the publication's `issuedAt` (the
 * revision's first-seen time server-side). */
export const VRT_PARTIAL_STUCK_MS = 10 * 60_000

/** Configurable threshold — `VRT_PARTIAL_STUCK_MS` env override, else
 * the 10-minute default. Re-read per call so tests can set it. */
export function partialStuckMs(): number {
  const raw = Number(process.env.VRT_PARTIAL_STUCK_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : VRT_PARTIAL_STUCK_MS
}

/** T12/G8 diagnostics — read-only counters for ops surfaces. */
export const vrtAckDiagnostics = {
  /** PARTIAL acks accepted while the publication was already older than
   * `VRT_PARTIAL_STUCK_MS`. */
  stuckPartialAcks: 0,
  /** Issue #63: fence proofs that verified and unlocked an unbounded raise. */
  fenceProofAccepted: 0,
  /** Issue #63: fence proofs present but invalid (rejected, ack failed). */
  fenceProofRejected: 0,
  /** Legacy bounded raises refused because the delta exceeded the cap. */
  fenceRaiseRejected: 0,
}

/** Reason codes the API may echo — cell-reported `ackReason` is untrusted
 * text; only these typed codes are exposed (T12/G2). Everything else

/** Reason codes the API may echo — cell-reported `ackReason` is untrusted
 * text; only these typed codes are exposed (T12/G2). Everything else
 * collapses to null so arbitrary strings never reach clients. */
const VRT_ACK_REASON_WHITELIST: ReadonlySet<string> = new Set([
  'malformed-envelope',
  'wrong-kind',
  'wrong-scope',
  'unsupported-version',
  'signature-or-key',
  'digest-mismatch',
  'expired',
  'not-yet-valid',
  'revision-rollback',
  'revision-conflict',
  'payload-invalid',
  'fence-persist',
  'pods-not-applied',
  // MIG-4: every pod applied but ≥1 tenant reports a failure — the
  // typed PARTIAL reason the cell sends instead of a false APPLIED.
  'tenant-failed',
  'egress-policy-unavailable',
  'switch-failed',
  'assignment-mismatch',
  'assignment-incomplete',
  'snapshot-unavailable',
  'workers-not-ready',
  'bundle-unavailable',
  'render-inputs-unavailable',
  // Informational (pod ready=true): scale-to-zero tenant hibernated, wakes
  // on demand. Surfaced for observability only — never a failure signal.
  'hibernated',
])

/** Sanitize a stored cell-reported ackReason for API exposure: returns
 * `{ code }` for whitelisted typed codes (the `pods-not-applied:p0,p1`
 * detail part is collapsed to just the count so pod identities never
 * leave the cell), or null for anything else. */
export function vrtAckReasonForApi(
  reason: string | null | undefined
): { code: string; failedPods?: number } | null {
  if (!reason) return null
  const [head, tail] = reason.split(':', 2)
  if (!head || !VRT_ACK_REASON_WHITELIST.has(head)) return null
  if (head === 'pods-not-applied' && tail !== undefined) {
    const failedPods = tail.split(',').filter(Boolean).length
    return { code: head, failedPods }
  }
  return { code: head }
}

/** MIG-1b: extract `{workerId → {versionId, tenantId}}` from a stored
 * publication envelope's payload — the server-side record of desired
 * state used for the changed-set diff. Returns `null` when the payload
 * is structurally unusable (missing/malformed `tenants`), which the
 * caller treats as "changed set undeterminable → mark nothing".
 * Individual entries missing ids are skipped, never guessed. Bounded
 * at 1024 tenants / 1024 workers each (the signed doc itself is

/** MIG-1b: extract `{workerId → {versionId, tenantId}}` from a stored
 * publication envelope's payload — the server-side record of desired
 * state used for the changed-set diff. Returns `null` when the payload
 * is structurally unusable (missing/malformed `tenants`), which the
 * caller treats as "changed set undeterminable → mark nothing".
 * Individual entries missing ids are skipped, never guessed. Bounded
 * at 1024 tenants / 1024 workers each (the signed doc itself is
 * capped at 512 KiB upstream). */
export function desiredWorkerVersions(
  envelope: unknown
): Map<string, { versionId: string; tenantId: string }> | null {
  const payload = (envelope as { payload?: unknown } | null)?.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const tenants = (payload as { tenants?: unknown }).tenants
  if (!Array.isArray(tenants)) return null
  const out = new Map<string, { versionId: string; tenantId: string }>()
  for (const t of tenants.slice(0, 1024)) {
    if (t === null || typeof t !== 'object') continue
    const tenantId = (t as { tenantId?: unknown }).tenantId
    const workers = (t as { workers?: unknown }).workers
    if (typeof tenantId !== 'string' || !Array.isArray(workers)) continue
    for (const w of workers.slice(0, 1024)) {
      const workerId = (w as { workerId?: unknown } | null)?.workerId
      const versionId = (w as { activeVersion?: { versionId?: unknown } } | null)?.activeVersion
        ?.versionId
      if (typeof workerId === 'string' && typeof versionId === 'string') {
        out.set(workerId, { versionId, tenantId })
      }
    }
  }
  return out
}

/** MIG-5: one worker the cell marked apply-failed at this revision —
 * everything the control plane needs to drive an automatic rollback.
 * The idempotency key is (workerId, failedVersionId, markRevision). */
export interface VrtCellApplyFailedMark {
  readonly workerId: string
  /** Server-verified tenant — the store's own teamId match, never the
   * ack-supplied text alone. */
  readonly teamId: string
  readonly clusterId: string
  /** The desired version the cell failed to apply at `markRevision`. */
  readonly failedVersionId: string
  /** The worker's version in the last APPLIED publication below
   * `markRevision` — the ONLY server-side proof of "previously applied
   * on this cell". `null` when no proven fallback exists (first
   * deploy, or the baseline's own ack reported this worker/tenant
   * failing): the caller must NOT roll back. */
  readonly rollbackVersionId: string | null
  /** MIG-6: distinguishes WHY `rollbackVersionId` is null —
   * `true` = an APPLIED baseline exists but its own ack diagnostics
   * still name this worker/tenant failing (typed decline reason
   * `baseline-failed`); `false`/absent = no usable baseline at all
   * (`no-applied-baseline`). */
  readonly baselineFailed?: boolean
  /** The cell-reported failure code (zod-validated, bounded). */
  readonly code: string
  /** The ack revision that wrote the FAILED mark. */
  readonly markRevision: number
}
