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
