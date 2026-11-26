import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  latestDesiredEnvelope,
  recordDesiredAck,
  signFenceAttestation,
  vrtAckDiagnostics,
  VrtControlError,
  type VrtCellApplyFailedMark,
  type SnapshotSigningContext,
  type VrtControlStore,
  type VrtStorePublicationDetail,
} from '../src/index.js'

function fenceSigning(): SnapshotSigningContext {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  return {
    keyId: createHash('sha256').update(spki).digest('hex').slice(0, 24),
    publicKey: spki,
    privateKey,
  }
}

const envelope = { schemaVersion: 1, cellId: 'c1', revision: 1, tenants: [] }

function publication(over: Partial<VrtStorePublicationDetail> = {}): VrtStorePublicationDetail {
  return {
    id: 'p1',
    cellId: 'c1',
    revision: 1,
    payloadDigest: 'a'.repeat(64),
    envelopeDigest: 'b'.repeat(64),
    clusterId: 'c1',
    envelope,
    publishedById: null,
    publishedBySource: 'USER',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    workerId: null,
    versionId: null,
    cause: 'DEPLOY',
    ackStatus: 'PENDING',
    ackedAt: null,
    ackRevision: null,
    ackEnvelopeDigest: null,
    ackReason: null,
    ackTenantFailures: null,
    ...over,
  }
}

const store = (over: Partial<VrtControlStore>): VrtControlStore =>
  ({
    latestPublication: async () => null,
    findPublication: async () => null,
    raiseCellRevisionFloor: async () => 'ok',
    recordPublicationAck: async () => 'written',
    recordCellCapabilities: async () => undefined,
    latestAppliedPublicationBelow: async () => null,
    markWorkersDeployFailed: async () => [],
    recoverCellDeployFailures: async () => [],
    workerCellApplyRecoveredAtRevision: async () => false,
    ...over,
  }) as unknown as VrtControlStore

describe('latestDesiredEnvelope', () => {
  it('serves the stored signed envelope verbatim', async () => {
    const got = await latestDesiredEnvelope(
      store({ latestPublication: async () => publication() }),
      'c1'
    )
    expect(got).toEqual(envelope)
  })

  it('bootstraps once when the cell has never been published to', async () => {
    let calls = 0
    const got = await latestDesiredEnvelope(
      store({
        latestPublication: async () => (++calls > 1 ? publication() : null),
      }),
      'c1',
      { bootstrap: async () => 'published' }
    )
    expect(got).toEqual(envelope)
    expect(calls).toBe(2)
    const disabled = await latestDesiredEnvelope(store({}), 'c1', {
      bootstrap: async () => 'disabled',
    }).catch((error) => error)
    expect(disabled).toBeInstanceOf(VrtControlError)
    expect(disabled.status).toBe(404)
  })

  it('fails closed when the stored envelope is missing', async () => {
    const error = await latestDesiredEnvelope(
      store({ latestPublication: async () => publication({ envelope: null }) }),
      'c1'
    ).catch((e) => e)
    expect(error).toBeInstanceOf(VrtControlError)
    expect(error.status).toBe(500)
  })
})

const workerEnvelope = (versionId: string) => ({
  payload: {
    schemaVersion: 1,
    cellId: 'c1',
    revision: 1,
    tenants: [{ tenantId: 't1', workers: [{ workerId: 'w1', activeVersion: { versionId } }] }],
  },
})

describe('recordDesiredAck side effects', () => {
  it('persists capability bits reported on the ack', async () => {
    const calls: unknown[] = []
    const base = store({
      findPublication: async () => publication({ ackStatus: 'PENDING' }),
      recordCellCapabilities: async (cluster, caps) => {
        calls.push({ cluster, caps })
      },
    })
    await recordDesiredAck(base, 'c1', {
      revision: 1,
      payloadDigest: 'a'.repeat(64),
      envelopeDigest: 'b'.repeat(64),
      fenceRevision: 1,
      status: 'APPLIED',
      capabilities: { cron: true, assets: true },
    })
    expect(calls).toEqual([{ cluster: 'c1', caps: { cron: true, assets: true } }])
  })

  it('marks the changed set and hands it to the rollback hook', async () => {
    const current = publication({
      revision: 2,
      envelope: workerEnvelope('v2'),
      ackStatus: 'PENDING',
    })
    const baseline = publication({
      revision: 1,
      envelope: workerEnvelope('v1'),
      ackStatus: 'APPLIED',
    })
    let marks: readonly VrtCellApplyFailedMark[] = []
    const base = store({
      findPublication: async () => current,
      latestAppliedPublicationBelow: async () => baseline,
      markWorkersDeployFailed: async () => ['w1'],
    })
    await recordDesiredAck(
      base,
      'c1',
      {
        revision: 2,
        payloadDigest: 'a'.repeat(64),
        envelopeDigest: 'b'.repeat(64),
        fenceRevision: 2,
        status: 'APPLIED',
        tenantFailures: [{ tenant: 't1', workerIds: ['w1'], code: 'switch-failed' }],
      },
      {
        onCellApplyFailed: async (m) => {
          marks = m
        },
      }
    )
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({
      workerId: 'w1',
      teamId: 't1',
      clusterId: 'c1',
      failedVersionId: 'v2',
      rollbackVersionId: 'v1',
      code: 'switch-failed',
      markRevision: 2,
    })
  })

  it('counts PARTIAL acks that stay stuck past the threshold', async () => {
    process.env.VRT_PARTIAL_STUCK_MS = '1'
    const before = vrtAckDiagnostics.stuckPartialAcks
    const base = store({
      findPublication: async () =>
        publication({
          ackStatus: 'PENDING',
          issuedAt: new Date(Date.now() - 10_000),
        }),
    })
    await recordDesiredAck(base, 'c1', {
      revision: 1,
      payloadDigest: 'a'.repeat(64),
      envelopeDigest: 'b'.repeat(64),
      fenceRevision: 1,
      status: 'PARTIAL',
      reason: 'pods-not-applied:p0',
    })
    expect(vrtAckDiagnostics.stuckPartialAcks).toBe(before + 1)
    delete process.env.VRT_PARTIAL_STUCK_MS
  })
})

describe('recordDesiredAck', () => {
  const input = {
    revision: 1,
    payloadDigest: 'a'.repeat(64),
    envelopeDigest: 'b'.repeat(64),
    fenceRevision: 1,
    status: 'APPLIED' as const,
  }

  it('rejects an unknown revision', async () => {
    const error = await recordDesiredAck(store({}), 'c1', input).catch((e) => e)
    expect(error).toBeInstanceOf(VrtControlError)
    expect(error.status).toBe(404)
    expect(error.errorCode).toBe('VRT_ACK_UNKNOWN_REVISION')
  })

  it('binds both digests to the stored publication', async () => {
    const pub = (over: Partial<VrtStorePublicationDetail>) =>
      store({ findPublication: async () => publication(over) })
    const payload = await recordDesiredAck(
      pub({ payloadDigest: 'c'.repeat(64) }),
      'c1',
      input
    ).catch((e) => e)
    expect(payload.errorCode).toBe('VRT_ACK_DIGEST_MISMATCH')
    expect(payload.status).toBe(409)
    const env = await recordDesiredAck(pub({ envelopeDigest: 'd'.repeat(64) }), 'c1', input).catch(
      (e) => e
    )
    expect(env.errorCode).toBe('VRT_ACK_DIGEST_MISMATCH')
    expect(env.status).toBe(409)
  })

  it('persists a matching verdict and surfaces a terminal replay conflict', async () => {
    let written: unknown
    const base = store({
      findPublication: async () => publication({ ackStatus: 'PENDING' }),
      recordPublicationAck: async (_cell, _rev, ack) => {
        written = ack
        return 'written'
      },
    })
    const updated = await recordDesiredAck(base, 'c1', input)
    expect(updated).toBeDefined()
    expect(written).toMatchObject({ status: 'APPLIED', envelopeDigest: input.envelopeDigest })

    const terminal = store({
      findPublication: async () => publication({ ackStatus: 'REJECTED' }),
      recordPublicationAck: async () => 'terminal',
    })
    const error = await recordDesiredAck(terminal, 'c1', input).catch((e) => e)
    expect(error).toBeInstanceOf(VrtControlError)
    expect(error.errorCode).toBe('VRT_ACK_TERMINAL')
    expect(error.status).toBe(409)
  })
})

describe('recordDesiredAck fence proof (#63)', () => {
  const signing = fenceSigning()
  const baseInput = {
    revision: 1,
    payloadDigest: 'a'.repeat(64),
    envelopeDigest: 'b'.repeat(64),
    status: 'APPLIED' as const,
  }
  const proofFor = (revision: number) => {
    const payloadDigest = 'c'.repeat(64)
    const envelopeDigest = 'd'.repeat(64)
    return {
      revision,
      payloadDigest,
      envelopeDigest,
      attestation: signFenceAttestation({
        scope: 'cell:c1',
        revision,
        payloadDigest,
        envelopeDigest,
        signing,
      }),
    }
  }
  const verifier = { signing: { publicKey: signing.publicKey } }

  it('accepts a verified proof and raises the floor as proven', async () => {
    let called: unknown
    const base = store({
      findPublication: async () => publication({ ackStatus: 'PENDING' }),
      raiseCellRevisionFloor: async (_c, _r, opts) => {
        called = opts
        return 'raised'
      },
      recordPublicationAck: async () => 'written',
    })
    const before = vrtAckDiagnostics.fenceProofAccepted
    await recordDesiredAck(
      base,
      'c1',
      { ...baseInput, fenceRevision: 5000, fenceProof: proofFor(5000) },
      verifier
    )
    expect(called).toEqual({ proven: true })
    expect(vrtAckDiagnostics.fenceProofAccepted).toBe(before + 1)
  })

  it('rejects an invalid proof before any write (fail closed)', async () => {
    let raised = false
    let acked = false
    const base = store({
      findPublication: async () => publication({ ackStatus: 'PENDING' }),
      raiseCellRevisionFloor: async () => {
        raised = true
        return 'raised'
      },
      recordPublicationAck: async () => {
        acked = true
        return 'written'
      },
    })
    const proof = proofFor(5000)
    const error = await recordDesiredAck(
      base,
      'c1',
      {
        ...baseInput,
        fenceRevision: 5000,
        fenceProof: { ...proof, attestation: Buffer.from('bad').toString('base64') },
      },
      verifier
    ).catch((e) => e)
    expect(error).toBeInstanceOf(VrtControlError)
    expect(error.errorCode).toBe('VRT_FENCE_PROOF_INVALID')
    expect(raised).toBe(false)
    expect(acked).toBe(false)
  })

  it('rejects a proof whose revision differs from fenceRevision', async () => {
    const base = store({ findPublication: async () => publication({ ackStatus: 'PENDING' }) })
    const error = await recordDesiredAck(
      base,
      'c1',
      { ...baseInput, fenceRevision: 5000, fenceProof: proofFor(4999) },
      verifier
    ).catch((e) => e)
    expect(error.errorCode).toBe('VRT_FENCE_PROOF_INVALID')
  })

  it('requires a verifier: a proof without signing fails closed', async () => {
    const base = store({ findPublication: async () => publication({ ackStatus: 'PENDING' }) })
    const error = await recordDesiredAck(base, 'c1', {
      ...baseInput,
      fenceRevision: 5000,
      fenceProof: proofFor(5000),
    }).catch((e) => e)
    expect(error.errorCode).toBe('VRT_FENCE_PROOF_INVALID')
  })

  it('legacy bounded raises stay capped but are counted', async () => {
    const base = store({
      findPublication: async () => publication({ ackStatus: 'PENDING' }),
      raiseCellRevisionFloor: async () => 'rejected',
      recordPublicationAck: async () => 'written',
    })
    const before = vrtAckDiagnostics.fenceRaiseRejected
    const updated = await recordDesiredAck(base, 'c1', { ...baseInput, fenceRevision: 5000 })
    expect(updated).toBeDefined()
    expect(vrtAckDiagnostics.fenceRaiseRejected).toBe(before + 1)
  })
})
