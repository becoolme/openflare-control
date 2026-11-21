/**
 * Hyperdrive target codec — pure, dependency-free identity minting for
 * the typed target kinds a `[[hyperdrive]]` binding can point at. Shared
 * by the control-plane adapter (resourceId), `computeDesired` (credential
 * ref + synthetic-host identity) and render-inputs (ref → payload), so the
 * three never disagree on a namespace.
 *
 * Namespaces (server-minted — a worker can never supply any of them):
 *   tenant   resourceId `vrtpg:<tenantId>`     credRef `vrtpgcred:<id>`   bindingId `vrthd:<id>:<name>`
 *   database resourceId `vrtdb:<databaseId>`   credRef `vrtdbcred:<id>`  bindingId `vrthdb:<id>:<name>`
 *
 * The tenant namespace is unchanged from MIG-15 (existing rows stay valid).
 * See doc/platform/workers-runtime-hyperdrive.md.
 */
import { VRT_PG_CREDENTIAL_PREFIX, VRT_PG_RESOURCE_PREFIX } from './pgBindingConstants.js'

export type VrtHyperdriveTargetKind = 'tenant' | 'database'

interface Namespace {
  readonly resourcePrefix: string
  readonly credentialPrefix: string
  readonly bindingIdPrefix: string
}

export const VRT_DB_RESOURCE_PREFIX = 'vrtdb:'
export const VRT_DB_CREDENTIAL_PREFIX = 'vrtdbcred:'

const NAMESPACES: Readonly<Record<VrtHyperdriveTargetKind, Namespace>> = {
  tenant: {
    resourcePrefix: VRT_PG_RESOURCE_PREFIX,
    credentialPrefix: VRT_PG_CREDENTIAL_PREFIX,
    bindingIdPrefix: 'vrthd:',
  },
  database: {
    resourcePrefix: VRT_DB_RESOURCE_PREFIX,
    credentialPrefix: VRT_DB_CREDENTIAL_PREFIX,
    bindingIdPrefix: 'vrthdb:',
  },
}

const KINDS = Object.keys(NAMESPACES) as VrtHyperdriveTargetKind[]

export function hyperdriveResourceId(kind: VrtHyperdriveTargetKind, targetId: string): string {
  return `${NAMESPACES[kind].resourcePrefix}${targetId}`
}
export function hyperdriveCredentialRef(kind: VrtHyperdriveTargetKind, targetId: string): string {
  return `${NAMESPACES[kind].credentialPrefix}${targetId}`
}
export function hyperdriveBindingId(
  kind: VrtHyperdriveTargetKind,
  targetId: string,
  bindingName: string
): string {
  return `${NAMESPACES[kind].bindingIdPrefix}${targetId}:${bindingName}`
}

/** `vrtpg:<id>` / `vrtdb:<id>` → typed ref; anything else → null (fail
 * closed — an unknown namespace is never guessed). */
export function parseHyperdriveResourceId(
  resourceId: string
): { kind: VrtHyperdriveTargetKind; targetId: string } | null {
  for (const kind of KINDS) {
    const prefix = NAMESPACES[kind].resourcePrefix
    if (resourceId.startsWith(prefix)) {
      const targetId = resourceId.slice(prefix.length)
      return targetId ? { kind, targetId } : null
    }
  }
  return null
}
