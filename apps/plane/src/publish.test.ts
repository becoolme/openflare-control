import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { canonicalControlPlaneSnapshotV2, type VrtControlStore } from 'openflare-control'
import { createPlaneStore } from './store.js'
import { publishCell } from './publish.js'
import { resolvePlaneSigningKey } from './signing.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip

maybe('publishCell', () => {
  let pool: Pool
  let store: VrtControlStore
  const cluster = `pub-${Date.now()}`
  const team = `pub-team-${Date.now()}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    store = createPlaneStore(pool)
    await pool.query(
      `insert into plane_workers (id, team_id, cluster_id, name) values ($1,$2,$3,'w')`,
      [`${team}:w`, team, cluster]
    )
    const { version } = await store.createVersionWithBindings({
      workerId: `${team}:w`,
      versionId: `pv-${Date.now()}`,
      bundleSha256: 'd'.repeat(64),
      bundleKey: 'workers/v1/bundles/' + 'd'.repeat(64),
      bundleBytes: 8,
      mainModule: 'index.js',
      modules: [],
      compatibilityDate: '2024-01-01',
      compatibilityFlags: [],
      crons: [],
      quotas: { cpuMs: 50, memoryMb: 128, subrequests: 50, outboundConnections: 16 },
      varValues: {},
      bindingsFingerprint: 'd'.repeat(32),
      runtimeConfigDigest: 'd'.repeat(64),
      bindings: [],
      createdById: 'test',
    })
    await store.runCellTransaction(cluster, (tx) =>
      tx.activateVersion(`${team}:w`, version.versionId)
    )
  })
  afterAll(async () => {
    await pool.end()
  })

  it('increments the revision and records a verifiable signed envelope', async () => {
    const signing = resolvePlaneSigningKey('publish-test-secret-1234')
    const first = await publishCell(store, { cellId: cluster, signing })
    const second = await publishCell(store, {
      cellId: cluster,
      signing,
      cause: 'SYSTEM_RENEWAL',
    })
    expect(second).toBe(first + 1)

    const latest = await store.latestPublication(cluster)
    expect(latest?.revision).toBe(second)
    expect(latest?.payloadDigest).toBe(
      (await import('node:crypto'))
        .createHash('sha256')
        .update(canonicalControlPlaneSnapshotV2((latest!.envelope as { payload: unknown }).payload))
        .digest('hex')
    )
    const envelope = latest!.envelope as {
      kind: string
      payload: { tenants: { workers: { workerId: string }[] }[] }
    }
    expect(envelope.kind).toBe('compute.desired')
    expect(envelope.payload.tenants[0]!.workers[0]!.workerId).toBe(`${team}:w`)
  })

  it('serializes concurrent publishes on the cell row', async () => {
    const signing = resolvePlaneSigningKey('publish-test-secret-1234')
    const revisions = await Promise.all(
      Array.from({ length: 4 }, () => publishCell(store, { cellId: cluster, signing }))
    )
    expect(new Set(revisions).size).toBe(4)
    expect((await store.latestPublication(cluster))?.revision).toBe(Math.max(...revisions))
  })
})
