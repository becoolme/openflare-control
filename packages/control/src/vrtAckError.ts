/**
 * RV-R195: shared classification of errors thrown while applying one cell-op
 * ack. Only deterministic data/validation errors may degrade the op to a
 * permanent FAILED; anything else (deadlock, serialization, pool/connection,
 * unknown `onAcked` failures) is treated as transient so the op stays PENDING
 * and the cell replays the ack. Fail-safe default: unknown → transient.
 */
export type AckErrorClass = 'deterministic' | 'transient'

const DETERMINISTIC_PG = new Set([
  '22021', // invalid byte sequence for encoding
  '22P05', // untranslatable character
  '22P02', // invalid text representation
  '22001', // string data right truncation
  '22003', // numeric value out of range
  '22007', // invalid datetime format
  '22023', // invalid parameter value
])
const DETERMINISTIC_PRISMA = new Set(['P2000', 'P2006', 'P2007', 'P2020'])

export function classifyAckError(err: unknown): AckErrorClass {
  if (!err || typeof err !== 'object') return 'transient'
  const e = err as {
    name?: unknown
    code?: unknown
    meta?: { code?: unknown }
    issues?: unknown
  }
  if (e.name === 'ZodError' && Array.isArray(e.issues)) return 'deterministic'
  const codes = [e.code, e.meta?.code].filter((c): c is string => typeof c === 'string')
  for (const c of codes) {
    if (DETERMINISTIC_PRISMA.has(c) || DETERMINISTIC_PG.has(c)) return 'deterministic'
  }
  return 'transient'
}

/** Log-safe error code (never the message/payload). */
export function ackErrorLogCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(c)) return c
  }
  return 'unknown'
}
