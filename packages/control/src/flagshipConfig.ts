/**
 * CF Flagship flag-model proof — the portable half of the platform's
 * `vrtFlagship.ts` (which owns the `VrtFlagshipApp` rows).
 *
 * The model is proven twice: at write time by the control plane, and again
 * at the `compute.desired` trust boundary (`flagshipConfigIsValid`) so a
 * malformed stored config can never reach an isolate. Both sides use these
 * functions; the Rust cell mirrors them in `validate_flagship_config`.
 */

export class FlagshipConfigError extends Error {
  readonly field: string
  constructor(field: string) {
    super(`flagship config malformed: ${field}`)
    this.name = 'FlagshipConfigError'
    this.field = field
  }
}

const MAX_FLAGSHIP_CONFIG_BYTES = 64 * 1024
const MAX_FLAGSHIP_FLAGS = 128
const MAX_FLAGSHIP_VARIANTS = 16
const MAX_FLAGSHIP_RULES = 32
const MAX_FLAGSHIP_FLAG_KEY_LEN = 64
const MAX_FLAGSHIP_VARIANT_NAME_LEN = 64
const MAX_FLAGSHIP_ATTRIBUTE_LEN = 255
const MAX_FLAGSHIP_SEGMENTS = 5
const MAX_FLAGSHIP_COND_DEPTH = 5
const FLAGSHIP_FLAG_TYPES = new Set(['boolean', 'string', 'number', 'json'])
const FLAGSHIP_OPERATORS = new Set([
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'greater_than_or_equals',
  'less_than_or_equals',
  'contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'has',
  'not_has',
])

function fail(field: string): never {
  throw new FlagshipConfigError(field)
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function validFlagKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_FLAGSHIP_FLAG_KEY_LEN
}

function validAttribute(attribute: string): boolean {
  if (attribute.length === 0 || attribute.length > MAX_FLAGSHIP_ATTRIBUTE_LEN) return false
  const segments = attribute.split('.')
  return segments.length <= MAX_FLAGSHIP_SEGMENTS && segments.every((s) => s.length > 0)
}

function validateConditionNode(node: unknown, depth: number): void {
  if (depth > MAX_FLAGSHIP_COND_DEPTH) fail('conditions.depth')
  if (!isObj(node)) fail('condition')
  const keys = Object.keys(node)
  const hasAll = node.all !== undefined
  const hasAny = node.any !== undefined
  if (hasAll !== hasAny) {
    // A group node is exactly `{all: [nodes]}` or `{any: [nodes]}`.
    const key = hasAll ? 'all' : 'any'
    const list = node[key]
    if (!Array.isArray(list) || list.length === 0) fail(`conditions.${key}`)
    for (const n of list) validateConditionNode(n, depth + 1)
    if (keys.some((k) => k !== key)) fail('conditions.keys')
    return
  }
  if (hasAll && hasAny) fail('conditions.keys')
  // Leaf condition — `value` is optional (missing ⇒ never matches for
  // value-taking operators; same leniency as the Rust validator).
  if (typeof node.attribute !== 'string' || !validAttribute(node.attribute)) {
    fail('condition.attribute')
  }
  if (typeof node.operator !== 'string' || !FLAGSHIP_OPERATORS.has(node.operator)) {
    fail('condition.operator')
  }
  if (keys.some((k) => k !== 'attribute' && k !== 'operator' && k !== 'value')) {
    fail('conditions.keys')
  }
}

function validateRule(rule: unknown, variants: Record<string, unknown>): void {
  if (!isObj(rule)) fail('rule')
  // `serve_variation` is required and must name a variant.
  const serve = rule.serve_variation
  if (typeof serve !== 'string' || !(serve in variants)) fail('rule.serveVariation')
  if (rule.rollout !== undefined) {
    const rollout = rule.rollout
    if (!isObj(rollout)) fail('rollout')
    const pct = rollout.percentage
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      fail('rollout.percentage')
    }
    const attr = rollout.attribute
    if (attr !== undefined && (typeof attr !== 'string' || !validAttribute(attr))) {
      fail('rollout.attribute')
    }
    if (Object.keys(rollout).some((k) => k !== 'percentage' && k !== 'attribute')) {
      fail('rollout.keys')
    }
  }
  const conditions = rule.conditions
  if (conditions !== undefined) {
    // Either an array of nodes or a single group/leaf object (absent ⇒
    // the rule always matches — same as the cell evaluator).
    if (Array.isArray(conditions)) {
      if (conditions.length === 0) fail('conditions')
      for (const n of conditions) validateConditionNode(n, 1)
    } else if (isObj(conditions)) {
      validateConditionNode(conditions, 1)
    } else {
      fail('conditions')
    }
  }
  if (
    Object.keys(rule).some((k) => k !== 'serve_variation' && k !== 'rollout' && k !== 'conditions')
  ) {
    fail('rule.keys')
  }
}

/** Prove the serialized flag model — the TS mirror of Rust
 * `validate_flagship_config` (`compute_desired.rs`). Returns the
 * canonical config string (appId re-asserted). Throws
 * {@link FlagshipConfigError} on any malformed field. */
export function validateFlagshipConfig(appId: string, config: unknown): string {
  if (!isObj(config)) fail('config')
  const accountTag = config.accountTag
  if (
    accountTag !== undefined &&
    (typeof accountTag !== 'string' || accountTag.length === 0 || accountTag.length > 128)
  ) {
    fail('accountTag')
  }
  const flags = config.flags
  if (!isObj(flags)) fail('flags')
  const entries = Object.entries(flags)
  if (entries.length > MAX_FLAGSHIP_FLAGS) fail('flags')
  for (const [key, flag] of entries) {
    if (!validFlagKey(key)) fail('flagKey')
    if (!isObj(flag)) fail('flag')
    const flagType = flag.type
    if (typeof flagType !== 'string' || !FLAGSHIP_FLAG_TYPES.has(flagType)) fail('flag.type')
    if (typeof flag.enabled !== 'boolean') fail('flag.enabled')
    const variants = flag.variants
    if (
      !isObj(variants) ||
      Object.keys(variants).length === 0 ||
      Object.keys(variants).length > MAX_FLAGSHIP_VARIANTS
    ) {
      fail('flag.variants')
    }
    for (const [vname, vval] of Object.entries(variants)) {
      if (vname.length === 0 || vname.length > MAX_FLAGSHIP_VARIANT_NAME_LEN)
        fail('flag.variantName')
      const ok =
        flagType === 'boolean'
          ? typeof vval === 'boolean'
          : flagType === 'string'
            ? typeof vval === 'string'
            : flagType === 'number'
              ? typeof vval === 'number' && Number.isFinite(vval)
              : true // `json` variants accept any JSON value
      if (!ok) fail('flag.variantType')
    }
    const defaultVariant = flag.defaultVariant
    if (typeof defaultVariant !== 'string' || !(defaultVariant in variants)) {
      fail('flag.defaultVariant')
    }
    if (flag.rules !== undefined) {
      const rules = flag.rules
      if (!Array.isArray(rules) || rules.length > MAX_FLAGSHIP_RULES) fail('flag.rules')
      for (const rule of rules) validateRule(rule, variants)
    }
    for (const k of Object.keys(flag)) {
      if (
        k !== 'enabled' &&
        k !== 'type' &&
        k !== 'variants' &&
        k !== 'defaultVariant' &&
        k !== 'rules'
      ) {
        fail('flag.keys')
      }
    }
  }
  for (const k of Object.keys(config)) {
    if (k !== 'flags' && k !== 'appId' && k !== 'accountTag') fail('config.keys')
  }
  const canonical = {
    appId,
    ...(accountTag !== undefined ? { accountTag } : {}),
    flags,
  }
  const serialized = JSON.stringify(canonical)
  if (serialized.length > MAX_FLAGSHIP_CONFIG_BYTES) fail('configBytes')
  return serialized
}

/** Re-validate a serialized config from storage — same model proof at the
 * `compute.desired` trust boundary. Never throws. */
export function flagshipConfigIsValid(config: string): boolean {
  try {
    const parsed: unknown = JSON.parse(config)
    if (!isObj(parsed) || typeof parsed.appId !== 'string') return false
    validateFlagshipConfig(parsed.appId, parsed)
    return true
  } catch {
    return false
  }
}
