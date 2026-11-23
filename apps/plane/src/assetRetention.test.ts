import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { MemoryAssetStore } from './assetStore.js'
import { pruneAssets } from './assetRetention.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const sha = (v: string) => createHash('sha256').update(v).digest('hex')

maybe('asset retention', () => {
  let pool: Pool
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const cell = `assets-gc-${suffix}`
  const team = `team-${suffix}`
  const liveManifest = sha('live')
  const deadManifest = sha('dead')
  const liveObject = sha('live-object')
  const deadObject = sha('dead-object')

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(`create table if not exists plane_cells (
      cell_id text primary key, cluster_id text not null unique,
      revision bigint not null default 0, capabilities jsonb)`)
    await pool.query(`create table if not exists plane_asset_manifests (
      team_id text not null, digest text not null, total_bytes bigint not null default 0,
      objects jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(),
      primary key (team_id, digest))`)
    await pool.query(`create table if not exists plane_asset_objects (
      team_id text not null, digest text not null, bytes bigint not null,
      created_at timestamptz not null default now(), primary key (team_id, digest))`)
    await pool.query(
      `create table if not exists plane_publications (
        id uuid primary key default gen_random_uuid(), cell_id text not null, revision bigint not null,
        envelope jsonb not null, payload_digest text not null, envelope_digest text not null,
        cause text not null, worker_id text, version_id text, published_by_id text,
        published_by_source text not null default 'USER', issued_at timestamptz not null,
        expires_at timestamptz not null, ack_status text not null default 'PENDING',
        acked_at timestamptz, ack_revision bigint, ack_envelope_digest text, ack_reason text,
        ack_tenant_failures jsonb, unique (cell_id, revision))`
    )
    await pool.query('insert into plane_cells (cell_id, cluster_id) values ($1,$1)', [cell])
    const envelope = {
      payload: {
        tenants: [
          {
            tenantId: team,
            workers: [{ bindings: [{ type: 'assets', manifestDigest: liveManifest }] }],
          },
        ],
      },
    }
    await pool.query(
      `insert into plane_publications
        (cell_id, revision, envelope, payload_digest, envelope_digest, cause, issued_at, expires_at)
       values ($1,1,$2,$3,$3,'GC',now(),now() + interval '1 hour')`,
      [cell, envelope, sha(`pub-${suffix}`)]
    )
    for (const [digest, objects] of [
      [liveManifest, [{ digest: liveObject, bytes: 1 }]],
      [deadManifest, [{ digest: deadObject, bytes: 1 }]],
    ] as const) {
      await pool.query(
        `insert into plane_asset_manifests (team_id, digest, total_bytes, objects, created_at)
         values ($1,$2,1,$3,now() - interval '30 days')`,
        [team, digest, JSON.stringify(objects)]
      )
    }
    for (const digest of [liveObject, deadObject]) {
      await pool.query(
        `insert into plane_asset_objects (team_id, digest, bytes, created_at)
         values ($1,$2,1,now() - interval '30 days')`,
        [team, digest]
      )
    }
  })
  afterAll(async () => {
    await pool.end()
  })

  it('keeps publication-referenced manifests and their objects', async () => {
    const store = new MemoryAssetStore()
    await store.putManifest(team, liveManifest, new TextEncoder().encode('live'))
    await store.putManifest(team, deadManifest, new TextEncoder().encode('dead'))
    await store.putObject(team, liveObject, new TextEncoder().encode('live-object'))
    await store.putObject(team, deadObject, new TextEncoder().encode('dead-object'))
    const report = await pruneAssets(pool, store, 7)
    expect(report.manifestsDeleted).toBe(1)
    expect(report.objectsDeleted).toBe(1)
    expect(await store.hasManifest(team, liveManifest)).toBe(true)
    expect(await store.hasManifest(team, deadManifest)).toBe(false)
    expect(await store.hasObject(team, liveObject)).toBe(true)
    expect(await store.hasObject(team, deadObject)).toBe(false)
    expect(
      (
        await pool.query('select 1 from plane_asset_manifests where team_id=$1 and digest=$2', [
          team,
          liveManifest,
        ])
      ).rowCount
    ).toBe(1)
    expect(
      (
        await pool.query('select 1 from plane_asset_manifests where team_id=$1 and digest=$2', [
          team,
          deadManifest,
        ])
      ).rowCount
    ).toBe(0)
  })
})
