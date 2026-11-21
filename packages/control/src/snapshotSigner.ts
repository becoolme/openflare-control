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
import { createHash, sign, type KeyObject } from 'node:crypto'
import { canonicalControlPlaneSnapshotV2 } from './canonicalSnapshot.js'

export const SNAPSHOT_PROTOCOL_VERSION = 1
export const SNAPSHOT_PROTOCOL_CANONICAL_VERSION = 1
export const SNAPSHOT_KIND_COMPUTE_DESIRED = 'compute.desired'
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
