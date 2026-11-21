import { describe, expect, it } from 'vitest'
import { bundleDigestsInEnvelope, liveBundleDigestsFromRows } from '../src/index.js'

const digest = (c: string) => c.repeat(64)
const envelope = (...digests: string[]) => ({
  payload: {
    tenants: [
      {
        workers: digests.map((d, i) => ({
          workerId: `w${i}`,
          activeVersion: { artifactDigest: d },
        })),
      },
    ],
  },
})

describe('publication digests', () => {
  it('collects bundle digests from every tenant/worker', () => {
    const set = bundleDigestsInEnvelope(envelope(digest('a'), digest('b')))
    expect([...set].sort()).toEqual([digest('a'), digest('b')])
  })

  it('ignores malformed entries and non-hex digests', () => {
    const bad = {
      payload: {
        tenants: [
          { workers: [{ activeVersion: { artifactDigest: 'nope' } }, {}] },
          { workers: 'x' },
          null,
        ],
      },
    }
    expect(bundleDigestsInEnvelope(bad).size).toBe(0)
    expect(bundleDigestsInEnvelope(null).size).toBe(0)
  })

  it('returns null when the retained row set exceeds the fail-closed cap', () => {
    expect(liveBundleDigestsFromRows([envelope(digest('a'))], 1)?.size).toBe(1)
    expect(liveBundleDigestsFromRows([envelope(digest('a')), envelope(digest('b'))], 1)).toBeNull()
  })
})
