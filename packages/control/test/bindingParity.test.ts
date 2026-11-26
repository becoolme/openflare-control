import { describe, expect, it } from 'vitest'
import {
  buildComputeDesiredPayload,
  flagshipConfigIsValid,
  requiredCapabilities,
  serializeBinding,
  validateFlagshipConfig,
  type VrtBindingRecord,
  type VrtCellWorkerView,
} from '../src/index.js'

const binding = (over: Partial<VrtBindingRecord> & { type: VrtBindingRecord['type'] }) =>
  serializeBinding(
    {
      name: 'B',
      resourceId: 'r1',
      permissionRead: true,
      permissionWrite: false,
      ...over,
    } as VrtBindingRecord,
    'self',
    null,
    []
  )

const worker = (over: Partial<VrtCellWorkerView> = {}): VrtCellWorkerView => ({
  workerId: 'w-1',
  teamId: 'team-1',
  name: 'api',
  versionId: 'v-1',
  artifactDigest: 'a'.repeat(64),
  compatibilityDate: '2026-11-01',
  compatibilityFlags: [],
  bindings: [],
  hostnames: [],
  crons: [],
  quotas: { cpuMs: 50, memoryMb: 128, subrequests: 100, outboundConnections: 16 },
  ...over,
})

const build = (w: VrtCellWorkerView, extra: Record<string, unknown> = {}) =>
  buildComputeDesiredPayload({ cellId: 'cell-01', revision: 7, workers: [w], ...extra })

describe('new binding kinds (control-plane parity)', () => {
  it('pure-capability kinds carry the name only and validate their sentinel', () => {
    expect(binding({ type: 'WORKER_LOADER', resourceId: 'loader' })).toEqual({
      type: 'workerLoader',
      name: 'B',
    })
    expect(binding({ type: 'UNSAFE_EVAL', resourceId: 'unsafe-eval' })).toEqual({
      type: 'unsafeEval',
      name: 'B',
    })
    expect(binding({ type: 'IMAGES' })).toEqual({ type: 'images', name: 'B' })
    expect(binding({ type: 'BROWSER', resourceId: 'browser' })).toEqual({
      type: 'browser',
      name: 'B',
    })
    expect(() => binding({ type: 'BROWSER', resourceId: 'nope' })).toThrow(/browser/)
    expect(() => binding({ type: 'WORKER_LOADER', resourceId: 'nope' })).toThrow(/workerLoader/)
    expect(() => binding({ type: 'UNSAFE_EVAL', resourceId: 'nope' })).toThrow(/unsafeEval/)
  })

  it('K2 / ANALYTICS_ENGINE / FLAGSHIP carry their server-minted identity', () => {
    expect(binding({ type: 'K2', resourceId: 'f'.repeat(32) })).toEqual({
      type: 'k2',
      name: 'B',
      streamId: 'f'.repeat(32),
      permissions: { read: true, write: false },
    })
    expect(() => binding({ type: 'K2', resourceId: 'F'.repeat(32) })).toThrow(/streamId/)
    expect(binding({ type: 'ANALYTICS_ENGINE', resourceId: 'ds_1' })).toEqual({
      type: 'analyticsEngine',
      name: 'B',
      dataset: 'ds_1',
    })
    expect(() => binding({ type: 'ANALYTICS_ENGINE', resourceId: 'bad/name' })).toThrow(/dataset/)
    expect(binding({ type: 'FLAGSHIP', resourceId: 'app-1' })).toEqual({
      type: 'flagship',
      name: 'B',
      appId: 'app-1',
    })
  })

  it('SEND_EMAIL signs the restriction set and rejects both shapes at once', () => {
    expect(binding({ type: 'SEND_EMAIL' })).toEqual({
      type: 'sendEmail',
      name: 'B',
      permissions: { read: true, write: false },
    })
    expect(
      binding({
        type: 'SEND_EMAIL',
        allowedDestinationAddresses: ['a@example.com'],
        allowedSenderAddresses: ['noreply@example.com'],
      })
    ).toMatchObject({
      allowedDestinationAddresses: ['a@example.com'],
      allowedSenderAddresses: ['noreply@example.com'],
    })
    expect(() =>
      binding({
        type: 'SEND_EMAIL',
        destinationAddress: 'a@example.com',
        allowedDestinationAddresses: ['b@example.com'],
      })
    ).toThrow(/destinationAddress/)
  })
})

describe('flagship model', () => {
  const flagConfig = JSON.stringify({
    appId: 'app-1',
    flags: {
      beta: { enabled: true, type: 'boolean', variants: { on: true }, defaultVariant: 'on' },
    },
  })

  it('accepts the documented model and rejects drift', () => {
    expect(flagshipConfigIsValid(flagConfig)).toBe(true)
    expect(flagshipConfigIsValid('{"appId":"app-1"}')).toBe(false)
    expect(flagshipConfigIsValid('not json')).toBe(false)
    expect(() =>
      validateFlagshipConfig('app-1', {
        flags: {
          x: { enabled: true, type: 'boolean', variants: { on: true }, defaultVariant: 'off' },
        },
      })
    ).toThrow(/defaultVariant/)
  })

  it('a FLAGSHIP binding must name one of the tenant apps; apps ride the tenant', () => {
    const withBinding = (appId: string) =>
      worker({
        bindings: [
          {
            name: 'FLAGS',
            type: 'FLAGSHIP',
            resourceId: appId,
            permissionRead: true,
            permissionWrite: false,
          },
        ],
      })
    const payload = build(withBinding('app-1'), {
      flagshipApps: [{ tenantId: 'team-1', appId: 'app-1', config: flagConfig }],
    }).payload
    expect(payload.tenants[0]!.flagshipApps).toEqual([{ appId: 'app-1', config: flagConfig }])

    // Unknown appId → the worker is excluded, the publication survives.
    const excluded = build(withBinding('app-2'), {
      flagshipApps: [{ tenantId: 'team-1', appId: 'app-1', config: flagConfig }],
    })
    expect(excluded.payload.tenants[0]!.workers).toHaveLength(0)
    expect(excluded.excluded[0]!.reason).toMatch(/flagshipApp/)
  })

  it('a malformed stored config fails the publication', () => {
    expect(() =>
      build(worker(), { flagshipApps: [{ tenantId: 'team-1', appId: 'app-1', config: '{}' }] })
    ).toThrow(/flagshipApps/)
  })
})

describe('version-scoped worker fields', () => {
  it('typed vars and version metadata become json bindings', () => {
    const payload = build(
      worker({ jsonVars: { LIMIT: 5, FLAGS: { a: true } }, versionMetadata: 'META' })
    ).payload
    const bindings = payload.tenants[0]!.workers[0]!.bindings as Record<string, unknown>[]
    expect(bindings).toContainEqual({ type: 'json', name: 'LIMIT', value: '5' })
    expect(bindings).toContainEqual({ type: 'json', name: 'FLAGS', value: '{"a":true}' })
    expect(bindings).toContainEqual({
      type: 'json',
      name: 'META',
      value: expect.stringContaining('"id":"v-1"'),
    })
  })

  it('tail consumers must be same-tenant workers and are deduped', () => {
    const ok = build(worker({ tailConsumers: ['w-1'] })).payload.tenants[0]!.workers[0]!
    expect(ok).toMatchObject({ tailConsumers: [{ workerId: 'w-1' }] })

    const bad = build(worker({ tailConsumers: ['someone-else'] }))
    expect(bad.payload.tenants[0]!.workers).toHaveLength(0)
    expect(bad.excluded[0]!.reason).toMatch(/tailConsumers/)
  })

  it('observability is bounds-checked and omitted when absent', () => {
    const plain = build(worker()).payload.tenants[0]!.workers[0]!
    expect(plain).not.toHaveProperty('observability')

    const on = build(
      worker({
        observability: {
          enabled: true,
          logsEnabled: true,
          invocationLogs: false,
          headSamplingRatePpm: 10_000,
        },
      })
    ).payload.tenants[0]!.workers[0]!
    expect(on).toMatchObject({ observability: { headSamplingRatePpm: 10_000 } })

    const bad = build(
      worker({
        observability: {
          enabled: true,
          logsEnabled: true,
          invocationLogs: false,
          headSamplingRatePpm: 2_000_000,
        },
      })
    )
    expect(bad.payload.tenants[0]!.workers).toHaveLength(0)
    expect(bad.excluded[0]!.reason).toMatch(/headSamplingRatePpm/)
  })
})

describe('capability gating for the new binding kinds', () => {
  it('requires the cell bit that proves the binding can render', () => {
    const types = (t: string) =>
      requiredCapabilities({
        cronCount: 0,
        bindingTypes: [t],
        queueConsumerCount: 0,
        workflowCount: 0,
        crossWorkerWorkflowCount: 0,
        serviceEntrypointCount: 0,
      })
    expect(types('K2')).toEqual(expect.arrayContaining(['d1', 'k2']))
    expect(types('SEND_EMAIL')).toEqual(['email'])
    expect(types('IMAGES')).toEqual(['images'])
    expect(types('VECTORIZE')).toEqual(['vectorize'])
    expect(types('FLAGSHIP')).toEqual(['flagship'])
    expect(types('ANALYTICS_ENGINE')).toEqual(['analyticsEngine'])
    expect(types('UNSAFE_EVAL')).toEqual(['unsafeEval'])
    expect(types('WORKER_LOADER')).toEqual(['workerLoader'])
    expect(types('BROWSER')).toEqual(['browser'])
  })
})
