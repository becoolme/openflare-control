/**
 * Cross-language contract: the desired/ack JSON that OpenFlare's cell
 * controller emits must validate under the same schema the plane uses.
 * The fixtures are copies of OpenFlare's `fixtures/vrt-wire/*` (MIT).
 *
 * The vendored set is discovered from disk instead of hard-coded here, so a
 * fixture added by `pnpm run sync:openflare-contract` is validated immediately
 * and a runtime shape the plane does not understand fails this suite instead
 * of silently drifting. `cell-report.json` is validated by the plane package
 * (it owns that schema) — see `apps/plane/src/cellReport.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VRT_CELL_CAPABILITY_KEYS, vrtAckReasonForApi, vrtDesiredAckSchema } from '../src/index.js'

const fixturesDir = join(__dirname, 'fixtures')

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))

/** Every vendored `desired/ack` wire fixture, whatever it is named. */
const ackFixtures = readdirSync(fixturesDir)
  .filter((name) => name.startsWith('desired-ack-') && name.endsWith('.json'))
  .sort()

describe('desired/ack wire fixtures', () => {
  it('vendors at least the PARTIAL fixtures the plane is tested against', () => {
    expect(ackFixtures).toEqual(
      expect.arrayContaining(['desired-ack-partial.json', 'desired-ack-tenant-failures.json'])
    )
  })

  it('validates every vendored ACK fixture', () => {
    for (const name of ackFixtures) {
      const parsed = vrtDesiredAckSchema.safeParse(fixture(name))
      // Print the failing issues: a drift report is useless without them.
      if (!parsed.success) console.error(name, parsed.error.issues)
      expect(parsed.success, name).toBe(true)
    }
  })

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
    for (const name of ackFixtures) {
      const body = fixture(name) as { capabilities?: Record<string, unknown> }
      for (const key of Object.keys(body.capabilities ?? {})) {
        expect(VRT_CELL_CAPABILITY_KEYS as readonly string[], key).toContain(key)
      }
    }
  })

  it('rejects a fixture with an extra unknown field', () => {
    const body = fixture('desired-ack-partial.json') as Record<string, unknown>
    expect(vrtDesiredAckSchema.safeParse({ ...body, unexpected: true }).success).toBe(false)
  })
})
