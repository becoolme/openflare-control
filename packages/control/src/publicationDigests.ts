/** GC1: bundle-digest extraction from signed desired-publication
 * envelopes — the single parser shared by the cell bundle route
 * (per-cell allowlist) and the bundle GC (global live set). Envelopes
 * are trusted server-side documents; every field is read defensively so
 * a malformed row can never widen the derived set.
 *
 * A digest is LIVE when any retained `vrt_desired_publications` row
 * references it: a cell may still be loading that snapshot, so deleting
 * the object would turn a valid serve into a fetch 404.
 */
import { z } from 'zod'

/** 64-hex sha256 digest — the bundle key's content identity. */
export const bundleDigestSchema = z.string().regex(/^[0-9a-f]{64}$/)

/** Walk one stored envelope JSON → the artifact digests its
 * `tenants[].workers[].activeVersion` references. */
export function bundleDigestsInEnvelope(envelope: unknown): Set<string> {
  const out = new Set<string>()
  const tenants = (envelope as { payload?: { tenants?: unknown } } | null)?.payload?.tenants
  if (!Array.isArray(tenants)) return out
  for (const tenant of tenants) {
    if (tenant === null || typeof tenant !== 'object') continue
    const workers = (tenant as { workers?: unknown }).workers
    if (!Array.isArray(workers)) continue
    for (const worker of workers) {
      if (worker === null || typeof worker !== 'object') continue
      const digest = (worker as { activeVersion?: { artifactDigest?: unknown } }).activeVersion
        ?.artifactDigest
      if (typeof digest === 'string' && bundleDigestSchema.safeParse(digest).success) {
        out.add(digest)
      }
    }
  }
  return out
}

/** Union of `bundleDigestsInEnvelope` over rows — the GC's live set.
 * The publication table is bounded by the retention sweep
 * (~keepPerCell per cell + non-terminal acks); `cap` is a fail-closed
 * bound — exceeding it returns `null` so the caller can skip the round
 * rather than guess at liveness. */
export function liveBundleDigestsFromRows(
  envelopes: readonly unknown[],
  cap: number
): Set<string> | null {
  if (envelopes.length > cap) return null
  const live = new Set<string>()
  for (const envelope of envelopes) {
    for (const d of bundleDigestsInEnvelope(envelope)) live.add(d)
  }
  return live
}
