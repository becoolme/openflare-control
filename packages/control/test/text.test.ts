import { describe, expect, it } from 'vitest'
import { sanitizeJsonForPg, stripNul } from '../src/index.js'

describe('untrusted text normalization', () => {
  it('strips NUL and lone surrogates', () => {
    expect(stripNul('a\u0000b')).toBe('ab')
    expect(stripNul('x\ud800y')).toBe('xy')
    expect(stripNul('emoji 😀')).toBe('emoji 😀')
  })

  it('sanitizes nested JSON while keeping valid data', () => {
    const result = sanitizeJsonForPg({ a: 'x\u0000y', list: ['p', { q: 'r\udc00' }] })
    expect(result).toEqual({ ok: true, value: { a: 'xy', list: ['p', { q: 'r' }] } })
  })

  it('fails closed on unserializable input', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(sanitizeJsonForPg(cyclic)).toEqual({ ok: false, reason: 'depth' })
    expect(sanitizeJsonForPg({ fn: () => 1 })).toEqual({ ok: false, reason: 'unserializable' })
  })

  it('bounds nesting depth', () => {
    let deep: unknown = 1
    for (let i = 0; i < 40; i += 1) deep = { a: deep }
    expect(sanitizeJsonForPg(deep)).toEqual({ ok: false, reason: 'depth' })
  })
})
