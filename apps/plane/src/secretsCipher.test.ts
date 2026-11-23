import { describe, expect, it } from 'vitest'
import { createSecretsCipher } from './secretsCipher.js'

const cipher = createSecretsCipher('unit-test-signing-secret-0001')

describe('secretsCipher', () => {
  it('round-trips arbitrary values through enc:v1', () => {
    for (const value of ['', 'a', 'héllo wörld', 'line1\nline2', 'x'.repeat(8192)]) {
      const stored = cipher.encrypt(value)
      expect(stored.startsWith('enc:v1:')).toBe(true)
      expect(cipher.decrypt(stored)).toBe(value)
    }
  })

  it('never reuses an IV', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'))
  })

  it('passes through pre-encryption plaintext rows (lazy migration)', () => {
    expect(cipher.isEncrypted('plaintext-legacy-secret')).toBe(false)
    expect(cipher.decrypt('plaintext-legacy-secret')).toBe('plaintext-legacy-secret')
    expect(cipher.isEncrypted(cipher.encrypt('sealed'))).toBe(true)
  })

  it('refuses a missing or short key', () => {
    expect(() => createSecretsCipher('')).toThrow(/PLANE_SECRETS_KEY/)
    expect(() => createSecretsCipher('too-short')).toThrow(/PLANE_SECRETS_KEY/)
  })

  it('rejects tampered ciphertext', () => {
    const stored = cipher.encrypt('secret')
    const tampered = `${stored.slice(0, -4)}AAAA`
    expect(() => cipher.decrypt(tampered)).toThrow()
  })

  it('derives a key distinct from another secret', () => {
    const other = createSecretsCipher('unit-test-signing-secret-0002')
    expect(() => other.decrypt(cipher.encrypt('secret'))).toThrow()
  })
})
