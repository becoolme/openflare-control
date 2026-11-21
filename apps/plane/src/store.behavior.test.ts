/**
 * Behaviour beyond the shared conformance suite: the ACK state machine,
 * retention edge cases, hostname uniqueness and the explicit 501 for port
 * methods the reference plane does not implement yet.
 */
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { VrtControlError, type VrtControlStore } from 'openflare-control'
import { createPlaneStore } from './store.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip

maybe('reference store behaviour', () => {
  let pool: Pool
  let store: VrtControlStore
  const cluster = `beh-${Date.now()}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    store = createPlaneStore(pool)
  })
  afterAll(async () => {
    await pool.end()
  })

  async function publish(envelopeDigest: string): Promise<number> {
    return store.runCellTransaction(cluster, async (tx) => {
      const revision = await tx.allocateRevision()
      await tx.createPublication({
        cause: 'DEPLOY',
        publishedById: null,
        revision,
        envelope: { schemaVersion: 1, revision },
        payloadDigest: 'a'.repeat(64),
        envelopeDigest,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      return revision
    })
  }

  it('enforces the ACK state machine atomically', async () => {
    const revision = await publish('e'.repeat(64))
    const ack = { status: 'APPLIED' as const, ackedAt: new Date(), envelopeDigest: 'e'.repeat(64) }
    expect(await store.recordPublicationAck(cluster, revision, ack)).toBe('written')
    expect(await store.recordPublicationAck(cluster, revision, ack)).toBe('idempotent')
    expect(
      await store.recordPublicationAck(cluster, revision, { ...ack, status: 'REJECTED' })
    ).toBe('terminal')
    expect(await store.recordPublicationAck(cluster, revision + 999, ack)).toBe('missing')
  })

  it('never lets two conflicting acks both win', async () => {
    const revision = await publish('f'.repeat(64))
    const base = { ackedAt: new Date(), envelopeDigest: 'f'.repeat(64) }
    const outcomes = await Promise.all([
      store.recordPublicationAck(cluster, revision, { ...base, status: 'APPLIED' }),
      store.recordPublicationAck(cluster, revision, { ...base, status: 'REJECTED' }),
    ])
    expect(outcomes.filter((o) => o === 'written')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'terminal')).toHaveLength(1)
    const row = await store.findPublication(cluster, revision)
    expect(['APPLIED', 'REJECTED']).toContain(row?.ackStatus)
  })

  it('retains non-terminal publications regardless of keep-N', async () => {
    const terminal1 = await publish('1'.repeat(64))
    const terminal2 = await publish('2'.repeat(64))
    const pending = await publish('3'.repeat(64))
    for (const [rev, d] of [
      [terminal1, '1'.repeat(64)],
      [terminal2, '2'.repeat(64)],
    ] as const) {
      await store.recordPublicationAck(cluster, rev, {
        status: 'APPLIED',
        ackedAt: new Date(),
        envelopeDigest: d,
      })
    }
    await store.pruneTerminalPublications({
      keepPerCell: 0,
      batchSize: 10,
      maxRows: 100,
      deadlineMs: 5_000,
    })
    expect(await store.findPublication(cluster, terminal1)).toBeNull()
    expect(await store.findPublication(cluster, terminal2)).toBeNull()
    expect(await store.findPublication(cluster, pending)).not.toBeNull()
  })

  it('keeps hostnames unique across workers', async () => {
    for (const name of ['a', 'b']) {
      await pool.query(
        `insert into plane_workers (id, team_id, cluster_id, name)
         values ($1,$2,$3,$4) on conflict do nothing`,
        [`${cluster}:${name}`, cluster, cluster, name]
      )
      await pool.query(
        `insert into plane_hostnames (id, hostname, worker_id) values ($1,$2,$3) on conflict do nothing`,
        [`${cluster}:${name}:h`, 'shared.example.com', `${cluster}:${name}`]
      )
    }
    expect(await store.isHostnameTaken('shared.example.com')).toBe(true)
    expect(
      await store.isHostnameTaken('shared.example.com', { excludeWorkerId: `${cluster}:a` })
    ).toBe(true)
    expect(await store.isHostnameTaken('free.example.com')).toBe(false)
  })

  it('answers unimplemented port methods with a typed 501', async () => {
    const error = await store
      .claimAssetsManifest({ digest: 'a'.repeat(64), teamId: 't', workerId: 'w' })
      .catch((e) => e)
    expect(error).toBeInstanceOf(VrtControlError)
    expect(error.status).toBe(501)
    expect(error.message).toMatch(/not implemented|does not implement/)
  })

  it('does not fake promise protocol members on the store proxy', () => {
    expect((store as unknown as { then?: unknown }).then).toBeUndefined()
  })
})

maybe('reference store revisions and versions', () => {
  let pool: Pool
  let store: VrtControlStore
  const cluster = `rev-${Date.now()}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    store = createPlaneStore(pool)
  })
  afterAll(async () => {
    await pool.end()
  })

  it('raises the revision floor only within the bounded delta', async () => {
    const revision = await store.runCellTransaction(cluster, (tx) => tx.allocateRevision())
    expect(await store.raiseCellRevisionFloor(cluster, revision)).toBe('ok')
    expect(await store.raiseCellRevisionFloor(cluster, revision + 5)).toBe('raised')
    expect(await store.raiseCellRevisionFloor(cluster, revision)).toBe('ok')
    expect(await store.raiseCellRevisionFloor(cluster, revision + 1_000_000)).toBe('rejected')
    expect(await store.raiseCellRevisionFloor(cluster, -1)).toBe('rejected')
  })

  it('lists newest versions first and honours alwaysInclude', async () => {
    await pool.query(
      `insert into plane_workers (id, team_id, cluster_id, name) values ($1,$2,$3,'v')`,
      [`${cluster}:v`, cluster, cluster]
    )
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const make = (suffix: string) =>
      store.createVersionWithBindings({
        workerId: `${cluster}:v`,
        versionId: `ver-${suffix}-${run}`,
        bundleSha256: suffix.repeat(64).slice(0, 64),
        bundleKey: `workers/v1/bundles/${suffix.repeat(64).slice(0, 64)}`,
        bundleBytes: 1,
        mainModule: 'index.js',
        modules: [],
        compatibilityDate: '2024-01-01',
        compatibilityFlags: [],
        crons: [],
        quotas: { cpuMs: 1000, memoryMb: 64, subrequests: 1, outboundConnections: 1 },
        varValues: {},
        bindingsFingerprint: suffix.repeat(32),
        runtimeConfigDigest: suffix.repeat(64).slice(0, 64),
        bindings: [],
        createdById: 'test',
      })
    const first = await make('a')
    await make('b')
    const limited = await store.listVersions(`${cluster}:v`, { limit: 1 })
    expect(limited).toHaveLength(1)
    expect(limited[0]!.versionId).toBe(`ver-b-${run}`)
    const withOld = await store.listVersions(`${cluster}:v`, {
      limit: 1,
      alwaysIncludeVersionId: first.version.versionId,
    })
    expect(withOld.map((v) => v.versionId)).toContain(first.version.versionId)
  })

  it('marks an uploaded version failed but never an active one', async () => {
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await pool.query(
      `insert into plane_workers (id, team_id, cluster_id, name, active_version_id)
       values ($1,$2,$3,'m','active-1')`,
      [`${cluster}:m-${run}`, cluster, cluster]
    )
    for (const [versionId, status] of [
      [`uploaded-${run}`, 'UPLOADED'],
      [`active-${run}`, 'ACTIVE'],
    ] as const) {
      await pool.query(
        `insert into plane_versions (version_id, worker_id, bundle_sha256, bindings_fingerprint, status, row)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          versionId,
          `${cluster}:m-${run}`,
          versionId.padEnd(64, '0'),
          versionId.padEnd(32, '0'),
          status,
          { status },
        ]
      )
    }
    await store.markVersionFailed(`uploaded-${run}`, 'boom')
    await store.markVersionFailed(`active-${run}`, 'boom')
    expect(
      (await store.getVersionByVersionId(`${cluster}:m-${run}`, `uploaded-${run}`))?.status
    ).toBe('FAILED')
    expect(
      (await store.getVersionByVersionId(`${cluster}:m-${run}`, `active-${run}`))?.status
    ).toBe('ACTIVE')
  })
})
