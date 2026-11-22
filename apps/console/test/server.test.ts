import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'server/main.mjs'), 'utf8')

describe('console proxy surface', () => {
  it('proxies only the management API, never the cell channel', () => {
    expect(source).toContain("from './proxyPath.mjs'")
    expect(source).not.toContain("'/api/internal/'")
  })

  it('injects the admin token server-side and strips cookies', () => {
    expect(source).toContain('authorization: `Bearer ${adminToken}`')
    expect(source).toContain('delete headers.cookie')
  })
})
