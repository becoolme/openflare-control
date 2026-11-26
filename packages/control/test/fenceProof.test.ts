import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  SNAPSHOT_KIND_COMPUTE_DESIRED,
  canonicalControlPlaneSnapshotV2,
  fenceAttestationForEnvelope,
  signFenceAttestation,
  signSnapshotProtocolEnvelope,
  verifyFenceAttestation,
  type SnapshotSigningContext,
} from '../src/index.js'

function signingContext(): SnapshotSigningContext {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  return {
    keyId: createHash('sha256').update(spki).digest('hex').slice(0, 24),
    publicKey: spki,
    privateKey,
  }
}

const digests = { payloadDigest: 'a'.repeat(64), envelopeDigest: 'b'.repeat(64) }

describe('fence attestations (issue #63)', () => {
  it('round-trips sign → verify', () => {
    const signing = signingContext()
    const attestation = signFenceAttestation({
      scope: 'cell:c1',
      revision: 42,
      ...digests,
      signing,
    })
    expect(
      verifyFenceAttestation({
        scope: 'cell:c1',
        revision: 42,
        ...digests,
        attestation,
        publicKey: signing.publicKey,
      })
    ).toBe(true)
  })

  it('rejects a tampered revision, digest, scope, attestation or key', () => {
    const signing = signingContext()
    const other = signingContext()
    const attestation = signFenceAttestation({
      scope: 'cell:c1',
      revision: 42,
      ...digests,
      signing,
    })
    const base = {
      scope: 'cell:c1',
      revision: 42,
      ...digests,
      attestation,
      publicKey: signing.publicKey,
    }
    expect(verifyFenceAttestation({ ...base, revision: 43 })).toBe(false)
    expect(verifyFenceAttestation({ ...base, payloadDigest: 'c'.repeat(64) })).toBe(false)
    expect(verifyFenceAttestation({ ...base, envelopeDigest: 'd'.repeat(64) })).toBe(false)
    expect(verifyFenceAttestation({ ...base, scope: 'cell:c2' })).toBe(false)
    expect(verifyFenceAttestation({ ...base, attestation: 'not-base64!!' })).toBe(false)
    expect(verifyFenceAttestation({ ...base, publicKey: other.publicKey })).toBe(false)
    expect(verifyFenceAttestation({ ...base, revision: 0 })).toBe(false)
  })

  it('derives a verifiable attestation from a stored signed envelope', () => {
    const signing = signingContext()
    const signed = signSnapshotProtocolEnvelope({
      kind: SNAPSHOT_KIND_COMPUTE_DESIRED,
      scope: 'cell:c1',
      revision: 7,
      payload: { tenants: [] },
      signing,
    })
    const attestation = fenceAttestationForEnvelope(signed.envelope, 'cell:c1', signing)
    expect(attestation).not.toBeNull()
    expect(attestation!.revision).toBe(7)
    expect(attestation!.payloadDigest).toBe(signed.payloadDigest)
    expect(attestation!.envelopeDigest).toBe(signed.envelopeDigest)
    expect(
      verifyFenceAttestation({
        scope: 'cell:c1',
        revision: 7,
        payloadDigest: attestation!.payloadDigest,
        envelopeDigest: attestation!.envelopeDigest,
        attestation: attestation!.attestation,
        publicKey: signing.publicKey,
      })
    ).toBe(true)
  })

  it('returns null for non-envelopes', () => {
    const signing = signingContext()
    expect(fenceAttestationForEnvelope(null, 'cell:c1', signing)).toBeNull()
    expect(fenceAttestationForEnvelope('x', 'cell:c1', signing)).toBeNull()
    expect(fenceAttestationForEnvelope({ revision: 0 }, 'cell:c1', signing)).toBeNull()
    expect(
      fenceAttestationForEnvelope({ revision: 1, payloadDigest: 'zz' }, 'cell:c1', signing)
    ).toBeNull()
  })

  it('the canonical message is domain-separated from compute.desired', () => {
    // Not a behavioural assertion, but pins the message shape the Rust side must
    // mirror: a fence attestation over these four fields only.
    const signing = signingContext()
    const attestation = signFenceAttestation({ scope: 'cell:c1', revision: 3, ...digests, signing })
    const message = canonicalControlPlaneSnapshotV2({
      kind: 'compute.desired.fence',
      scope: 'cell:c1',
      revision: 3,
      ...digests,
    })
    expect(
      verifyFenceAttestation({
        scope: 'cell:c1',
        revision: 3,
        ...digests,
        attestation,
        publicKey: signing.publicKey,
      })
    ).toBe(true)
    expect(message).toContain('compute.desired.fence')
  })
})
