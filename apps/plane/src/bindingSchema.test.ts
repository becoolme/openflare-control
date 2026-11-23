import { describe, expect, it } from 'vitest'
import { bindingRecordSchema } from './admin/bindingSchema.js'

describe('bindingRecordSchema', () => {
  it('accepts the supported binding shapes', () => {
    const samples = [
      { name: 'V', type: 'VAR', resourceId: 'var:1' },
      { name: 'S', type: 'SECRET', resourceId: 'secret:1' },
      { name: 'KV', type: 'KV', resourceId: 'ns', permissionRead: true, permissionWrite: false },
      {
        name: 'R2',
        type: 'R2',
        resourceId: 'bucket-name',
        permissionRead: true,
        permissionWrite: false,
      },
      {
        name: 'D1',
        type: 'D1',
        resourceId: 'a'.repeat(26),
        permissionRead: true,
        permissionWrite: false,
      },
      {
        name: 'Q',
        type: 'QUEUE',
        resourceId: 'b'.repeat(26),
        permissionRead: true,
        permissionWrite: true,
      },
      { name: 'SVC', type: 'SERVICE', resourceId: 'team:worker', entrypoint: null, props: null },
      { name: 'DO', type: 'DO', resourceId: 'team:worker:Class' },
      { name: 'FLAGS', type: 'FLAGSHIP', resourceId: 'checkout' },
      {
        name: 'VX',
        type: 'VECTORIZE',
        resourceId: 'a'.repeat(26),
        indexName: 'docs-index',
        dimensions: 768,
        metric: 'cosine',
      },
      {
        name: 'SECRETS',
        type: 'SECRETS_STORE',
        resourceId: 'default:API_KEY',
        storeId: 'default',
        secretName: 'API_KEY',
      },
    ]
    for (const sample of samples) expect(bindingRecordSchema.safeParse(sample).success).toBe(true)
  })

  it('defaults omitted data-binding permissions to true', () => {
    expect(bindingRecordSchema.parse({ name: 'KV', type: 'KV', resourceId: 'ns' })).toMatchObject({
      permissionRead: true,
      permissionWrite: true,
    })
  })

  it('rejects unknown, malformed, and incomplete bindings', () => {
    for (const sample of [
      { name: 'X', type: 'NOPE', resourceId: 'x' },
      {
        name: 'VX',
        type: 'VECTORIZE',
        resourceId: 'a'.repeat(26),
        indexName: 'docs-index',
        metric: 'cosine',
      },
      { name: 'L', type: 'WORKER_LOADER', resourceId: 'not-loader' },
      {
        name: 'SECRETS',
        type: 'SECRETS_STORE',
        resourceId: 'a:b',
        storeId: 'a:b',
        secretName: 'c',
      },
      { name: 'KV', type: 'KV', resourceId: 'ns', extra: true },
    ]) {
      expect(bindingRecordSchema.safeParse(sample).success).toBe(false)
    }
  })
})
