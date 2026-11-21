import { describe, expect, it } from 'vitest'
import {
  hyperdriveBindingId,
  hyperdriveCredentialRef,
  hyperdriveResourceId,
  parseHyperdriveResourceId,
} from '../src/index.js'

describe('hyperdrive target codec', () => {
  it('mints distinct namespaces per target kind', () => {
    expect(hyperdriveResourceId('tenant', 't1')).toBe('vrtpg:t1')
    expect(hyperdriveResourceId('database', 'db1')).toBe('vrtdb:db1')
    expect(hyperdriveCredentialRef('tenant', 't1')).toBe('vrtpgcred:t1')
    expect(hyperdriveCredentialRef('database', 'db1')).toBe('vrtdbcred:db1')
    expect(hyperdriveBindingId('tenant', 't1', 'DB')).toBe('vrthd:t1:DB')
    expect(hyperdriveBindingId('database', 'db1', 'DB')).toBe('vrthdb:db1:DB')
  })

  it('parses the resource namespace and fails closed otherwise', () => {
    expect(parseHyperdriveResourceId('vrtpg:t1')).toEqual({ kind: 'tenant', targetId: 't1' })
    expect(parseHyperdriveResourceId('vrtdb:db1')).toEqual({ kind: 'database', targetId: 'db1' })
    expect(parseHyperdriveResourceId('vrtpg:')).toBeNull()
    expect(parseHyperdriveResourceId('other:t1')).toBeNull()
  })
})
