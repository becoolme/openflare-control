/**
 * Retention maintenance. Deletes rows outside the deployment retention policy:
 * logs (the request/error stats source), terminal D1/cell ops (op stats source)
 * and terminal publications beyond N per cell. Pending ops are never deleted.
 *
 * Run from cron (daily is plenty) or let the plane's background sweep do it.
 *
 *   DATABASE_URL=... tsx src/maintain.ts [--keep 20] [--log-days 7] [--ops-days 30] [--metrics-days 14]
 */
import { Pool } from 'pg'
import { createPlaneStore } from './store.js'
import { pruneRetention, retentionFromEnv } from './retention.js'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const env = retentionFromEnv()
const keepPerCell = Number(arg('keep') ?? env.keepPerCell)
const logRetentionDays = Number(arg('log-days') ?? env.logRetentionDays)
const opsRetentionDays = Number(arg('ops-days') ?? env.opsRetentionDays)
const metricsRetentionDays = Number(arg('metrics-days') ?? env.metricsRetentionDays)
for (const [name, value, max] of [
  ['keep', keepPerCell, 10_000],
  ['log-days', logRetentionDays, 365],
  ['ops-days', opsRetentionDays, 3650],
  ['metrics-days', metricsRetentionDays, 365],
] as const) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`--${name} must be an integer in [0, ${max}]`)
  }
}

const pool = new Pool({ connectionString: url })
try {
  const store = createPlaneStore(pool)
  const report = await pruneRetention(pool, store, {
    ...env,
    keepPerCell,
    logRetentionDays,
    opsRetentionDays,
    metricsRetentionDays,
  })
  console.log(
    'openflare-plane retention: ' +
      `logs=${report.logsDeleted} d1Ops=${report.d1OpsDeleted} cellOps=${report.cellOpsDeleted} ` +
      `expiredD1=${report.expiredD1OpsDeleted} expiredCell=${report.expiredCellOpsDeleted} ` +
      `metrics=${report.metricsDeleted} ` +
      `publications=${report.publicationsDeleted}` +
      (report.publicationsTruncated ? ' (publication budget reached, run again)' : '')
  )
} finally {
  await pool.end()
}
