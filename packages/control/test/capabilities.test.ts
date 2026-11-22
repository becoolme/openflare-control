import { describe, expect, it } from 'vitest'
import {
  missingCapabilities,
  requiredCapabilities,
  VRT_CELL_CAPABILITY_KEYS,
  type VrtCapabilityNeeds,
} from '../src/index.js'

const needs = (over: Partial<VrtCapabilityNeeds> = {}): VrtCapabilityNeeds => ({
  cronCount: 0,
  bindingTypes: [],
  queueConsumerCount: 0,
  workflowCount: 0,
  crossWorkerWorkflowCount: 0,
  serviceEntrypointCount: 0,
  ...over,
})

describe('capability requirements', () => {
  it('maps optional wire fields to their cell generation bits', () => {
    expect(
      requiredCapabilities(
        needs({
          serviceEntrypointCount: 1,
          servicePropsCount: 1,
          queueDeliveryDelayCount: 1,
          workerLoaderCount: 1,
          nonDefaultQuotaCount: 1,
        })
      )
    ).toEqual(['serviceEntrypoint', 'workerLoader', 'quotas', 'serviceProps', 'queueDeliveryDelay'])
  })

  it('treats absent/unknown cells as unsupported', () => {
    const required = requiredCapabilities(needs({ servicePropsCount: 1 }))
    expect(missingCapabilities(required, null)).toEqual(['serviceProps'])
    expect(missingCapabilities(required, { serviceProps: false })).toEqual(['serviceProps'])
    expect(missingCapabilities(required, { serviceProps: true })).toEqual([])
  })

  it('keeps the ACK/derived key list as the single source', () => {
    expect(VRT_CELL_CAPABILITY_KEYS).toContain('serviceProps')
    expect(VRT_CELL_CAPABILITY_KEYS).toContain('queueDeliveryDelay')
    expect(VRT_CELL_CAPABILITY_KEYS).toContain('workerLoader')
    expect(VRT_CELL_CAPABILITY_KEYS).toContain('quotas')
    // Newer runtime bits are accepted so an older control plane never
    // rejects a healthy cell's ACK.
    for (const key of [
      'analyticsEngine',
      'flagship',
      'k2',
      'observability',
      'streamingTailConsumers',
      'unsafeEval',
    ]) {
      expect(VRT_CELL_CAPABILITY_KEYS).toContain(key)
    }
  })
})
