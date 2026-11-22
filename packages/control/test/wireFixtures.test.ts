/**
 * Cross-language contract: the desired/ack JSON that OpenFlare's cell
 * controller emits must validate under the same schema the plane uses.
 * The fixtures are copies of OpenFlare's `fixtures/vrt-wire/*` (MIT).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VRT_CELL_CAPABILITY_KEYS, vrtAckReasonForApi, vrtDesiredAckSchema } from '../src/index.js'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

describe('desired/ack wire fixtures', () => {
  it('accepts the PARTIAL fixture', () => {
    const parsed = vrtDesiredAckSchema.safeParse(fixture('desired-ack-partial.json'))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.status).toBe('PARTIAL')
      expect(vrtAckReasonForApi(parsed.data.reason)).toEqual({
        code: 'pods-not-applied',
        failedPods: 2,
      })
    }
  })

  it('accepts tenant failures with and without worker ids', () => {
    const parsed = vrtDesiredAckSchema.safeParse(fixture('desired-ack-tenant-failures.json'))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.tenantFailures).toEqual([
        {
          code: 'config-load',
          detail: 'top-level error',
          tenant: 'team-a',
          workerIds: ['w-bad', 'w-also-bad'],
        },
        { code: 'switch-failed', tenant: 'team-b' },
      ])
    }
  })

  it('accepts every capability bit a newer runtime reports', () => {
    for (const name of ['desired-ack-partial.json', 'desired-ack-tenant-failures.json']) {
      const body = fixture(name) as { capabilities?: Record<string, unknown> }
      for (const key of Object.keys(body.capabilities ?? {})) {
        expect(VRT_CELL_CAPABILITY_KEYS as readonly string[]).toContain(key)
      }
    }
  })

  it('rejects a fixture with an extra unknown field', () => {
    const body = fixture('desired-ack-partial.json') as Record<string, unknown>
    expect(vrtDesiredAckSchema.safeParse({ ...body, unexpected: true }).success).toBe(false)
  })
})
