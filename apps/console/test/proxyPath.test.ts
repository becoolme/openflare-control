import { describe, expect, it } from 'vitest'
import { proxyTarget } from '../server/proxyPath.mjs'

describe('proxyTarget', () => {
  it('accepts management API paths and keeps the query', () => {
    expect(proxyTarget('/api/v1/cells')).toBe('/api/v1/cells')
    expect(proxyTarget('/api/v1/cells?x=1')).toBe('/api/v1/cells?x=1')
    expect(proxyTarget('/api/v1/cells/abc/logs?limit=2')).toBe('/api/v1/cells/abc/logs?limit=2')
  })

  it('never exposes the cell channel or traversal escapes', () => {
    expect(proxyTarget('/api/internal/clusters/c/vrt/desired')).toBeNull()
    expect(proxyTarget('/api/v1/../internal/clusters/c/vrt/desired')).toBeNull()
    expect(proxyTarget('/api/v1/%2e%2e/internal/clusters/c/vrt/desired')).toBeNull()
    expect(proxyTarget('/api/v1/..%2finternal/clusters/c/vrt/desired')).toBeNull()
    expect(proxyTarget('/api/v2/cells')).toBeNull()
    expect(proxyTarget('/api/v1/%E0%A4%A')).toBeNull()
  })
})
