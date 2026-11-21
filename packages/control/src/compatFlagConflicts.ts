/**
 * RV-R137 — single-source compat-flag conflict rule.
 *
 * A tenant flag list is contradictory when it repeats a flag or declares both
 * members of an [enable, disable] pair generated from the vendored capnp
 * (`COMPAT_FLAG_CONFLICT_PAIRS`). workerd refuses such a config, which would
 * fail the whole cell's preflight — so the control plane rejects it at deploy
 * time (422 COMPAT_FLAG_CONFLICT) and excludes any pre-existing conflicting
 * version per worker in compute.desired instead of failing the cell.
 */
import { VrtControlError } from './errors.js'
import { COMPAT_FLAG_CONFLICT_PAIRS } from './compatFlags.js'

export const COMPAT_FLAG_CONFLICT_CODE = 'COMPAT_FLAG_CONFLICT'

export interface CompatFlagConflict {
  readonly kind: 'duplicate' | 'pair'
  readonly flags: readonly string[]
}

const PARTNER = new Map<string, string>()
for (const [enable, disable] of COMPAT_FLAG_CONFLICT_PAIRS) {
  PARTNER.set(enable, disable)
  PARTNER.set(disable, enable)
}

/** First conflict in `flags` (stable order), or null when consistent. */
export function findCompatFlagConflict(flags: readonly string[]): CompatFlagConflict | null {
  const seen = new Set<string>()
  for (const flag of flags) {
    if (seen.has(flag)) return { kind: 'duplicate', flags: [flag] }
    const partner = PARTNER.get(flag)
    if (partner !== undefined && seen.has(partner)) return { kind: 'pair', flags: [partner, flag] }
    seen.add(flag)
  }
  return null
}

export function describeCompatFlagConflict(conflict: CompatFlagConflict): string {
  return conflict.kind === 'duplicate'
    ? `compatibility flag "${conflict.flags[0]}" is declared more than once`
    : `compatibility flags "${conflict.flags[0]}" and "${conflict.flags[1]}" contradict each other`
}

export class CompatFlagConflictError extends VrtControlError {
  constructor(conflict: CompatFlagConflict) {
    super(422, describeCompatFlagConflict(conflict), COMPAT_FLAG_CONFLICT_CODE)
  }
}

export function assertNoCompatFlagConflict(flags: readonly string[]): void {
  const conflict = findCompatFlagConflict(flags)
  if (conflict) throw new CompatFlagConflictError(conflict)
}
