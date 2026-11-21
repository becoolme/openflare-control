import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Boundary gate for the portable plane.
 *
 * This directory is published as the `openflare-control` package and must run
 * inside both Vibeploy and the OSS plane, so it may only
 * depend on Node builtins, `zod` and modules in this directory. Platform
 * aliases (`#lib/*`, `#modules/*`, `#services/*`, ...) and Prisma are
 * adapter details and belong on the vibeploy side of the port.
 */
const DIR = __dirname
const FILES = readdirSync(DIR).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))

const PLATFORM_PATTERN = /@prisma\/client|from '#(?:lib|modules|services|utils|types)\//

function importSpecifiers(text: string): string[] {
  const specs: string[] = []
  for (const match of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) specs.push(match[1]!)
  return specs
}

describe('portable plane boundary', () => {
  it('finds the portable modules (guards against an empty scan)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(4)
  })

  it('imports only node builtins, zod and same-directory modules', () => {
    const violations: string[] = []
    for (const file of FILES) {
      const text = readFileSync(join(DIR, file), 'utf8')
      for (const spec of importSpecifiers(text)) {
        if (spec.startsWith('node:') || spec === 'zod' || spec.startsWith('./')) continue
        violations.push(`${file}: ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('never reaches for Prisma or a platform path alias', () => {
    const violations = FILES.filter((file) =>
      PLATFORM_PATTERN.test(readFileSync(join(DIR, file), 'utf8'))
    )
    expect(violations).toEqual([])
  })
})
