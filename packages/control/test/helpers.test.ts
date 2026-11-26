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
        vectorizePurge: false,
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
        vectorize: false,
        observability: false,
        secretsStore: false,
        tailConsumers: false,
        streamingTailConsumers: false,
        unsafeEval: false,
        versionMetadata: false,
        browser: false,
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

  it('uses Cloudflare day-of-week numbering (1=Sunday..7=Saturday, no 0)', () => {
    expect(validVrtCronExpression('0 0 * * 1-7')).toBe(true)
    expect(validVrtCronExpression('0 0 * * 5-7')).toBe(true)
    expect(validVrtCronExpression('0 0 * * 0')).toBe(false)
    expect(validVrtCronExpression('0 0 * * 0-7')).toBe(false)
    expect(validVrtCronExpression('0 0 * * 7-5')).toBe(false)
    expect(validVrtCronExpression('0 0 * * 6-8')).toBe(false)
    // Mixed name/numeric ranges order on the same internal scale:
    // 2 and MON are the same day, so 2-MON is a valid degenerate range.
    expect(validVrtCronExpression('0 0 * * 2-MON')).toBe(true)
    expect(validVrtCronExpression('0 0 * * MON-2')).toBe(true)
    expect(validVrtCronExpression('0 0 * * FRI-SUN')).toBe(true)
    expect(validVrtCronExpression('0 0 * * SUN-SUN')).toBe(true)
    expect(validVrtCronExpression('0 0 * * SAT-SUN')).toBe(true)
  })

  it('accepts Cloudflare day modifiers in dom/dow positions only', () => {
    // day-of-month: L (last day), LW (last weekday), nW (nearest weekday)
    expect(validVrtCronExpression('0 0 L * *')).toBe(true)
    expect(validVrtCronExpression('0 0 LW * *')).toBe(true)
    expect(validVrtCronExpression('0 0 lw * *')).toBe(true)
    expect(validVrtCronExpression('0 0 15W * *')).toBe(true)
    expect(validVrtCronExpression('0 0 15w * *')).toBe(true)
    expect(validVrtCronExpression('0 0 L,15W * *')).toBe(true)
    expect(validVrtCronExpression('0 0 32W * *')).toBe(false)
    expect(validVrtCronExpression('0 0 W * *')).toBe(false)
    expect(validVrtCronExpression('0 0 L/2 * *')).toBe(false)
    // day-of-week: xL (last x-weekday), x#n (nth x-weekday, n 1-5)
    expect(validVrtCronExpression('0 0 * * 6L')).toBe(true)
    expect(validVrtCronExpression('0 0 * * FRIL')).toBe(true)
    expect(validVrtCronExpression('0 0 * * MON#2')).toBe(true)
    expect(validVrtCronExpression('0 0 * * 5#3')).toBe(true)
    expect(validVrtCronExpression('0 0 * * MON#6')).toBe(false)
    expect(validVrtCronExpression('0 0 * * L#2')).toBe(false)
    expect(validVrtCronExpression('0 0 * * L')).toBe(false)
    expect(validVrtCronExpression('0 0 * * 8L')).toBe(false)
    // modifiers are not valid in other positions
    expect(validVrtCronExpression('L * * * *')).toBe(false)
    expect(validVrtCronExpression('0 L * * *')).toBe(false)
    expect(validVrtCronExpression('0 0 * L *')).toBe(false)
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
