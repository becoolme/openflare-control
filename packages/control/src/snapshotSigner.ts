/**
 * Signer for the generic `snapshot-protocol` envelope
 * (`server/tools/workers-runtime/snapshot-protocol`).
 *
 * Portable: the caller supplies the Ed25519 context (the platform derives
 * it from the control-plane snapshot key; the OSS plane from a file seed).
 * The key-id derivation (first 24 hex chars of sha256 over the base64 SPKI
 * text) and the canonical JSON form (`canonicalControlPlaneSnapshotV2`, which is
 * byte-equivalent to the protocol crate's `StrictValue::canonical`), and the
 * same payload-digest rule (sha256 of the canonical payload). What differs is
 * only the envelope member set: the protocol crate binds `kind`/`scope`
 * (`compute.desired` / `cell:<cellId>`) rather than the gateway's
 * `channel`/`clusterId` — a different addressing form on the same
 * crypto+canonical base, which is exactly what the snapshot-protocol doc
 * prescribes.
 *
 * The contract test `vrt-compute-desired-contract.test.ts` proves the
 * TS-produced envelope verifies under the Rust crate, so drift in either
 * direction fails closed in CI.
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { canonicalControlPlaneSnapshotV2 } from './canonicalSnapshot.js'

export const SNAPSHOT_PROTOCOL_VERSION = 1
export const SNAPSHOT_PROTOCOL_CANONICAL_VERSION = 1
export const SNAPSHOT_KIND_COMPUTE_DESIRED = 'compute.desired'
/** Domain-separated message for the revision-fence attestation (issue #63). */
export const SNAPSHOT_KIND_FENCE_ATTESTATION = 'compute.desired.fence'
/** Upper bound on an attestation string at the wire boundary. */
export const FENCE_ATTESTATION_MAX_CHARS = 512
/** Minimum/maximum snapshot lifetime — identical to the protocol crate. */
export const SNAPSHOT_MIN_TTL_MS = 60_000
export const SNAPSHOT_MAX_TTL_MS = 24 * 60 * 60 * 1000
/** Default publication lifetime. The cell controller renews well before
 * expiry (T8); 1h bounds stale acceptance while leaving ample renewal slack. */
export const SNAPSHOT_DEFAULT_TTL_MS = 60 * 60 * 1000
/** Maximum signed-envelope size — identical to the protocol crate's
 * MAX_SNAPSHOT_BYTES; a payload that would exceed it can never verify. */
export const SNAPSHOT_MAX_BYTES = 512 * 1024

export interface SnapshotProtocolEnvelope {
  readonly version: 1
  readonly canonicalVersion: 1
  readonly kind: string
  readonly scope: string
  readonly revision: number
  readonly issuedAt: string
  readonly expiresAt: string
  readonly keyId: string
  readonly payloadDigest: string
  readonly payload: unknown
  readonly signature: string
}

export interface SignedSnapshot {
  readonly envelope: SnapshotProtocolEnvelope
  /** Canonical wire bytes of the full signed envelope. */
  readonly canonical: string
  /** sha256 of the canonical payload member. */
  readonly payloadDigest: string
  /** sha256 of the canonical signed envelope — the idempotency/conflict anchor. */
  readonly envelopeDigest: string
}

export interface SnapshotSigningContext {
  readonly keyId: string
  readonly publicKey: string
  readonly privateKey: KeyObject
}

/** Sign a `kind`/`scope` snapshot-protocol envelope (version/canonical 1). */
export function signSnapshotProtocolEnvelope(input: {
  kind: string
  scope: string
  revision: number
  payload: unknown
  ttlMs?: number
  now?: Date
  signing: SnapshotSigningContext
}): SignedSnapshot {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Invalid snapshot revision')
  }
  const ttlMs = input.ttlMs ?? SNAPSHOT_DEFAULT_TTL_MS
  if (!Number.isSafeInteger(ttlMs) || ttlMs < SNAPSHOT_MIN_TTL_MS || ttlMs > SNAPSHOT_MAX_TTL_MS) {
    throw new Error('Invalid snapshot lifetime')
  }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid snapshot issue time')
  const signing = input.signing

  // Canonicalize the payload once so the stored payload and the digest are
  // computed over exactly the bytes the verifier re-canonicalizes.
  const payloadCanonical = canonicalControlPlaneSnapshotV2(input.payload)
  const payload = JSON.parse(payloadCanonical) as unknown
  const payloadDigest = createHash('sha256').update(payloadCanonical).digest('hex')

  const unsigned: Omit<SnapshotProtocolEnvelope, 'signature'> = {
    version: SNAPSHOT_PROTOCOL_VERSION,
    canonicalVersion: SNAPSHOT_PROTOCOL_CANONICAL_VERSION,
    kind: input.kind,
    scope: input.scope,
    revision: input.revision,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    keyId: signing.keyId,
    payloadDigest,
    payload,
  }
  const signature = sign(
    null,
    Buffer.from(canonicalControlPlaneSnapshotV2(unsigned), 'utf8'),
    signing.privateKey
  ).toString('base64')
  const envelope: SnapshotProtocolEnvelope = { ...unsigned, signature }
  const canonical = canonicalControlPlaneSnapshotV2(envelope)
  if (Buffer.byteLength(canonical, 'utf8') > SNAPSHOT_MAX_BYTES) {
    throw new Error('Snapshot envelope exceeds the protocol size bound')
  }
  return {
    envelope,
    canonical,
    payloadDigest,
    envelopeDigest: createHash('sha256').update(canonical).digest('hex'),
  }
}

export interface FenceAttestation {
  readonly revision: number
  readonly payloadDigest: string
  readonly envelopeDigest: string
  readonly attestation: string
}

function fenceAttestationMessage(input: {
  scope: string
  revision: number
  payloadDigest: string
  envelopeDigest: string
}): Buffer {
  return Buffer.from(
    canonicalControlPlaneSnapshotV2({
      kind: SNAPSHOT_KIND_FENCE_ATTESTATION,
      scope: input.scope,
      revision: input.revision,
      payloadDigest: input.payloadDigest,
      envelopeDigest: input.envelopeDigest,
    }),
    'utf8'
  )
}

/**
 * Sign the compact revision-fence attestation for one publication. It proves
 * "the control plane signed revision N with these digests" WITHOUT shipping
 * the (up to 512 KiB) envelope: the cell persists this string when it accepts
 * a document and echoes it in an ack when its persisted fence is ahead of the
 * acked revision (e.g. after a control-plane restore).
 *
 * Ed25519 signatures are deterministic, so callers may also re-derive the same
 * string from a stored envelope at read time (`fenceAttestationForEnvelope`).
 */
export function signFenceAttestation(input: {
  scope: string
  revision: number
  payloadDigest: string
  envelopeDigest: string
  signing: SnapshotSigningContext
}): string {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Invalid fence revision')
  }
  const signature = sign(null, fenceAttestationMessage(input), input.signing.privateKey).toString(
    'base64'
  )
  if (signature.length > FENCE_ATTESTATION_MAX_CHARS) {
    throw new Error('Fence attestation exceeds the wire bound')
  }
  return signature
}

/** Verify an echoed fence attestation against the control plane's public key. */
export function verifyFenceAttestation(input: {
  scope: string
  revision: number
  payloadDigest: string
  envelopeDigest: string
  attestation: string
  publicKey: string
}): boolean {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) return false
  if (input.attestation.length === 0 || input.attestation.length > FENCE_ATTESTATION_MAX_CHARS) {
    return false
  }
  let key: KeyObject
  let signature: Buffer
  try {
    key = createPublicKey({
      key: Buffer.from(input.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    })
    signature = Buffer.from(input.attestation, 'base64')
  } catch {
    return false
  }
  if (signature.length === 0) return false
  try {
    return verify(null, fenceAttestationMessage(input), key, signature)
  } catch {
    return false
  }
}

/**
 * Re-derive the fence attestation for a stored signed envelope. Returns null
 * when the envelope is not a well-formed signed snapshot. The plane serves the
 * result in the `x-vrt-fence-attestation` response header, so no schema change
 * (and no envelope-digest change) is needed.
 */
export function fenceAttestationForEnvelope(
  envelope: unknown,
  scope: string,
  signing: SnapshotSigningContext
): FenceAttestation | null {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return null
  const record = envelope as Record<string, unknown>
  const revision = Number(record.revision)
  const payloadDigest = record.payloadDigest
  if (!Number.isSafeInteger(revision) || revision < 1) return null
  if (typeof payloadDigest !== 'string' || !/^[0-9a-f]{64}$/.test(payloadDigest)) return null
  let envelopeDigest: string
  try {
    envelopeDigest = createHash('sha256')
      .update(canonicalControlPlaneSnapshotV2(envelope))
      .digest('hex')
  } catch {
    return null
  }
  const attestation = signFenceAttestation({
    scope,
    revision,
    payloadDigest,
    envelopeDigest,
    signing,
  })
  return { revision, payloadDigest, envelopeDigest, attestation }
}
