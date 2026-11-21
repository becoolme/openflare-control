import { createPublicKey, verify } from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildComputeDesiredPayload,
  canonicalControlPlaneSnapshotV2,
  publicationCoversDesired,
  signAndRecordCellPublication,
  tenantsOverShareCap,
  VrtControlError,
  type SnapshotSigningContext,
  type VrtCellTx,
  type VrtCellWorkerView,
} from '../src/index.js'

const view = (over: Partial<VrtCellWorkerView> = {}): VrtCellWorkerView => ({
  workerId: 'w1',
  teamId: 't1',
  name: 'hello',
  versionId: 'v1',
  artifactDigest: 'a'.repeat(64),
  compatibilityDate: '2024-01-01',
  compatibilityFlags: [],
  bindings: [],
  hostnames: ['hello.example.com'],
  crons: [],
  quotas: { cpuMs: 10_000, memoryMb: 128, subrequests: 50, outboundConnections: 6 },
  ...over,
})

function signing(): SnapshotSigningContext {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    keyId: 'a'.repeat(24),
  }
}

function fakeTx(workers: VrtCellWorkerView[] = [view()]): VrtCellTx {
  return {
    cellId: 'c1',
    cellView: async () => workers,
    pendingDoTombstones: async () => [],
    createPublication: async (input: {
      revision: number
      payloadDigest: string
      envelopeDigest: string
    }) => ({
      id: 'p1',
      cellId: 'c1',
      revision: input.revision,
      payloadDigest: input.payloadDigest,
      envelopeDigest: input.envelopeDigest,
    }),
  } as unknown as VrtCellTx
}

const now = new Date('2026-01-01T00:00:00.000Z')
const window = { issuedAt: now, expiresAt: new Date(now.getTime() + 60 * 60 * 1000) }

describe('signAndRecordCellPublication', () => {
  it('signs the cell view and records it in one call', async () => {
    const ctx = signing()
    const result = await signAndRecordCellPublication(fakeTx(), {
      revision: 4,
      cause: 'DEPLOY',
      publishedById: null,
      now,
      signing: ctx,
    })
    expect(result.publication.revision).toBe(4)
    expect(result.excluded).toEqual([])
    const envelope = result.publication
    expect(envelope.payloadDigest).toHaveLength(64)
  })

  it('produces an envelope verifiable by the printed public key', async () => {
    const ctx = signing()
    const recorded: { envelope: unknown }[] = []
    const tx = {
      cellId: 'c1',
      cellView: async () => [view()],
      pendingDoTombstones: async () => [],
      createPublication: async (input: {
        revision: number
        payloadDigest: string
        envelopeDigest: string
        envelope: Record<string, unknown>
      }) => {
        recorded.push({ envelope: input.envelope })
        return {
          id: 'p1',
          cellId: 'c1',
          revision: input.revision,
          payloadDigest: input.payloadDigest,
          envelopeDigest: input.envelopeDigest,
        }
      },
    } as unknown as VrtCellTx
    await signAndRecordCellPublication(tx, {
      revision: 2,
      cause: 'DEPLOY',
      publishedById: null,
      now,
      signing: ctx,
    })
    const envelope = recorded[0]!.envelope as { signature: string } & Record<string, unknown>
    const { signature, ...unsigned } = envelope
    expect(
      verify(
        null,
        Buffer.from(canonicalControlPlaneSnapshotV2(unsigned)),
        createPublicKey(ctx.privateKey),
        Buffer.from(signature, 'base64')
      )
    ).toBe(true)
  })

  it('evicts the least stable tenants above the cell tenant capacity', async () => {
    const many = Array.from({ length: 513 }, (_, i) =>
      view({
        workerId: `w${i}`,
        teamId: `t${i}`,
        name: `n${i}`,
        hostnames: [`h${i}.example.com`],
        // Keep committed memory below the cell budget so only the tenant
        // capacity rule can evict here.
        quotas: { ...view().quotas, memoryMb: 1 },
        changedAt: new Date(1_700_000_000_000 + i),
      })
    )
    const result = await signAndRecordCellPublication(fakeTx(many), {
      revision: 5,
      cause: 'SYSTEM_RENEWAL',
      publishedById: null,
      now,
      signing: signing(),
    })
    expect(result.publication.revision).toBe(5)
    expect(result.excluded).toHaveLength(1)
    // Deterministic: the tenant with the OLDEST changedAt is the one dropped.
    expect(result.excluded[0]?.workerId).toBe('w0')
  })

  it('rejects a request that would overflow its own tenant share', async () => {
    // A tiny divisor makes the cap a handful of bytes.
    const error = await signAndRecordCellPublication(fakeTx(), {
      revision: 1,
      cause: 'DEPLOY',
      publishedById: null,
      now,
      signing: signing(),
      requestTeamId: 't1',
      tenantShareDivisor: 100_000,
    }).catch((e) => e)
    expect(error).toBeInstanceOf(VrtControlError)
    expect(error.status).toBe(413)
  })
})

describe('publicationCoversDesired', () => {
  const payload = buildComputeDesiredPayload({
    cellId: 'c1',
    revision: 3,
    workers: [view()],
    deletions: [],
  }).payload
  const base = { revision: 3, envelope: { payload }, ackStatus: 'APPLIED' as const, ...window }

  it('is true only for an unchanged, fresh, applied publication', async () => {
    expect(await publicationCoversDesired(fakeTx(), base, now)).toBe(true)
    expect(await publicationCoversDesired(fakeTx([view({ name: 'changed' })]), base, now)).toBe(
      false
    )
    expect(await publicationCoversDesired(fakeTx(), { ...base, ackStatus: 'REJECTED' }, now)).toBe(
      false
    )
    expect(
      await publicationCoversDesired(fakeTx(), base, new Date(now.getTime() + 59 * 60_000))
    ).toBe(false)
  })

  it('fails toward publishing when the stored envelope is unusable', async () => {
    expect(await publicationCoversDesired(fakeTx(), { ...base, envelope: null }, now)).toBe(false)
  })
})

describe('tenantsOverShareCap', () => {
  it('reports nothing at the default divisor and the offender at a tiny cap', () => {
    expect(tenantsOverShareCap('c1', [view()], 8)).toEqual([])
    expect(tenantsOverShareCap('c1', [view()], 100_000)).toEqual(['t1'])
  })
})
