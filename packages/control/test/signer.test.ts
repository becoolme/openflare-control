import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalControlPlaneSnapshotV2,
  signSnapshotProtocolEnvelope,
  SNAPSHOT_DEFAULT_TTL_MS,
  SNAPSHOT_MAX_BYTES,
  type SnapshotSigningContext,
} from '../src/index.js'

function signing(): SnapshotSigningContext {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  return {
    privateKey,
    publicKey: spki,
    keyId: createHash('sha256').update(spki).digest('hex').slice(0, 24),
  }
}

const input = {
  kind: 'compute.desired',
  scope: 'cell:c1',
  revision: 7,
  payload: { schemaVersion: 1, cellId: 'c1', revision: 7, tenants: [] },
}

describe('snapshot signer', () => {
  it('signs the canonical unsigned envelope and exposes stable digests', () => {
    const ctx = signing()
    const now = new Date('2026-01-01T00:00:00.000Z')
    const signed = signSnapshotProtocolEnvelope({ ...input, signing: ctx, now })

    const { signature, ...unsigned } = signed.envelope
    const expected = canonicalControlPlaneSnapshotV2(unsigned)
    expect(signed.canonical).toBe(canonicalControlPlaneSnapshotV2(signed.envelope))
    const ok = verify(
      null,
      Buffer.from(expected),
      createPublicKey(ctx.privateKey),
      Buffer.from(signature, 'base64')
    )
    expect(ok).toBe(true)

    const payloadCanonical = canonicalControlPlaneSnapshotV2(input.payload)
    expect(signed.payloadDigest).toBe(createHash('sha256').update(payloadCanonical).digest('hex'))
    expect(signed.envelopeDigest).toHaveLength(64)
    expect(signed.envelope.issuedAt).toBe(now.toISOString())
    expect(signed.envelope.expiresAt).toBe(
      new Date(now.getTime() + SNAPSHOT_DEFAULT_TTL_MS).toISOString()
    )
  })

  it('is deterministic for identical inputs', () => {
    const ctx = signing()
    const now = new Date('2026-01-01T00:00:00.000Z')
    const a = signSnapshotProtocolEnvelope({ ...input, signing: ctx, now })
    const b = signSnapshotProtocolEnvelope({ ...input, signing: ctx, now })
    expect(a.canonical).toBe(b.canonical)
    expect(a.envelopeDigest).toBe(b.envelopeDigest)
  })

  it('rejects invalid revisions and lifetimes', () => {
    const ctx = signing()
    expect(() => signSnapshotProtocolEnvelope({ ...input, revision: 0, signing: ctx })).toThrow(
      /Invalid snapshot revision/
    )
    expect(() => signSnapshotProtocolEnvelope({ ...input, ttlMs: 1, signing: ctx })).toThrow(
      /Invalid snapshot lifetime/
    )
    expect(() =>
      signSnapshotProtocolEnvelope({ ...input, ttlMs: 25 * 60 * 60_000, signing: ctx })
    ).toThrow(/Invalid snapshot lifetime/)
  })

  it('keeps the envelope under the protocol size bound for an empty cell', () => {
    const ctx = signing()
    const signed = signSnapshotProtocolEnvelope({ ...input, signing: ctx })
    expect(Buffer.byteLength(signed.canonical, 'utf8')).toBeLessThan(SNAPSHOT_MAX_BYTES)
  })
})
