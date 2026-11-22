import { describe, expect, it } from 'vitest'
import {
  collectCrossWorkerTargets,
  isCloudflareR2BucketName,
  isVrtPrefixedHostname,
  matchPrefixedRouteBase,
  normalizeVrtCellCapabilities,
  validVrtCronExpression,
  validVrtServiceEntrypoint,
  vrtQuotaSchema,
  wildcardOverlapsVrtPrefix,
} from '../src/index.js'

describe('cross-worker target collection', () => {
  it('dedupes and excludes self references', () => {
    const targets = collectCrossWorkerTargets(
      'self',
      [
        { type: 'SERVICE', resourceId: 'a' },
        { type: 'SERVICE', resourceId: 'a' },
        { type: 'DO', resourceId: 'b:K' },
        { type: 'DO', resourceId: 'self:K' },
        { type: 'KV', resourceId: 'ignored' },
      ],
      ['c', null, 'self']
    )
    expect(targets).toEqual([
      { workerId: 'a', requireActive: true, kind: 'service' },
      { workerId: 'b', requireActive: false, kind: 'durableObject' },
      { workerId: 'c', requireActive: false, kind: 'workflow' },
    ])
  })
})

describe('capability bits', () => {
  it('normalizes unknown keys away and non-true bits to false', () => {
    expect(normalizeVrtCellCapabilities({ cron: true, assets: 'yes', kv: 1, extra: true })).toEqual(
      {
        cron: true,
        assets: false,
        d1: false,
        queue: false,
        workflows: false,
        workflowsOps: false,
        workflowsCrossWorker: false,
        d1CellOps: false,
        storagePurge: false,
        kv: false,
        r2: false,
        serviceEntrypoint: false,
        workerLoader: false,
        quotas: false,
        serviceProps: false,
        queueDeliveryDelay: false,
        analyticsEngine: false,
        flagship: false,
        email: false,
        images: false,
        k2: false,
        observability: false,
        streamingTailConsumers: false,
        unsafeEval: false,
      }
    )
    expect(normalizeVrtCellCapabilities(null)).toBeNull()
    expect(normalizeVrtCellCapabilities([])).toBeNull()
  })
})

describe('route-base guards', () => {
  const policies = [{ domain: 'example.com', labelPrefix: 'w-' }]

  it('matches only prefixed labels inside the domain', () => {
    expect(matchPrefixedRouteBase('w-a.example.com', policies)).toEqual(policies[0])
    expect(matchPrefixedRouteBase('a.example.com', policies)).toBeUndefined()
    expect(matchPrefixedRouteBase('w-a.other.com', policies)).toBeUndefined()
    expect(isVrtPrefixedHostname('W-B.Example.com', policies)).toBe(true)
  })

  it('refuses wildcards that would cover a prefixed namespace', () => {
    expect(wildcardOverlapsVrtPrefix('*.example.com', policies)).toBe(true)
    expect(wildcardOverlapsVrtPrefix('*.other.com', policies)).toBe(false)
    expect(wildcardOverlapsVrtPrefix('example.com', policies)).toBe(true)
  })
})

describe('quotas and cron validation', () => {
  it('bounds quotas and rejects unknown keys', () => {
    expect(
      vrtQuotaSchema.safeParse({
        cpuMs: 50,
        memoryMb: 128,
        subrequests: 50,
        outboundConnections: 16,
      }).success
    ).toBe(true)
    expect(
      vrtQuotaSchema.safeParse({
        cpuMs: 0,
        memoryMb: 128,
        subrequests: 50,
        outboundConnections: 16,
      }).success
    ).toBe(false)
    expect(
      vrtQuotaSchema.safeParse({
        cpuMs: 50,
        memoryMb: 128,
        subrequests: 50,
        outboundConnections: 16,
        extra: true,
      }).success
    ).toBe(false)
  })

  it('accepts five-field cron expressions only', () => {
    expect(validVrtCronExpression('*/5 * * * *')).toBe(true)
    expect(validVrtCronExpression('0 0 * * MON')).toBe(true)
    expect(validVrtCronExpression('@daily')).toBe(false)
    expect(validVrtCronExpression('* * * *')).toBe(false)
    expect(validVrtCronExpression('60 * * * *')).toBe(false)
    expect(validVrtCronExpression('* * * * * *')).toBe(false)
  })
})

describe('service entrypoints and R2 bucket names', () => {
  it('reserves the Vrt/vrt prefix for system entrypoints', () => {
    expect(validVrtServiceEntrypoint('MyEntry')).toBe(true)
    expect(validVrtServiceEntrypoint('VrtInternal')).toBe(false)
    expect(validVrtServiceEntrypoint('vrtInternal')).toBe(false)
  })

  it('accepts bucket names the platform may create', () => {
    expect(isCloudflareR2BucketName('my-bucket')).toBe(true)
    expect(isCloudflareR2BucketName('vrt-mine')).toBe(false)
    expect(isCloudflareR2BucketName('ab')).toBe(false)
    expect(isCloudflareR2BucketName('UPPER')).toBe(false)
  })
})
