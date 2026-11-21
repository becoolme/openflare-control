import { describe, expect, it } from 'vitest'
import {
  desiredWorkerVersions,
  vrtAckReasonForApi,
  vrtAckTenantFailureSchema,
  vrtDesiredAckSchema,
} from '../src/index.js'

const baseAck = {
  revision: 3,
  payloadDigest: 'a'.repeat(64),
  envelopeDigest: 'b'.repeat(64),
  fenceRevision: 3,
  status: 'APPLIED' as const,
}

describe('desired ACK wire schema', () => {
  it('accepts the minimal ack', () => {
    expect(vrtDesiredAckSchema.safeParse(baseAck).success).toBe(true)
  })

  it('is strict: unknown fields are malformed, not ignored', () => {
    expect(vrtDesiredAckSchema.safeParse({ ...baseAck, extra: 1 }).success).toBe(false)
  })

  it('rejects short digests, bad statuses, bad revisions', () => {
    expect(vrtDesiredAckSchema.safeParse({ ...baseAck, payloadDigest: 'abc' }).success).toBe(false)
    expect(vrtDesiredAckSchema.safeParse({ ...baseAck, status: 'DONE' }).success).toBe(false)
    expect(vrtDesiredAckSchema.safeParse({ ...baseAck, revision: 0 }).success).toBe(false)
    expect(vrtDesiredAckSchema.safeParse({ ...baseAck, fenceRevision: -1 }).success).toBe(false)
  })

  it('bounds tenant failure entries and their codes', () => {
    expect(
      vrtAckTenantFailureSchema.safeParse({ tenant: 't', code: 'switch-failed' }).success
    ).toBe(true)
    expect(vrtAckTenantFailureSchema.safeParse({ tenant: 't', code: 'Bad Code' }).success).toBe(
      false
    )
    expect(vrtAckTenantFailureSchema.safeParse({ tenant: 't', code: 'ok', extra: 1 }).success).toBe(
      false
    )
    const many = Array.from({ length: 129 }, (_, i) => ({ tenant: `t${i}`, code: 'bridge-failed' }))
    expect(vrtDesiredAckSchema.safeParse({ ...baseAck, tenantFailures: many }).success).toBe(false)
  })
})

describe('ack reason whitelist', () => {
  it('exposes only typed codes', () => {
    expect(vrtAckReasonForApi('switch-failed')).toEqual({ code: 'switch-failed' })
    expect(vrtAckReasonForApi('tenant-failed:secret-name')).toEqual({ code: 'tenant-failed' })
    expect(vrtAckReasonForApi('not-a-code')).toBeNull()
    expect(vrtAckReasonForApi(null)).toBeNull()
  })

  it('collapses pod identities to a count', () => {
    expect(vrtAckReasonForApi('pods-not-applied:p0,p1,p2')).toEqual({
      code: 'pods-not-applied',
      failedPods: 3,
    })
  })
})

describe('desiredWorkerVersions', () => {
  it('extracts worker → version/tenant from the signed payload', () => {
    const envelope = {
      payload: {
        tenants: [
          { tenantId: 't1', workers: [{ workerId: 'w1', activeVersion: { versionId: 'v1' } }] },
          { tenantId: 't2', workers: [] },
        ],
      },
    }
    expect(desiredWorkerVersions(envelope)).toEqual(
      new Map([['w1', { versionId: 'v1', tenantId: 't1' }]])
    )
  })

  it('fails closed on malformed payloads and skips incomplete entries', () => {
    expect(desiredWorkerVersions(null)).toBeNull()
    expect(desiredWorkerVersions({ payload: { tenants: 'x' } })).toBeNull()
    expect(
      desiredWorkerVersions({
        payload: { tenants: [{ tenantId: 't', workers: [{ workerId: 'w' }] }] },
      })?.size
    ).toBe(0)
  })
})
