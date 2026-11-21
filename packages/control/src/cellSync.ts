/**
 * Cell-side sync surface for `compute.desired` (portable).
 *
 * Two flows, both scoped by an AUTHENTICATED cluster identity — the
 * caller-derived `cellId` never comes from the request body:
 *
 * - `latestDesiredEnvelope`: the newest publication's signed envelope.
 * - `recordDesiredAck`: the controller's verdict for one revision, bound
 *   to the stored publication's digests; ack state transitions are
 *   enforced atomically by the store.
 *
 * Errors are `VrtControlError`; progress/diagnostics go through the
 * injected `ControlLogger` (no-op by default).
 */
import type { VrtControlStore, VrtStorePublicationDetail } from './vrtStorePort.js'
import {
  partialStuckMs,
  vrtAckDiagnostics,
  desiredWorkerVersions,
  type VrtDesiredAckInput,
  type VrtCellApplyFailedMark,
} from './cellContract.js'
import { VrtControlError } from './errors.js'
import { noopControlLogger, type ControlLogger } from './logging.js'

export * from './cellContract.js'

export async function latestDesiredEnvelope(
  store: VrtControlStore,
  cellId: string,
  opts: { bootstrap?: () => Promise<'published' | 'exists' | 'disabled'> } = {}
): Promise<Record<string, unknown>> {
  let publication = await store.latestPublication(cellId)
  if (!publication && opts.bootstrap) {
    const outcome = await opts.bootstrap()
    if (outcome !== 'disabled') publication = await store.latestPublication(cellId)
  }
  if (!publication) {
    throw new VrtControlError(404, 'No desired publication for this cell', 'VRT_DESIRED_NOT_FOUND')
  }
  if (!publication.envelope || typeof publication.envelope !== 'object') {
    // A publication without stored bytes is a control-plane data error —
    // fail closed rather than serving a truncated document.
    throw new VrtControlError(500, 'Desired publication is missing its envelope')
  }
  return publication.envelope as Record<string, unknown>
}

/** Record the cell-controller ack for `(cellId, revision)`; returns the
 * row after the write.
 *
 * `ackedAt` is ALWAYS the server clock — a cell-reported `appliedAt`
 * is validated at the route layer (bounded future skew) but never
 * trusted for persistence.
 *
 * State machine (enforced atomically by the store):
 *   PENDING → any status; PARTIAL → any status;
 *   APPLIED / REJECTED are terminal — a same-status replay is an
 *   idempotent 200, a different-status attempt is a 409
 *   `VRT_ACK_TERMINAL`. Concurrent conflicting acks race on the
 *   conditional UPDATE: exactly one wins; the loser gets `terminal`. */

export async function recordDesiredAck(
  store: VrtControlStore,
  cellId: string,
  input: VrtDesiredAckInput,
  opts: {
    /** MIG-5: invoked once per ack with the workers this ack newly
     * marked apply-failed (the exact rows `markWorkersDeployFailed`
     * wrote). Runs AFTER the mark committed — implementions must be
     * bounded and must not throw (errors are their own problem; the
     * ack verdict already persisted). */
    onCellApplyFailed?: (marks: readonly VrtCellApplyFailedMark[]) => Promise<void>
    /** Optional platform logger; tests/CLI default to a no-op. */
    logger?: ControlLogger
  } = {}
): Promise<VrtStorePublicationDetail> {
  const log = opts.logger ?? noopControlLogger
  const publication = await store.findPublication(cellId, input.revision)
  if (!publication) {
    // The revision does not exist for this cell — the claimed document
    // cannot be bound to anything we published.
    throw new VrtControlError(
      404,
      'Unknown desired publication revision',
      'VRT_ACK_UNKNOWN_REVISION'
    )
  }
  if (publication.payloadDigest !== input.payloadDigest) {
    // Binding failure: the acked document is not the one we published.
    throw new VrtControlError(
      409,
      'payloadDigest does not match the publication',
      'VRT_ACK_DIGEST_MISMATCH'
    )
  }
  if (publication.envelopeDigest !== input.envelopeDigest) {
    throw new VrtControlError(
      409,
      'envelopeDigest does not match the publication',
      'VRT_ACK_DIGEST_MISMATCH'
    )
  }
  // F5: the cell's persisted fence is the floor the control plane must
  // not sign under — raise the stored counter toward it inside the
  // per-cell lock (bounded delta; anomalies are warned, not raised).
  await store.raiseCellRevisionFloor(publication.clusterId, input.fenceRevision)
  // T21: capability bits ride the same ACK — latest report wins. Only a
  // syntactically-present field writes; old cells keep null.
  if (input.capabilities) {
    // RV-R58: a report REPLACES the stored set (setCapabilities writes the
    // whole object) — a bit the cell did not send is never carried over
    // from an older report, and every reader treats non-`true` as false.
    await store.recordCellCapabilities(publication.clusterId, input.capabilities)
  }
  const now = new Date() // server clock — the cell's clock is untrusted
  const outcome = await store.recordPublicationAck(cellId, input.revision, {
    status: input.status,
    ackedAt: now,
    envelopeDigest: publication.envelopeDigest,
    reason: input.reason ?? null,
    tenantFailures: input.tenantFailures,
  })
  if (outcome === 'terminal') {
    // The row already carries a DIFFERENT terminal verdict — a late or
    // conflicting ack must not downgrade it.
    throw new VrtControlError(409, 'ack status is terminal for this revision', 'VRT_ACK_TERMINAL')
  }
  if (input.status === 'PARTIAL') {
    const stuckMs = now.getTime() - publication.issuedAt.getTime()
    if (stuckMs > partialStuckMs()) {
      vrtAckDiagnostics.stuckPartialAcks++
      log.warn(
        { cellId, revision: input.revision, stuckMs, reason: input.reason },
        '[Workers] compute.desired publication still PARTIAL past stuck threshold'
      )
    }
  }
  if (input.status === 'REJECTED') {
    // A cell rejected a signed publication — deterministic failure, the
    // cell is running but refuses our document. Escalate (F6).
    log.error(
      { cellId, revision: input.revision, reason: input.reason },
      '[Workers] compute.desired publication REJECTED by cell controller'
    )
  }
  if (outcome === 'missing') {
    // findPublication succeeded moments ago — disappearance means the
    // row was deleted between the two reads; treat as unknown.
    throw new VrtControlError(
      404,
      'Unknown desired publication revision',
      'VRT_ACK_UNKNOWN_REVISION'
    )
  }
  // MIG-1b: a tenant-level failure is the deploy verdict for the
  // workers whose DESIRED content actually changed at this revision —
  // the changed set is computed from server-side publications, never
  // from the ack itself:
  //   changed(w) = payload.activeVersion.versionId differs between the
  //   acked revision and the last APPLIED revision (added or rolled).
  // Candidates come from the ack's workerIds (or the whole tenant when
  // the failure is tenant-wide); marked = candidates ∩ changed ∩
  // tenant-match. Unchanged siblings keep serving the old generation
  // and are only visible as status diagnostics. When no APPLIED
  // baseline exists we cannot prove what changed — fail closed = mark
  // NOTHING (diagnostics still persist in ackTenantFailures).
  const failures = (input.tenantFailures ?? []).slice(0, 64)
  const failedWorkerIds = new Set<string>()
  const failedTeamIds = new Set<string>()
  for (const f of failures) {
    if (f.workerIds !== undefined) {
      for (const id of f.workerIds.slice(0, 64)) failedWorkerIds.add(id)
    } else {
      // Tenant-wide verdict — every worker of that tenant on the cell
      // is a candidate; recovery must not lift any of them either.
      failedTeamIds.add(f.tenant)
    }
  }

  const markedWorkerIds = new Set<string>()
  // MIG-6 second defense line: a failure set is only ATTRIBUTABLE to
  // this revision when the verdict proves the pod set loaded it —
  // `APPLIED` (incl. the terminal-fallback APPLIED+failures) or the
  // MIG-4 `tenant-failed` PARTIAL. A `pods-not-applied:*` or other
  // pod-level PARTIAL means at least one pod never proved this
  // revision — its reported set can be an OLDER generation's
  // leftovers that pre-MIG-6 cells forward verbatim (the 2026-11-16
  // incident). The server cannot see per-pod loaded state; the typed
  // reason is the closest provenance signal it has, so those sets
  // stay diagnostics-only — they still persist on the row and still
  // gate recovery below, but never mark or roll back. A pre-MIG-4
  // cell that sends NO reason keeps the old marking behavior.
  const failuresMarkable =
    input.status === 'APPLIED' || input.reason === undefined || input.reason === 'tenant-failed'
  if (failures.length > 0 && failuresMarkable) {
    const curVersions = desiredWorkerVersions(publication.envelope)
    const priorApplied = await store.latestAppliedPublicationBelow(cellId, input.revision)
    const prevVersions = priorApplied ? desiredWorkerVersions(priorApplied.envelope) : null
    if (curVersions === null || prevVersions === null) {
      log.warn(
        { cellId, revision: input.revision, baseline: priorApplied?.revision ?? null },
        '[Workers] tenant failures reported but changed set undeterminable — diagnostics only'
      )
    } else {
      const changed = new Map<string, { versionId: string; tenantId: string }>()
      for (const [wid, cur] of curVersions) {
        const prev = prevVersions.get(wid)
        if (!prev || prev.versionId !== cur.versionId) changed.set(wid, cur)
      }
      // MIG-5: the publication's own mutation target joins the changed
      // set even when its payload version equals the baseline's — a
      // rollback revision (user- or auto-) RE-activates the same
      // version it already served, so the deploy verdict still applies
      // to it (without this, a failed rollback target could never be
      // marked and oscillation could not be detected).
      const mutated =
        publication.workerId !== null && publication.versionId !== null
          ? curVersions.get(publication.workerId)
          : undefined
      if (
        publication.workerId !== null &&
        publication.versionId !== null &&
        mutated !== undefined &&
        mutated.versionId === publication.versionId &&
        !changed.has(publication.workerId)
      ) {
        changed.set(publication.workerId, mutated)
      }
      for (const failure of failures) {
        // ACK tenant is cross-checked against the payload's own tenant
        // attribution here AND the worker's teamId inside the store.
        const candidates =
          failure.workerIds !== undefined
            ? failure.workerIds.slice(0, 64)
            : [...changed.entries()]
                .filter(([, v]) => v.tenantId === failure.tenant)
                .map(([id]) => id)
        const toMark = candidates
          .filter((id) => changed.get(id)?.tenantId === failure.tenant)
          .map((id) => ({ workerId: id, versionId: changed.get(id)!.versionId }))
        if (toMark.length === 0) continue
        const marked = await store.markWorkersDeployFailed({
          tenant: failure.tenant,
          workers: toMark,
          code: failure.code,
          revision: input.revision,
        })
        for (const id of marked) markedWorkerIds.add(id)
        if (marked.length > 0) {
          log.warn(
            {
              cellId,
              revision: input.revision,
              tenant: failure.tenant,
              code: failure.code,
              marked: marked.length,
            },
            '[Workers] cell reported tenant apply failure — changed workers marked FAILED'
          )
          // MIG-5: hand the exact marked set to the rollback hook. The
          // fallback proof is the baseline APPLIED publication — a
          // worker whose baseline entry is absent (first deploy) or
          // whose baseline ack already reported it/its tenant failing
          // has NO proven-good version to return to (fail closed).
          //
          // MIG-6 provenance rule (fail closed, no false negatives):
          // a pre-MIG-6 cell could attribute an older generation's
          // failure set to the baseline revision's PARTIAL window and
          // the leftover set then lingered on the APPLIED row forever.
          // A named failure set therefore disqualifies the baseline —
          // UNLESS the baseline's own ack already PROVED the worker
          // served its version there: the `worker.deploy.cell_recovered`
          // op-log the SAME revision's APPLIED verdict wrote when it
          // lifted the worker's earlier cell mark. The evidence is
          // server-side (the ack payload itself is never proof), so a
          // dirty row written by a stale PARTIAL cannot poison a
          // proven-good fallback — while a legacy dirty row with no
          // recovery evidence still declines.
          const baselineFailed = async (workerId: string, tenant: string) => {
            const named = (priorApplied?.ackTenantFailures ?? []).some(
              (f) =>
                f.tenant === tenant && (f.workerIds === undefined || f.workerIds.includes(workerId))
            )
            if (!named || !priorApplied) return false
            return !(await store.workerCellApplyRecoveredAtRevision(
              workerId,
              priorApplied.revision
            ))
          }
          const marks: VrtCellApplyFailedMark[] = []
          for (const workerId of marked) {
            const prev = prevVersions.get(workerId)
            const baselineRejected =
              prev !== undefined && (await baselineFailed(workerId, failure.tenant))
            const rollbackVersionId = prev && !baselineRejected ? prev.versionId : null
            marks.push({
              workerId,
              teamId: failure.tenant,
              clusterId: publication.clusterId,
              failedVersionId: changed.get(workerId)!.versionId,
              rollbackVersionId,
              baselineFailed: prev === undefined ? false : baselineRejected,
              code: failure.code,
              markRevision: input.revision,
            })
          }
          if (opts.onCellApplyFailed) {
            try {
              await opts.onCellApplyFailed(marks)
            } catch (error) {
              // Rollback is best-effort remediation — the ack verdict
              // and the FAILED mark are already persisted; a hook bug
              // must never turn into an ack failure.
              log.error(
                { err: error, cellId, revision: input.revision, tenant: failure.tenant },
                '[Workers] cell-apply-failed hook threw'
              )
            }
          }
        }
      }
    }
  }

  // MIG-1b recovery: a later APPLIED ack (revision >= the mark's) that
  // no longer lists a worker lifts ONLY cell-marked failures — a
  // REJECTED/PARTIAL ack proves nothing applied, and anything else
  // (manual, pack, runtime errors) is untouched; the per-row
  // conditional update inside the store makes it atomic.
  // MIG-7: PARTIAL-scope recovery — a same-revision PARTIAL that
  // PROVES every pod loaded this revision but no longer names a worker
  // lifts that worker's same-revision mark (the mig-hz incident: a
  // sibling can stay broken forever so the revision never APPLIES).
  // Evidence is typed, never inferred: `tenant-failed` reason (the
  // cell emits it only when all pods applied — MIG-4) or an explicit
  // `podsApplied: true`. Any other PARTIAL — `pods-not-applied:*`,
  // free-form pod reasons, or a pre-MIG-4 cell's reason-less verdict —
  // proves nothing and recovers nothing (fail closed). The
  // `markRevision` pin keeps recovery inside THIS revision: a stale
  // mark from an older revision survives (only an APPLIED at a
  // covering revision or a new deploy clears it), and a worker whose
  // marker revision differs — in either direction — is untouched.
  const partialProvesApplied =
    input.status === 'PARTIAL' &&
    (input.reason === 'tenant-failed' ||
      // `podsApplied` alone (no reason text) also proves it; a
      // reason that says anything else — `pods-not-applied`, pod
      // diagnostics — means ambiguity, which never recovers.
      (input.podsApplied === true && input.reason === undefined))
  const recovered =
    input.status === 'APPLIED'
      ? await store.recoverCellDeployFailures({
          clusterId: publication.clusterId,
          ackRevision: input.revision,
          excludeWorkerIds: new Set([...failedWorkerIds, ...markedWorkerIds]),
          excludeTeamIds: failedTeamIds,
        })
      : partialProvesApplied
        ? await store.recoverCellDeployFailures({
            clusterId: publication.clusterId,
            ackRevision: input.revision,
            excludeWorkerIds: new Set([...failedWorkerIds, ...markedWorkerIds]),
            excludeTeamIds: failedTeamIds,
            markRevision: input.revision,
          })
        : []
  if (recovered.length > 0) {
    log.info(
      {
        cellId,
        revision: input.revision,
        scope: input.status === 'APPLIED' ? 'applied' : 'partial',
        recovered: recovered.length,
      },
      '[Workers] cell apply failures cleared by ack — workers recovered'
    )
  }
  const updated = await store.findPublication(cellId, input.revision)
  return updated ?? publication
}
