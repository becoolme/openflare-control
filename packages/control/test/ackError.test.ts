import { describe, expect, it } from 'vitest'
import { ackErrorLogCode, classifyAckError } from '../src/index.js'

describe('cell-op ack error classification', () => {
  it('treats deterministic data/validation database errors as permanent', () => {
    expect(classifyAckError({ code: '22P05' })).toBe('deterministic')
    expect(classifyAckError({ code: '22021' })).toBe('deterministic')
    expect(classifyAckError({ code: 'P2000' })).toBe('deterministic')
  })

  it('keeps deadlocks, serialization and unknown failures transient', () => {
    expect(classifyAckError({ code: '40P01' })).toBe('transient')
    expect(classifyAckError({ code: '40001' })).toBe('transient')
    expect(classifyAckError(new Error('socket hang up'))).toBe('transient')
    expect(classifyAckError(null)).toBe('transient')
  })

  it('emits only a bounded code (never the raw message)', () => {
    expect(ackErrorLogCode({ code: '22P05', message: 'secret value' })).toBe('22P05')
    expect(ackErrorLogCode({ code: 'P2000' })).toBe('P2000')
    expect(ackErrorLogCode({ code: 'not allowed!' })).toBe('unknown')
    expect(ackErrorLogCode(new Error('boom'))).toBe('unknown')
    expect(ackErrorLogCode('a'.repeat(17))).toBe('unknown')
  })
})
