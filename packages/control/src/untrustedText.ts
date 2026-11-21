/**
 * RV-R145: single normalizer for untrusted (tenant / cell supplied) text
 * BEFORE it reaches the persistence layer.
 *
 * PostgreSQL rejects NUL (`\u0000`) in `text` (22021) and in `jsonb`
 * (22P05), and rejects lone surrogate escapes in `jsonb`. A cell ack
 * whose user-code output contains either would otherwise abort the ack
 * write and, if unhandled, the whole batch. Everything here is pure,
 * bounded and fail-closed (typed failure, never a throw).
 */

export const SANITIZE_MAX_DEPTH = 32
export const SANITIZE_MAX_NODES = 100_000

export type SanitizeFailureReason = 'depth' | 'nodes' | 'unserializable' | 'key_collision'

export type SanitizeJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: SanitizeFailureReason }

/** Strip NUL and lone (unpaired) UTF-16 surrogates from a string. */
export function stripNul(str: string): string {
  // Fast path: nothing to do.
  // eslint-disable-next-line no-control-regex
  if (!/[\u0000\ud800-\udfff]/.test(str)) return str
  let out = ''
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c === 0) continue
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += str.slice(i, i + 2)
        i++
      }
      continue // lone high surrogate dropped
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue // lone low surrogate dropped
    out += str[i]
  }
  return out
}

/**
 * Recursively normalize a JSON-ish value for jsonb/text storage:
 * strings and object keys are stripped; depth and node count are
 * bounded (typed failure on overflow); non-JSON values (bigint,
 * function, symbol, cycles via the depth bound) fail closed.
 */
export function sanitizeJsonForPg(value: unknown): SanitizeJsonResult {
  let nodes = 0
  let failure: SanitizeFailureReason | null = null
  const walk = (v: unknown, depth: number): unknown => {
    if (failure) return null
    if (++nodes > SANITIZE_MAX_NODES) {
      failure = 'nodes'
      return null
    }
    if (depth > SANITIZE_MAX_DEPTH) {
      failure = 'depth'
      return null
    }
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string') return stripNul(v)
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (failure) break
        const key = stripNul(k)
        // RV-R195: NUL-stripping must not merge two distinct keys.
        if (Object.prototype.hasOwnProperty.call(out, key)) {
          failure = 'key_collision'
          break
        }
        // defineProperty keeps an own `__proto__` key (plain assignment would
        // silently set the prototype and drop the key).
        Object.defineProperty(out, key, {
          value: walk(x, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      return out
    }
    if (v === undefined) return null
    failure = 'unserializable'
    return null
  }
  const value2 = walk(value, 0)
  return failure ? { ok: false, reason: failure } : { ok: true, value: value2 }
}
