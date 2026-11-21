/**
 * Property tests for the canonical serializer: whatever the shape, parsing the
 * canonical bytes must give back the same value, and re-canonicalizing must
 * not change the bytes (order independence + idempotence).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalControlPlaneSnapshotV2 as canon } from '../src/index.js'

const validKey = (key: string): boolean => key !== '__proto__' && !/[\ud800-\udfff]/.test(key)

const jsonValue = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'large' },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    fc.string({ unit: 'grapheme', maxLength: 12 }),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string({ unit: 'grapheme', maxLength: 8 }).filter(validKey), tie('value'), {
      maxKeys: 4,
    })
  ),
})).value

describe('canonical JSON properties', () => {
  it('round-trips through parse and stays idempotent', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const bytes = canon(value)
        expect(JSON.parse(bytes)).toEqual(value)
        expect(canon(JSON.parse(bytes))).toBe(bytes)
      }),
      { numRuns: 200 }
    )
  })

  it('is independent of object entry order (top level and nested)', () => {
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversed)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([k, v]) => [k, reversed(v)])
        )
      }
      return value
    }
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(canon(reversed(value))).toBe(canon(value))
      }),
      { numRuns: 200 }
    )
  })
})
