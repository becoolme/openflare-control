import { describe, expect, it } from 'vitest'
import { serializeBinding, type VrtBindingRecord } from '../src/index.js'

const binding = (over: Partial<VrtBindingRecord> & { type: VrtBindingRecord['type'] }) =>
  serializeBinding(
    {
      name: 'B',
      resourceId: 'r1',
      permissionRead: true,
      permissionWrite: false,
      ...over,
    } as VrtBindingRecord,
    'self',
    null,
    []
  )

describe('serializeBinding', () => {
  it('VAR / SECRET emit refs and reject invalid identifiers', () => {
    expect(binding({ type: 'VAR', resourceId: 'var:1' })).toEqual({
      type: 'var',
      name: 'B',
      varRef: 'var:1',
    })
    expect(binding({ type: 'SECRET' })).toMatchObject({ type: 'secret', secretRef: 'r1' })
    expect(() => binding({ type: 'VAR', resourceId: 'bad ref' })).toThrow(/varRef/)
    expect(() => binding({ type: 'SECRET', resourceId: 'bad ref' })).toThrow(/secretRef/)
  })

  it('KV / R2 / D1 / QUEUE carry permissions and validated ids', () => {
    expect(binding({ type: 'KV', resourceId: 'ns1' })).toEqual({
      type: 'kv',
      name: 'B',
      namespaceId: 'ns1',
      permissions: { read: true, write: false },
    })
    expect(binding({ type: 'R2', resourceId: 'my-bucket' })).toMatchObject({
      type: 'r2',
      bucket: 'my-bucket',
    })
    expect(binding({ type: 'D1', resourceId: 'a'.repeat(26) })).toMatchObject({
      type: 'd1',
      databaseId: 'a'.repeat(26),
      epoch: 1,
    })
    expect(binding({ type: 'QUEUE', resourceId: 'b'.repeat(26) })).toMatchObject({
      type: 'queue',
      queueId: 'b'.repeat(26),
      queueName: 'b'.repeat(26),
    })
    expect(() => binding({ type: 'R2', resourceId: 'UPPER' })).toThrow(/bucket/)
    expect(() => binding({ type: 'D1', resourceId: 'short' })).toThrow(/databaseId/)
    expect(() => binding({ type: 'QUEUE', resourceId: 'short' })).toThrow(/queueId/)
  })

  it('PG and HYPERDRIVE emit references only', () => {
    expect(binding({ type: 'PG', resourceId: 'vrtpg:t1' })).toMatchObject({
      type: 'pg',
      databaseId: 'vrtpg:t1',
      credentialRef: 'vrtpgcred:t1',
    })
    const hd = binding({ type: 'HYPERDRIVE', resourceId: 'vrtdb:db1' })
    expect(hd).toMatchObject({
      type: 'hyperdrive',
      bindingId: 'vrthdb:db1:B',
      credentialRef: 'vrtdbcred:db1',
    })
    expect(hd.syntheticHost).toMatch(/^hd[0-9a-f]{24}\.hyperdrive\.vrt\.internal$/)
    expect(() => binding({ type: 'PG', resourceId: 'pg:1' })).toThrow(/databaseId/)
    expect(() => binding({ type: 'HYPERDRIVE', resourceId: 'other:1' })).toThrow(/databaseId/)
  })

  it('RATELIMIT parses and bounds the minted shape', () => {
    expect(binding({ type: 'RATELIMIT', resourceId: '123:100:60' })).toEqual({
      type: 'ratelimit',
      name: 'B',
      namespaceId: '123',
      limit: 100,
      period: 60,
    })
    expect(() => binding({ type: 'RATELIMIT', resourceId: '123:0:60' })).toThrow(/ratelimit/)
    expect(() => binding({ type: 'RATELIMIT', resourceId: '123:100:30' })).toThrow(/ratelimit/)
    expect(() => binding({ type: 'RATELIMIT', resourceId: '123:2000000:60' })).toThrow(/limit/)
  })

  it('SERVICE omits the entrypoint unless declared and validates it', () => {
    expect(binding({ type: 'SERVICE', resourceId: 'w2' })).toEqual({
      type: 'service',
      name: 'B',
      workerId: 'w2',
    })
    expect(binding({ type: 'SERVICE', resourceId: 'w2', entrypoint: 'MyEntry' })).toMatchObject({
      entrypoint: 'MyEntry',
    })
    expect(() => binding({ type: 'SERVICE', resourceId: 'w2', entrypoint: 'vrtInternal' })).toThrow(
      /entrypoint/
    )
  })

  it('SERVICE props is an object bounded to 8 KiB and omitted when absent', () => {
    expect(
      binding({ type: 'SERVICE', resourceId: 'w2', entrypoint: 'E', props: { a: 1, b: 'x' } })
    ).toMatchObject({ entrypoint: 'E', props: { a: 1, b: 'x' } })
    expect(binding({ type: 'SERVICE', resourceId: 'w2', props: null })).toEqual({
      type: 'service',
      name: 'B',
      workerId: 'w2',
    })
    for (const bad of [[], 'x', 1, true]) {
      expect(() =>
        binding({
          type: 'SERVICE',
          resourceId: 'w2',
          props: bad as unknown as Record<string, unknown>,
        })
      ).toThrow(/props/)
    }
    expect(() =>
      binding({ type: 'SERVICE', resourceId: 'w2', props: { big: 'x'.repeat(8193) } })
    ).toThrow(/props/)
  })

  it('QUEUE emits deliveryDelaySeconds only when declared, including 0', () => {
    expect(binding({ type: 'QUEUE', resourceId: 'b'.repeat(26) })).not.toHaveProperty(
      'deliveryDelaySeconds'
    )
    expect(
      binding({ type: 'QUEUE', resourceId: 'b'.repeat(26), deliveryDelaySeconds: 0 })
    ).toMatchObject({ deliveryDelaySeconds: 0 })
    expect(
      binding({ type: 'QUEUE', resourceId: 'b'.repeat(26), deliveryDelaySeconds: 86_400 })
    ).toMatchObject({ deliveryDelaySeconds: 86_400 })
    for (const bad of [-1, 86_401, 1.5]) {
      expect(() =>
        binding({ type: 'QUEUE', resourceId: 'b'.repeat(26), deliveryDelaySeconds: bad })
      ).toThrow(/deliveryDelaySeconds/)
    }
  })

  it('WORKER_LOADER emits only the binding name', () => {
    expect(binding({ type: 'WORKER_LOADER', resourceId: '' })).toEqual({
      type: 'workerLoader',
      name: 'B',
    })
  })

  it('DO names the declaring worker only for cross-worker classes', () => {
    expect(binding({ type: 'DO', resourceId: 'w2:Klass' })).toEqual({
      type: 'durableObject',
      name: 'B',
      className: 'Klass',
      serviceWorkerId: 'w2',
    })
    expect(binding({ type: 'DO', resourceId: 'self:Klass' })).toEqual({
      type: 'durableObject',
      name: 'B',
      className: 'Klass',
    })
    expect(() => binding({ type: 'DO', resourceId: 'no-colon' })).toThrow(/durableObject/)
  })

  it('ASSETS carries the manifest digest and the version routing mode', () => {
    const digest = 'a'.repeat(64)
    expect(
      serializeBinding(
        {
          type: 'ASSETS',
          name: 'B',
          resourceId: digest,
          permissionRead: true,
          permissionWrite: false,
        },
        'self',
        'ASSETS_FIRST',
        ['/api/*']
      )
    ).toMatchObject({
      type: 'assets',
      manifestDigest: digest,
      assetsFirst: true,
      runWorkerFirst: ['/api/*'],
    })
    expect(
      serializeBinding(
        {
          type: 'ASSETS',
          name: 'B',
          resourceId: digest,
          permissionRead: true,
          permissionWrite: false,
        },
        'self',
        'WORKER_FIRST',
        []
      )
    ).toMatchObject({
      assetsFirst: true,
      runWorkerFirst: true,
    })
    expect(() => binding({ type: 'ASSETS', resourceId: 'not-hex' })).toThrow(/manifestDigest/)
  })

  it('rejects an unknown binding type', () => {
    expect(() => binding({ type: 'NOPE' as never })).toThrow(/bindings.type/)
  })
})
