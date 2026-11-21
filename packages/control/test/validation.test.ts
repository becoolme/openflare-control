import { describe, expect, it } from 'vitest'
import {
  normalizeRouteBases,
  routeLabelMatchesPolicy,
  validVrtBindingName,
  validVrtCompatDate,
  validVrtHostname,
  validVrtWorkerName,
  normalizeVrtHostname,
} from '../src/index.js'

describe('worker / binding names', () => {
  it('accepts DNS-safe worker names and rejects the rest', () => {
    expect(validVrtWorkerName('hello')).toBe(true)
    expect(validVrtWorkerName('hello-world')).toBe(true)
    expect(validVrtWorkerName('Hello')).toBe(false)
    expect(validVrtWorkerName('-hello')).toBe(false)
    expect(validVrtWorkerName('a'.repeat(64))).toBe(false)
  })

  it('accepts JS identifiers as binding names', () => {
    expect(validVrtBindingName('MY_KV')).toBe(true)
    expect(validVrtBindingName('$x')).toBe(true)
    expect(validVrtBindingName('1x')).toBe(false)
    expect(validVrtBindingName('a-b')).toBe(false)
  })
})

describe('hostnames', () => {
  it('normalizes case and surrounding whitespace; trailing dots fail closed', () => {
    expect(normalizeVrtHostname(' Hello.Example.COM ')).toBe('hello.example.com')
    expect(() => normalizeVrtHostname('hello.example.com.')).toThrow(/Invalid hostname/)
  })

  it('rejects malformed hostnames', () => {
    expect(validVrtHostname('hello.example.com')).toBe(true)
    expect(validVrtHostname('a..b')).toBe(false)
    expect(validVrtHostname('*.example.com')).toBe(false)
    expect(validVrtHostname('-a.example.com')).toBe(false)
  })
})

describe('route-base label policy', () => {
  it('accepts any single DNS label on a legacy (unprefixed) base', () => {
    expect(routeLabelMatchesPolicy('hello', { domain: 'w.example.com' })).toBe(true)
    expect(routeLabelMatchesPolicy('a-b', { domain: 'w.example.com' })).toBe(true)
    expect(routeLabelMatchesPolicy('a.b', { domain: 'w.example.com' })).toBe(false)
    expect(routeLabelMatchesPolicy('-a', { domain: 'w.example.com' })).toBe(false)
  })

  it('prefixed base only accepts labels with the prefix', () => {
    const policy = { domain: 'example.com', labelPrefix: 'w-' }
    expect(routeLabelMatchesPolicy('w-hello', policy)).toBe(true)
    expect(routeLabelMatchesPolicy('hello', policy)).toBe(false)
    expect(routeLabelMatchesPolicy('w-', policy)).toBe(false)
  })

  it('normalizes conflicting duplicates to null', () => {
    expect(
      normalizeRouteBases(['a.example.com', { domain: 'b.example.com', labelPrefix: 'w-' }])
    ).toHaveLength(2)
    expect(
      normalizeRouteBases(['a.example.com', { domain: 'a.example.com', labelPrefix: 'w-' }])
    ).toBeNull()
  })
})

describe('compat dates', () => {
  it('accepts YYYY-MM-DD and nothing else', () => {
    expect(validVrtCompatDate('2024-01-01')).toBe(true)
    expect(validVrtCompatDate('2024-1-1')).toBe(false)
    expect(validVrtCompatDate('2024-13-01')).toBe(false)
    expect(validVrtCompatDate('nope')).toBe(false)
  })
})
