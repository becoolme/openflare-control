/**
 * Runs the shared store-conformance cases against the Postgres reference
 * store. Requires DATABASE_URL (a disposable database); skipped otherwise.
 */
import { afterAll, beforeAll, describe, it } from 'vitest'
import { Pool } from 'pg'
import { readFile } from 'node:fs/promises'
import {
  storeConformanceCases,
  type StoreConformanceHarness,
  type VrtControlStore,
} from 'openflare-control'
import { createPlaneStore } from './store.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip

const clusterId = `conf-${Date.now()}`
const teamId = `team-${Date.now()}`
const otherTeamId = `team2-${Date.now()}`
let pool: Pool
let store: VrtControlStore

maybe('openflare-plane store conformance (Postgres)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
    await pool.query(sql)
    store = createPlaneStore(pool)
  })
  afterAll(async () => {
    await pool.end()
  })

  const harness = (): StoreConformanceHarness => ({
    store,
    clusterId,
    cellId: clusterId,
    teamId,
    otherTeamId,
    createdById: 'conf-user',
    async seedWorker({ teamId: t, name }) {
      await pool.query(
        `insert into plane_workers (id, team_id, cluster_id, name)
         values ($1,$2,$3,$4) on conflict (team_id, cluster_id, name) do nothing`,
        [`${t}:${name}`, t, clusterId, name]
      )
      const res = await pool.query(
        `select * from plane_workers where team_id=$1 and cluster_id=$2 and name=$3`,
        [t, clusterId, name]
      )
      const r = res.rows[0] as Record<string, unknown>
      return {
        id: r.id as string,
        name: r.name as string,
        teamId: r.team_id as string,
        clusterId: r.cluster_id as string,
        runtime: r.runtime as string,
        status: r.status as string,
        activeVrtVersionId: (r.active_version_id as string | null) ?? null,
        entrypoint: r.entrypoint as string,
        compatibilityDate: r.compatibility_date as string,
        statusReason: (r.status_reason as string | null) ?? null,
      }
    },
  })

  for (const testCase of storeConformanceCases) {
    it(testCase.name, () => testCase.run(harness()))
  }
})
