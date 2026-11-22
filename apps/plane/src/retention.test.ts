import { describe, expect, it } from 'vitest'
import { retentionFromEnv } from './retention.js'

describe('retention config', () => {
  it('uses deployment defaults', () => {
    expect(retentionFromEnv({})).toEqual({
      logRetentionDays: 7,
      opsRetentionDays: 30,
      keepPerCell: 20,
      sweepMs: 21_600_000,
    })
  })

  it('reads overrides and rejects out-of-range values', () => {
    expect(
      retentionFromEnv({
        PLANE_LOG_RETENTION_DAYS: '14',
        PLANE_OPS_RETENTION_DAYS: '90',
        PLANE_PUBLICATION_KEEP: '5',
        PLANE_RETENTION_SWEEP_MS: '0',
      })
    ).toEqual({
      logRetentionDays: 14,
      opsRetentionDays: 90,
      keepPerCell: 5,
      sweepMs: 0,
    })
    expect(() => retentionFromEnv({ PLANE_LOG_RETENTION_DAYS: '366' })).toThrow()
    expect(() => retentionFromEnv({ PLANE_OPS_RETENTION_DAYS: '3651' })).toThrow()
    expect(() => retentionFromEnv({ PLANE_PUBLICATION_KEEP: '10001' })).toThrow()
    expect(() => retentionFromEnv({ PLANE_RETENTION_SWEEP_MS: '1000' })).toThrow()
    // Invalid numbers fall back to defaults, never crash the service.
    expect(retentionFromEnv({ PLANE_LOG_RETENTION_DAYS: 'nope' }).logRetentionDays).toBe(7)
  })
})
