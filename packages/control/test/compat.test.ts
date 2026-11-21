import { describe, expect, it } from 'vitest'
import {
  assertNoCompatFlagConflict,
  CompatFlagConflictError,
  findCompatFlagConflict,
  isTenantAllowedCompatFlag,
  PINNED_WORKERD_VERSION,
  WORKERD_MAX_COMPAT_DATE,
  VrtControlError,
} from '../src/index.js'

describe('compat flags', () => {
  it('accepts known stable flags and rejects unknown/experimental names', () => {
    expect(isTenantAllowedCompatFlag('nodejs_compat')).toBe(true)
    expect(isTenantAllowedCompatFlag('totally_made_up')).toBe(false)
    expect(isTenantAllowedCompatFlag('')).toBe(false)
  })

  it('derives the compatibility-date ceiling from the pinned workerd release', () => {
    expect(PINNED_WORKERD_VERSION).toMatch(/^1\.\d{8}\.\d+$/)
    const m = /^1\.(\d{4})(\d{2})(\d{2})\.\d+$/.exec(PINNED_WORKERD_VERSION)!
    expect(WORKERD_MAX_COMPAT_DATE).toBe(`${m[1]}-${m[2]}-${m[3]}`)
  })

  it('detects duplicate and contradictory flags, and throws a typed 422', () => {
    expect(findCompatFlagConflict(['nodejs_compat', 'nodejs_compat'])?.kind).toBe('duplicate')
    expect(findCompatFlagConflict(['nodejs_compat', 'no_nodejs_compat'])?.kind).toBe('pair')
    expect(findCompatFlagConflict(['nodejs_compat'])).toBeNull()
    try {
      assertNoCompatFlagConflict(['nodejs_compat', 'no_nodejs_compat'])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CompatFlagConflictError)
      expect(error).toBeInstanceOf(VrtControlError)
      expect((error as VrtControlError).status).toBe(422)
      expect((error as VrtControlError).errorCode).toBe('COMPAT_FLAG_CONFLICT')
    }
  })
})
