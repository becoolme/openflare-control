# Revision-fence proofs (issue #63)

`recordDesiredAck` raises the per-cell revision floor toward the `fenceRevision`
a cell reports, so a control plane restored from an older backup never re-signs
a revision the cell already fenced. The fence used to be a self-asserted
integer bounded by `VRT_FENCE_RAISE_MAX_DELTA` (1000); that left three gaps:

1. **Grinding** — a compromised cell could raise the floor by +1000 per ack, without limit.
2. **Silent rejection** — an over-bound raise only logged a warning; the ack still succeeded.
3. **Restore deadlock** — a cell whose fence is more than 1000 revisions ahead of a
   restored plane can never heal: every raise is rejected and the cell keeps
   rejecting new signed documents.

## Design

A compact, domain-separated **fence attestation** proves "the plane signed
revision N with these digests" without shipping the full (up to 512 KiB) envelope.

```
message = canonical({ kind: "compute.desired.fence", scope: "cell:<cellId>",
                       revision, payloadDigest, envelopeDigest })
attestation = base64(Ed25519-sign(planeKey, message))
```

- The plane **derives** the attestation from the stored signed envelope at read
  time (Ed25519 is deterministic) and serves it **out-of-band** in headers on
  `GET /vrt/desired`:
  `x-vrt-fence-attestation`, `x-vrt-fence-revision`. The signed envelope and its
  digest are unchanged, so old cells that ignore the headers are unaffected.
- The cell persists `{revision, payloadDigest, envelopeDigest, attestation}` for
  the highest document it accepted. When its fence is **ahead of the revision it
  is acking** (typically after a plane restore), it echoes:

```json
"fenceProof": {
  "revision": 5000,
  "payloadDigest": "<64 hex>",
  "envelopeDigest": "<64 hex>",
  "attestation": "<base64>"
}
```

- The plane verifies the attestation with its **trusted public key** (the signing
  secret lives in config, not the database, so a database restore cannot forge
  it) and requires `proof.revision === fenceRevision`. Only then may the floor be
  raised past the bounded delta.
- A **present but invalid** proof fails the ack closed (`400 VRT_FENCE_PROOF_INVALID`)
  before any write, and increments `vrtAckDiagnostics.fenceProofRejected`.
- A **missing** proof keeps the bounded-integer path (old cells) and increments
  `fenceRaiseRejected` when the bound refuses it, so the deadlock is observable.

## Security properties

- **Forgery/grinding**: raising past the bound requires a valid plane signature;
  a compromised cell cannot mint one.
- **Cross-cell replay**: the message binds `scope = cell:<cellId>`, so an
  attestation from one cell cannot be replayed against another.
- **Replay within a cell**: raising the floor to an old revision is a no-op
  (`reported <= current`), and the floor never decreases.
- **Restore liveness**: a valid proof raises the floor to the proven revision
  regardless of how far ahead it is.

## Wire compatibility / migration

- The ack field is optional; the response headers are ignored by old cells.
- Old cells keep the bounded path. Their restore deadlock heals once the cell
  firmware persists and echoes the attestation (openflare runtime change).
- `VrtStorePort.raiseRevisionFloor(reported, { proven })` is the single gate;
  both the plane SQL store and its cell transaction honor it.

## Tests

- `packages/control/test/fenceProof.test.ts` — sign/verify round-trip, tampered
  revision/digest/scope/attestation/key, derivation from a stored envelope.
- `packages/control/test/cellSync.test.ts` — verified proof raises as `proven`,
  invalid/mismatched/missing-verifier proofs fail closed with no write, legacy
  raises stay capped and are counted.
- `packages/control/src/storeConformance.ts` — a proven raise may jump beyond the
  bounded delta.
- `apps/plane/src/routes.test.ts` — `GET /vrt/desired` serves a verifiable
  `x-vrt-fence-attestation` for the served revision.
