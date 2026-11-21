/**
 * Typed route-base label policy for `vrt_runtime.routeBaseDomains`.
 *
 * A route base is either a plain FQDN string (legacy form, any single label
 * is claimable) or `{ domain, labelPrefix }` where only single labels that
 * start with `labelPrefix` (e.g. `w-`) are claimable.  The prefixed form lets
 * the platform share an apex with application hostnames (`*.vibeploy.app`)
 * without ever colliding: application hostname creation rejects the prefix
 * space (see `isVrtPrefixedHostname`), and VRT claims accept only it.
 *
 * Pure module: no I/O, safe to import from the application domain services.
 */
import { z } from 'zod'

export interface RouteBasePolicy {
  readonly domain: string
  /** Lowercase, ends with `-`. Absent = legacy "any single label". */
  readonly labelPrefix?: string
}

/** `w-`, `vrt-` ... : starts with a letter, <=16 chars, ends with `-`. */
export const ROUTE_LABEL_PREFIX_RE = /^[a-z][a-z0-9-]{0,14}-$/
const MAX_LABEL = 63

export const routeBasePrefixSchema = z
  .string()
  .regex(ROUTE_LABEL_PREFIX_RE, 'labelPrefix must be lowercase letters/digits/hyphen ending in "-"')

export function routeBaseEntryObjectSchema(domain: z.ZodType<string>) {
  return z.object({ domain, labelPrefix: routeBasePrefixSchema.optional() }).strict()
}

/** Normalize a mixed string/object list; `null` = invalid (conflicting
 * duplicates for one domain), callers fail closed. */
export function normalizeRouteBases(
  entries: ReadonlyArray<string | { domain: string; labelPrefix?: string }>
): RouteBasePolicy[] | null {
  const byDomain = new Map<string, RouteBasePolicy>()
  for (const e of entries) {
    const p: RouteBasePolicy =
      typeof e === 'string'
        ? { domain: e }
        : { domain: e.domain, ...(e.labelPrefix ? { labelPrefix: e.labelPrefix } : {}) }
    const prev = byDomain.get(p.domain)
    if (prev && prev.labelPrefix !== p.labelPrefix) return null
    byDomain.set(p.domain, p)
  }
  return [...byDomain.values()]
}

/** Does a single label satisfy the policy's claimable-label shape? */
export function routeLabelMatchesPolicy(label: string, policy: RouteBasePolicy): boolean {
  if (label.length === 0 || label.length > MAX_LABEL) return false
  if (!policy.labelPrefix) return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)
  if (!label.startsWith(policy.labelPrefix)) return false
  // `^<prefix>[a-z0-9]([a-z0-9-]*[a-z0-9])?$`
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label.slice(policy.labelPrefix.length))
}

/** If `hostname` is exactly `<label>.<domain>` for a PREFIXED policy and the
 * label is in that prefix namespace (starts with the prefix, valid or not),
 * return the policy. Used by both directions of the mutual-exclusion guard. */
export function matchPrefixedRouteBase(
  hostname: string,
  policies: readonly RouteBasePolicy[]
): RouteBasePolicy | undefined {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  for (const p of policies) {
    if (!p.labelPrefix) continue
    const suffix = `.${p.domain}`
    if (!h.endsWith(suffix)) continue
    const label = h.slice(0, -suffix.length)
    if (!label.includes('.') && label.startsWith(p.labelPrefix)) return p
  }
  return undefined
}

/** Reverse guard predicate: application hostnames must stay out of every
 * configured vrt prefix namespace. */
export function isVrtPrefixedHostname(
  hostname: string,
  policies: readonly RouteBasePolicy[]
): boolean {
  return matchPrefixedRouteBase(hostname, policies) !== undefined
}

/** Wildcard guard: a wildcard base domain `d` (covering `*.d`) must not be a
 * configured prefixed base domain nor sit above one. */
export function wildcardOverlapsVrtPrefix(
  baseDomain: string,
  policies: readonly RouteBasePolicy[]
): boolean {
  const b = baseDomain.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
  return policies.some((p) => !!p.labelPrefix && (p.domain === b || p.domain.endsWith(`.${b}`)))
}
