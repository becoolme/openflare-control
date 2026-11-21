import { describe, expect, it } from 'vitest'
import {
  assertVrtRouteHostnameAllowed,
  isLowerHex,
  validVrtBucketName,
  validVrtCompatFlag,
  validVrtIdentifier,
  VrtControlError,
} from '../src/index.js'

const bases = ['w.example.com', { domain: 'example.com', labelPrefix: 'vrt-' }]

function denied(hostname: string, routeBases = bases): VrtControlError {
  try {
    assertVrtRouteHostnameAllowed(hostname, routeBases)
    throw new Error(`${hostname} should have been rejected`)
  } catch (error) {
    if (!(error instanceof VrtControlError)) throw error
    return error
  }
}

describe('assertVrtRouteHostnameAllowed', () => {
  it('accepts a single label under a configured base', () => {
    expect(() => assertVrtRouteHostnameAllowed('hello.w.example.com', bases)).not.toThrow()
    expect(() => assertVrtRouteHostnameAllowed('vrt-hello.example.com', bases)).not.toThrow()
  })

  it('rejects the bare base domain and deeper subdomains', () => {
    expect(denied('w.example.com').status).toBe(403)
    expect(denied('a.b.w.example.com').errorCode).toBe('VRT_HOSTNAME_NOT_ALLOWED')
  })

  it('rejects hostnames outside every configured base', () => {
    expect(denied('hello.other.com').status).toBe(403)
  })

  it('rejects reserved labels and empty configuration', () => {
    expect(denied('vrt.w.example.com').status).toBe(403)
    expect(denied('_dmarc.w.example.com').status).toBe(403)
    expect(denied('hello.w.example.com', []).status).toBe(403)
  })

  it('enforces the prefix namespace of a prefixed base', () => {
    expect(denied('plain.example.com').status).toBe(403)
    expect(denied('vrt-.example.com').status).toBe(403)
    expect(() => assertVrtRouteHostnameAllowed('vrt-ok.example.com', bases)).not.toThrow()
  })

  it('picks the longest matching base', () => {
    // x.apps.example.com is covered by the longer base and judged there.
    expect(() =>
      assertVrtRouteHostnameAllowed('x.apps.example.com', ['example.com', 'apps.example.com'])
    ).not.toThrow()
  })
})

describe('small validators', () => {
  it('validVrtIdentifier bounds and character set', () => {
    expect(validVrtIdentifier('abc-123_.:')).toBe(true)
    expect(validVrtIdentifier('with space')).toBe(false)
    expect(validVrtIdentifier('')).toBe(false)
    expect(validVrtIdentifier('a'.repeat(129))).toBe(false)
    expect(validVrtIdentifier('a'.repeat(129), 200)).toBe(true)
  })

  it('validVrtBucketName', () => {
    expect(validVrtBucketName('my-bucket')).toBe(true)
    expect(validVrtBucketName('-bad')).toBe(false)
    expect(validVrtBucketName('bad-')).toBe(false)
    expect(validVrtBucketName('UPPER')).toBe(false)
    expect(validVrtBucketName('ab')).toBe(false)
  })

  it('isLowerHex requires lowercase hex of the requested length', () => {
    expect(isLowerHex('a'.repeat(64))).toBe(true)
    expect(isLowerHex('A'.repeat(64))).toBe(false)
    expect(isLowerHex('a'.repeat(63))).toBe(false)
    expect(isLowerHex('a'.repeat(32), 32)).toBe(true)
    expect(isLowerHex('g'.repeat(32), 32)).toBe(false)
  })

  it('validVrtCompatFlag matches the runtime flag shape', () => {
    expect(validVrtCompatFlag('nodejs_compat')).toBe(true)
    expect(validVrtCompatFlag('BAD FLAG')).toBe(false)
    expect(validVrtCompatFlag('a'.repeat(65))).toBe(false)
  })
})
