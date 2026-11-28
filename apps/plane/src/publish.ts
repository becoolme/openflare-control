/**
 * Publish the cell's desired state (used by the CLI and the seed command).
 * The revision is allocated under the cell row lock and the signed envelope
 * is recorded in the same transaction, so two publishes can never interleave.
 */
import {
  signAndRecordCellPublication,
  type SnapshotSigningContext,
  type VrtControlStore,
} from 'openflare-control'

export async function publishCell(
  store: VrtControlStore,
  opts: {
    cellId: string
    signing: SnapshotSigningContext
    cause?: string
    workerId?: string | null
    versionId?: string
  }
): Promise<number> {
  return store.runCellTransaction(opts.cellId, async (tx) => {
    if (!(await tx.lockCell())) throw new Error(`cell ${opts.cellId} has no state row`)
    const revision = await tx.allocateRevision()
    await signAndRecordCellPublication(tx, {
      revision,
      cause: opts.cause ?? 'DEPLOY',
      workerId: opts.workerId ?? null,
      versionId: opts.versionId,
      publishedById: null,
      now: new Date(),
      signing: opts.signing,
    })
    return revision
  })
}

/**
 * Best-effort automatic publish after a mutation that changes the cell's
 * desired state. Explicit deploys batch-create+activate+publish in one call,
 * but lifecycle mutations (worker delete, hostname/vars/secrets changes,
 * version activation) have no console-side "publish" step — without an
 * automatic publish the mutation would land in the database yet never reach
 * a cell, so e.g. a deleted worker would keep serving traffic. When signing
 * is not configured nothing can ever propagate, so the publish is skipped
 * silently; with signing configured a failure is a real infrastructure error
 * and surfaces to the caller.
 */
export async function autoPublishCell(
  deps: { store: VrtControlStore; signing?: SnapshotSigningContext | null },
  cellId: string,
  cause: string,
  workerId?: string | null
): Promise<number | null> {
  if (!deps.signing) return null
  return publishCell(deps.store, {
    cellId,
    signing: deps.signing,
    cause,
    workerId: workerId ?? null,
  })
}
