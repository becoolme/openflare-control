/**
 * Field-level validators mirroring `snapshot-protocol`'s `compute_desired.rs`
 * `validate()` rules. The control plane validates every value BEFORE it is
 * signed so an invalid desired snapshot can never be produced; the Rust side
 * re-validates everything again on receipt (fail closed at both ends).
 */
import { z } from 'zod'
import { VrtControlError } from './errors.js'
import { routeLabelMatchesPolicy, type RouteBasePolicy } from './vrtRouteBasePolicy.js'
import { WORKER_BINDING_NAME_MAX_LEN } from './bindingName.js'

// Bounds — identical to compute_desired.rs constants.
export const VRT_MAX_TENANTS = 512
export const VRT_MAX_WORKERS_PER_TENANT = 256
export const VRT_MAX_BINDINGS_PER_WORKER = 64
export const VRT_MAX_ROUTES_PER_WORKER = 64
export const VRT_MAX_CRONS_PER_WORKER = 32
export const VRT_MAX_COMPAT_FLAGS = 32
/** Bound for one `{"type":"json"}` literal binding (typed `[vars]`,
 * `[version_metadata]`) — same order as Cloudflare's value bound. */
export const VRT_MAX_JSON_BINDING_BYTES = 16 * 1024
export const VRT_MAX_IDENTIFIER_LEN = 128
export const VRT_MAX_REF_LEN = 256
export const VRT_MAX_WORKER_NAME_LEN = 63
export const VRT_MAX_BINDING_NAME_LEN = WORKER_BINDING_NAME_MAX_LEN
export const VRT_MAX_HOSTNAME_LEN = 253

/**
 * R2M: shape of a Cloudflare R2 bucket name (3-63 chars, lowercase
 * letters/digits/hyphens, alphanumeric at both ends). A migrated
 * wrangler config keeps `bucket_name = "<cf bucket>"`; the storage
 * registry keys the bucket by that name (`cf-<name>`), so workers that
 * declare the same bucket share it as on Cloudflare (see
 * `resolveBindingStorage`). Every VRT bucket storageId starts with `vrt-`, so a
 * name with that prefix is never treated as a Cloudflare name: a claim
 * on another team's platform bucket keeps failing closed.
 */
export function isCloudflareR2BucketName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) && !name.startsWith('vrt-')
}
export const VRT_MAX_COMPAT_FLAG_LEN = 64
export const VRT_MAX_CRON_EXPR_LEN = 128
export const VRT_MIN_CPU_MS = 1
export const VRT_MAX_CPU_MS = 300_000
export const VRT_MIN_MEMORY_MB = 1
export const VRT_MAX_MEMORY_MB = 4096
/** RV-R55: per-tenant effective committed memory — a tenant runs in ONE
 * workerd process whose RSS is capped by vrt-host `[limits] maxRssBytes`
 * (512 MiB), so its summed worker `memoryMb` never counts above this. */
export const VRT_TENANT_MAX_COMMIT_MB = 512
/** RV-R55: default committed-memory budget per cell (sum of tenant effective
 * commits). Deliberately an OVERCOMMIT figure vs the 1 GiB vrt-host container
 * (quotas are ceilings, not usage); operators of a smaller host pass a lower
 * typed budget. Absent/invalid budget never means "unbounded" — see
 * resolveCellMemoryBudgetMb. */
export const VRT_DEFAULT_CELL_MEMORY_BUDGET_MB = 32768
export const VRT_MAX_CELL_MEMORY_BUDGET_MB = 1_048_576
export const VRT_MAX_SUBREQUESTS = 10_000
// Matches snapshot-protocol MAX_OUTBOUND_CONNECTIONS — the pinned
// workerd itself rejects > 1000 at config load.
export const VRT_MAX_OUTBOUND_CONNECTIONS = 1000

/** Identifier charset identical to the protocol's `valid_identifier`. */
export function validVrtIdentifier(value: string, maxLen = VRT_MAX_IDENTIFIER_LEN): boolean {
  return value.length > 0 && value.length <= maxLen && /^[A-Za-z0-9_.:-]+$/.test(value)
}

/** Lowercase DNS label without `--` (the `<worker>--<team>` separator). */
export function validVrtWorkerName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= VRT_MAX_WORKER_NAME_LEN &&
    /^[a-z0-9-]+$/.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-') &&
    !value.includes('--')
  )
}

/** JS identifier for `env.<name>` bindings. */
export function validVrtBindingName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= VRT_MAX_BINDING_NAME_LEN &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
  )
}

/** Entrypoint-name prefixes reserved for platform-injected exports
 * (e.g. the `VrtWaituntilProbe` drain probe). Mirrors
 * `RESERVED_ENTRYPOINT_PREFIXES` in snapshot-protocol. */
export const VRT_RESERVED_ENTRYPOINT_PREFIXES = ['Vrt', 'vrt'] as const

/**
 * Named `WorkerEntrypoint` export a SERVICE binding targets. Same charset
 * and length as a binding name, never `default` (absent means the default
 * export), never a reserved platform prefix. Mirrors the protocol's
 * `valid_service_entrypoint`.
 */
export function validVrtServiceEntrypoint(value: string): boolean {
  return (
    validVrtBindingName(value) &&
    value !== 'default' &&
    !VRT_RESERVED_ENTRYPOINT_PREFIXES.some((p) => value.startsWith(p))
  )
}

/**
 * Back-compat re-export — the canonical schema lives in
 * `modules/workers/lib/bindingName.ts` under the runtime-neutral name
 * `workerBindingNameSchema` so shared route files never reference this
 * runtime's validator module (RV-R8 #0). It is the zod mirror of
 * `validVrtBindingName` — the single write-path rule for var keys,
 * secret names and binding names (RV-R2 #1).
 */
export { workerBindingNameSchema as vrtBindingNameSchema } from './bindingName.js'

/**
 * Per-worker write-path caps for locally stored vars and secrets (RV-R2 #1):
 * both land on the same env-binding surface that is already capped at deploy
 * by `VRT_MAX_BINDINGS_PER_WORKER`, so writes are bounded to the same number.
 */
export const MAX_WORKER_VARS_PER_WORKER = VRT_MAX_BINDINGS_PER_WORKER
export const MAX_WORKER_SECRETS_PER_WORKER = VRT_MAX_BINDINGS_PER_WORKER

/** R2-style bucket name: lowercase DNS label, 3–63 chars. */
export function validVrtBucketName(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9-]+$/.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-')
  )
}

/** Lowercase FQDN hostname — no wildcards, at least two labels, ASCII only.
 * Unicode/IDN input is rejected outright; callers must supply the A-label
 * (punycode `xn--` form) so a lookalike can never slip through. */
export function validVrtHostname(value: string): boolean {
  if (value.length === 0 || value.length > VRT_MAX_HOSTNAME_LEN) return false
  const labels = value.split('.')
  if (labels.length < 2) return false
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith('-') &&
      !label.endsWith('-')
  )
}

/** Normalize + validate an operator-supplied hostname. Rejects uppercase
 * (normalized), Unicode (rejected — requires the caller-supplied A-label),
 * and surrounding whitespace; returns the canonical lowercase hostname. */
export function normalizeVrtHostname(raw: string): string {
  const trimmed = raw.trim()
  if (/[^\x20-\x7e]/.test(trimmed)) {
    throw new VrtControlError(400, 'Hostname must be ASCII (supply the punycode A-label form)')
  }
  const normalized = trimmed.toLowerCase()
  if (!validVrtHostname(normalized)) {
    throw new VrtControlError(400, 'Invalid hostname')
  }
  return normalized
}

export function isLowerHex(value: string, len = 64): boolean {
  return value.length === len && /^[0-9a-f]+$/.test(value)
}

const CRON_MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]
const CRON_DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Standard 5-field cron expression: `minute hour day-of-month month
 * day-of-week`, supporting `*`, lists, ranges, steps and JAN–DEC / SUN–SAT
 * names plus the Cloudflare day modifiers (`L`/`LW`/`nW` in day-of-month,
 * `xL`/`x#n` in day-of-week). Day-of-week numbering is Cloudflare's
 * 1=Sunday..7=Saturday — mirrors `compute_desired.rs::valid_cron_expression`
 * exactly. */
export function validVrtCronExpression(value: string): boolean {
  // RV-R69 #3: Rust measures BYTES and splits on ASCII whitespace only
  // (`split_ascii_whitespace`: space \t \n \f \r). Reject every non-ASCII
  // char outright (NBSP, U+3000, ...) so UTF-16 length == byte length and
  // `\s` Unicode splitting can never accept what Rust rejects. The value
  // is stored verbatim (validation is identical on both sides).
  if (value.length === 0 || value.length > VRT_MAX_CRON_EXPR_LEN) return false
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 0x7f) return false
  const fields = value.split(/[ \t\n\f\r]+/).filter((f) => f.length > 0)
  if (fields.length !== 5) return false
  const spec: Array<[number, number, string[]]> = [
    [0, 59, []],
    [0, 23, []],
    [1, 31, []],
    [1, 12, CRON_MONTH_NAMES],
    [1, 7, CRON_DOW_NAMES],
  ]
  return fields.every((field, index) => {
    if (field.length === 0) return false
    if (index === 2) return validCronDomField(field)
    if (index === 4) return validCronDowField(field, CRON_DOW_NAMES)
    return field.split(',').every((part) => validCronPart(part, ...spec[index]!, false))
  })
}

/** Day-of-month field: plain cron parts plus the Cloudflare modifiers —
 * bare `L` (last day) and `LW` (last weekday), case-insensitive, and `nW`
 * (the weekday nearest day `n`, 1–31). */
function validCronDomField(field: string): boolean {
  return field.split(',').every((part) => {
    if (part.toLowerCase() === 'l' || part.toLowerCase() === 'lw') return true
    const day = stripAsciiModifier(part, 'W')
    if (day !== null) {
      if (!/^\d+$/.test(day)) return false
      const n = parseInt(day, 10)
      return n >= 1 && n <= 31
    }
    return validCronPart(part, 1, 31, [], false)
  })
}

/** Day-of-week field: plain cron parts plus `x#n` (the nth x-weekday,
 * n 1–5) and `xL` (the last x-weekday), where x is a day name or 1–7. */
function validCronDowField(field: string, names: string[]): boolean {
  return field.split(',').every((part) => {
    const hash = part.indexOf('#')
    if (hash >= 0) {
      const day = part.slice(0, hash)
      const occurrence = part.slice(hash + 1)
      if (!/^\d+$/.test(occurrence)) return false
      const n = parseInt(occurrence, 10)
      return validCronDowAtom(day, names) && n >= 1 && n <= 5
    }
    const day = stripAsciiModifier(part, 'L')
    if (day !== null) return validCronDowAtom(day, names)
    return validCronPart(part, 1, 7, names, true)
  })
}

function validCronDowAtom(value: string, names: string[]): boolean {
  if (names.some((n) => value.toLowerCase() === n)) return true
  if (!/^\d+$/.test(value)) return false
  const n = parseInt(value, 10)
  return n >= 1 && n <= 7
}

/** Strip exactly one trailing `modifier` (either case); null when absent. */
function stripAsciiModifier(value: string, modifier: string): string | null {
  if (value.endsWith(modifier) || value.endsWith(modifier.toLowerCase())) {
    return value.slice(0, -1)
  }
  return null
}

function validCronPart(
  part: string,
  min: number,
  max: number,
  names: string[],
  dow = false
): boolean {
  let base = part
  const slash = part.indexOf('/')
  if (slash >= 0) {
    const step = part.slice(slash + 1)
    base = part.slice(0, slash)
    if (step.length === 0 || step.includes('/')) return false
    if (!/^\d+$/.test(step)) return false
    const stepNum = parseInt(step, 10)
    if (stepNum < 1 || stepNum > max) return false
  }
  const atom = (value: string): boolean => {
    if (names.some((n) => value.toLowerCase() === n)) return true
    if (!/^\d+$/.test(value)) return false
    const n = parseInt(value, 10)
    return n >= min && n <= max
  }
  const atomValue = (value: string, rangeHi = false): number | null => {
    if (/^\d+$/.test(value)) {
      const n = parseInt(value, 10)
      if (n < min || n > max) return null
      // Numeric DOW atoms convert from Cloudflare's 1=Sunday..7=Saturday to
      // internal 0-based ordering; other fields order on the value itself.
      return dow ? n - 1 : n
    }
    const idx = names.indexOf(value.toLowerCase())
    if (idx < 0) return null
    // DOW range upper bound: name SUN reads as 7 (`FRI-SUN`). DOW names
    // otherwise order on their 0-based index; non-DOW names on idx + min.
    if (rangeHi && dow && idx === 0) return 7
    return dow ? idx : idx + min
  }
  const dash = base.indexOf('-')
  if (dash >= 0) {
    const lo = base.slice(0, dash)
    const hi = base.slice(dash + 1)
    if (lo.length === 0 || hi.length === 0 || !atom(lo) || !atom(hi)) return false
    const l = atomValue(lo)
    const h = atomValue(hi, true)
    return l !== null && h !== null && l <= h
  }
  return base === '*' || atom(base)
}

/** Strict `YYYY-MM-DD` (zero-padded, real calendar date). */
export function validVrtCompatDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

/** Compatibility-flag token (`[A-Za-z0-9_+.-]` ≤64). */
export function validVrtCompatFlag(value: string): boolean {
  return (
    value.length > 0 && value.length <= VRT_MAX_COMPAT_FLAG_LEN && /^[A-Za-z0-9_+.-]+$/.test(value)
  )
}

export const vrtQuotaSchema = z
  .object({
    cpuMs: z.number().int().min(VRT_MIN_CPU_MS).max(VRT_MAX_CPU_MS),
    memoryMb: z.number().int().min(VRT_MIN_MEMORY_MB).max(VRT_MAX_MEMORY_MB),
    subrequests: z.number().int().min(0).max(VRT_MAX_SUBREQUESTS),
    outboundConnections: z.number().int().min(0).max(VRT_MAX_OUTBOUND_CONNECTIONS),
  })
  .strict()

export const VRT_DEFAULT_QUOTAS = Object.freeze({
  cpuMs: 50,
  memoryMb: 128,
  subrequests: 50,
  outboundConnections: 16,
})

/**
 * Route-label blocklist for `vrt_runtime.routeBaseDomains` hostname claims.
 * Reserving obvious platform/infra labels prevents a tenant from squatting
 * names operators or customers would reasonably assume are ours.
 */
export const VRT_ROUTE_LABEL_BLOCKLIST: ReadonlySet<string> = new Set([
  'www',
  'api',
  'admin',
  'dashboard',
  'console',
  'panel',
  'app',
  'mail',
  'smtp',
  'status',
  'cdn',
  'static',
  'assets',
  'media',
  'docs',
  'help',
  'support',
  'billing',
  'pay',
  'shop',
  'store',
  'blog',
  'forum',
  'wiki',
  'news',
  'dev',
  'staging',
  'prod',
  'production',
  'test',
  'demo',
  'beta',
  'canary',
  'internal',
  'intranet',
  'vpn',
  'ssh',
  'ftp',
  'git',
  'ci',
  'registry',
  'login',
  'auth',
  'oauth',
  'sso',
  'account',
  'accounts',
  'signup',
  'register',
  'metrics',
  'monitor',
  'grafana',
  'kibana',
  'logs',
  'log',
  'trace',
  'tracing',
  'db',
  'database',
  'sql',
  'redis',
  'cache',
  'queue',
  'backup',
  'backups',
  'download',
  'downloads',
  'upload',
  'uploads',
  'files',
  'storage',
  'img',
  'images',
  'video',
  'videos',
  'ns1',
  'ns2',
  'mx',
  'localhost',
  'root',
  'system',
  'kernel',
  'postmaster',
  'webmaster',
  'hostmaster',
  'abuse',
  'noc',
  'security',
  'vibeploy',
  'vrt',
  'wdl',
  'gateway',
  'proxy',
  'egress',
  'cell',
  'worker',
  'workers',
])

/**
 * Enforce the MVP route policy: `normalized` must be exactly
 * `<single-label>.<baseDomain>` for some configured base domain.
 *  - empty base list            → reject everything (fail closed)
 *  - the bare base domain       → rejected (it is the platform's own name)
 *  - deeper subdomains          → rejected (only one tenant label allowed)
 *  - blocklisted label          → rejected
 * All rejections are typed 403 `VRT_HOSTNAME_NOT_ALLOWED`. The caller must
 * pass an already-normalized lowercase hostname (`normalizeVrtHostname`).
 */
export function assertVrtRouteHostnameAllowed(
  normalized: string,
  routeBases: ReadonlyArray<string | RouteBasePolicy>
): void {
  const denied = (detail: string) =>
    new VrtControlError(
      403,
      `VRT route hostname not allowed: ${detail}`,
      'VRT_HOSTNAME_NOT_ALLOWED'
    )

  if (routeBases.length === 0) {
    throw denied('no route base domains configured')
  }
  const policies: RouteBasePolicy[] = routeBases.map((b) =>
    typeof b === 'string' ? { domain: b } : b
  )
  const labels = normalized.split('.')
  // Longest-suffix match (T9/M7): pick the configured base covering the
  // MOST labels so `x.apps.example.com` under bases
  // [example.com, apps.example.com] is judged against apps.example.com —
  // not rejected by the shorter first match. Any configured base itself
  // is never claimable (it is the platform's own name).
  let matched: { policy: RouteBasePolicy; labelCount: number } | null = null
  for (const policy of policies) {
    const baseLabels = policy.domain.split('.')
    if (normalized === policy.domain) {
      throw denied('the route base domain itself cannot be claimed')
    }
    if (
      labels.length > baseLabels.length &&
      labels.slice(-baseLabels.length).join('.') === policy.domain
    ) {
      if (!matched || baseLabels.length > matched.labelCount) {
        matched = { policy, labelCount: baseLabels.length }
      }
    }
  }
  if (!matched) {
    throw denied('hostname must be <label>.<baseDomain> under a configured route base domain')
  }
  if (labels.length !== matched.labelCount + 1) {
    throw denied('only a single label under the base domain is allowed')
  }
  const label = labels[0]!
  if (VRT_ROUTE_LABEL_BLOCKLIST.has(label) || label.startsWith('_')) {
    throw denied(`label '${label}' is reserved`)
  }
  if (!routeLabelMatchesPolicy(label, matched.policy)) {
    throw denied(
      matched.policy.labelPrefix
        ? `label must match ${matched.policy.labelPrefix}<name> under ${matched.policy.domain}`
        : `label '${label}' is invalid`
    )
  }
}
