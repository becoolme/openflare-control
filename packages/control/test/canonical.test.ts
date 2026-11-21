import { describe, expect, it } from 'vitest'
import { canonicalControlPlaneSnapshotV2 as canon } from '../src/index.js'

describe('canonical JSON v2', () => {
  it('is byte-stable regardless of object key order', () => {
    expect(canon({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canon({ a: 2, b: 1 })).toBe(canon({ b: 1, a: 2 }))
  })

  it('encodes primitives the way the protocol crate does', () => {
    expect(canon(null)).toBe('null')
    expect(canon(true)).toBe('true')
    expect(canon(false)).toBe('false')
    expect(canon(-0)).toBe('0')
    expect(canon(42)).toBe('42')
    expect(canon('a"b')).toBe('"a\\"b"')
    expect(canon([])).toBe('[]')
    expect(canon({})).toBe('{}')
    expect(canon([1, { b: 2, a: 'x' }])).toBe('[1,{"a":"x","b":2}]')
  })

  it('sorts keys by UTF-16 code units, not locale', () => {
    expect(canon({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}')
    expect(canon({ a: 1, A: 2 })).toBe('{"A":2,"a":1}')
  })

  it('rejects non-integers, non-finite numbers and unsupported values', () => {
    for (const bad of [1.5, NaN, Infinity, -Infinity, undefined, () => 1, Symbol('x'), 1n]) {
      expect(() => canon(bad)).toThrow(/Unsupported canonical JSON value/)
    }
  })

  it('rejects unpaired surrogates in values and keys', () => {
    expect(() => canon('\ud800')).toThrow()
    expect(() => canon({ ['\udc00']: 1 })).toThrow()
    expect(canon('\ud83d\ude00')).toBe('"😀"')
  })

  it('rejects class instances, prototypes with extra props and symbol keys', () => {
    class Box {
      constructor(readonly x = 1) {}
    }
    expect(() => canon(new Box())).toThrow()
    expect(() => canon(Object.assign(Object.create(null), { a: 1 }))).not.toThrow()
    expect(() => canon({ [Symbol('s')]: 1 })).toThrow()
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canon([, 1])).toThrow()
  })

  it('rejects an own "__proto__" key', () => {
    const value = JSON.parse('{"__proto__":1}')
    expect(() => canon(value)).toThrow()
  })

  it('bounds nesting depth', () => {
    let deep: unknown = 1
    for (let i = 0; i < 200; i += 1) deep = { a: deep }
    expect(() => canon(deep)).toThrow(/Unsupported canonical JSON value/)
  })
})
