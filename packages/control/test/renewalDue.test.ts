import { describe, expect, it } from 'vitest'
import { vrtPublicationNeedsRenewal } from '../src/index.js'

describe('publication renewal predicate', () => {
  const issuedAt = new Date('2026-01-01T00:00:00.000Z')
  const expiresAt = new Date('2026-01-01T01:00:00.000Z')

  it('is due once less than two-thirds of the TTL remains', () => {
    // 60 min TTL → due below 40 min remaining, i.e. after 20 min elapsed.
    expect(
      vrtPublicationNeedsRenewal({ issuedAt, expiresAt }, new Date('2026-01-01T00:19:59.000Z'))
    ).toBe(false)
    expect(
      vrtPublicationNeedsRenewal({ issuedAt, expiresAt }, new Date('2026-01-01T00:20:01.000Z'))
    ).toBe(true)
  })

  it('treats expired or inverted windows as due', () => {
    expect(
      vrtPublicationNeedsRenewal({ issuedAt, expiresAt }, new Date('2026-01-01T02:00:00.000Z'))
    ).toBe(true)
    expect(
      vrtPublicationNeedsRenewal(
        { issuedAt: expiresAt, expiresAt: issuedAt },
        new Date('2026-01-01T00:00:00.000Z')
      )
    ).toBe(true)
  })
})
