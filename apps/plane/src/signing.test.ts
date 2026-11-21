import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalControlPlaneSnapshotV2, signSnapshotProtocolEnvelope } from 'openflare-control'
import { resolvePlaneSigningKey } from './signing.js'

describe('plane signing key', () => {
  it('derives a stable Ed25519 context from the secret', () => {
    const a = resolvePlaneSigningKey('unit-test-secret-1234')
    const b = resolvePlaneSigningKey('unit-test-secret-1234')
    expect(a.keyId).toBe(b.keyId)
    expect(a.publicKey).toBe(b.publicKey)
    expect(a.keyId).toMatch(/^[0-9a-f]{24}$/)
  })

  it('derives a different key for a different secret', () => {
    expect(resolvePlaneSigningKey('unit-test-secret-1234').keyId).not.toBe(
      resolvePlaneSigningKey('unit-test-secret-5678').keyId
    )
  })

  it('rejects a short or missing secret', () => {
    expect(() => resolvePlaneSigningKey('short')).toThrow(/PLANE_SIGNING_SECRET/)
    expect(() => resolvePlaneSigningKey(undefined)).toThrow(/PLANE_SIGNING_SECRET/)
  })

  it('produces envelopes a cell can verify with the printed public key', () => {
    const signing = resolvePlaneSigningKey('unit-test-secret-1234')
    const signed = signSnapshotProtocolEnvelope({
      kind: 'compute.desired',
      scope: 'cell:c1',
      revision: 1,
      payload: { tenants: [] },
      signing,
    })
    const { signature, ...unsigned } = signed.envelope
    const ok = verify(
      null,
      Buffer.from(canonicalControlPlaneSnapshotV2(unsigned)),
      createPublicKey(signing.privateKey),
      Buffer.from(signature, 'base64')
    )
    expect(ok).toBe(true)
  })
})
