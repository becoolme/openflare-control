/**
 * Retention policy for operator-visible data. Deployment decides how long the
 * plane keeps logs (the source of request/error metrics), terminal D1/cell ops
 * (the source of op stats) and publication history.
 *
 *   PLANE_LOG_RETENTION_DAYS=7      # 0 = keep forever
 *   PLANE_OPS_RETENTION_DAYS=30     # terminal ops only; pending is never deleted
 *   PLANE_PUBLICATION_KEEP=20       # rows per cell (existing prune semantics)
 *   PLANE_RETENTION_SWEEP_MS=21600000
 */
import type { Pool } from 'pg'
import type { VrtControlStore } from 'openflare-control'

export interface RetentionConfig {
  logRetentionDays: number
  opsRetentionDays: number
  keepPerCell: number
  sweepMs: number
}

const int = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback
}

export function retentionFromEnv(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const logRetentionDays = int(env.PLANE_LOG_RETENTION_DAYS, 7)
  const opsRetentionDays = int(env.PLANE_OPS_RETENTION_DAYS, 30)
  const keepPerCell = int(env.PLANE_PUBLICATION_KEEP, 20)
  const sweepMs = int(env.PLANE_RETENTION_SWEEP_MS, 6 * 60 * 60 * 1000)
  if (logRetentionDays > 365) throw new Error('PLANE_LOG_RETENTION_DAYS must be <= 365')
  if (opsRetentionDays > 3650) throw new Error('PLANE_OPS_RETENTION_DAYS must be <= 3650')
  if (keepPerCell > 10_000) throw new Error('PLANE_PUBLICATION_KEEP must be <= 10000')
  if (sweepMs !== 0 && sweepMs < 60_000) {
    throw new Error('PLANE_RETENTION_SWEEP_MS must be 0 or >= 60000')
  }
  return { logRetentionDays, opsRetentionDays, keepPerCell, sweepMs }
}

export interface RetentionReport {
  logsDeleted: number
  d1OpsDeleted: number
  cellOpsDeleted: number
  publicationsDeleted: number
  publicationsTruncated: boolean
}

async function deleteBatched(
  pool: Pool,
  sql: (limit: number) => { text: string; values: unknown[] }
): Promise<number> {
  let deleted = 0
  for (let round = 0; round < 20; round++) {
    const q = sql(5_000)
    const res = await pool.query(q.text, q.values)
    deleted += res.rowCount ?? 0
    if ((res.rowCount ?? 0) < 5_000) break
  }
  return deleted
}

/** Delete rows outside the configured windows. Pending ops are never touched. */
export async function pruneRetention(
  pool: Pool,
  store: VrtControlStore,
  cfg: RetentionConfig
): Promise<RetentionReport> {
  let logsDeleted = 0
  if (cfg.logRetentionDays > 0) {
    logsDeleted = await deleteBatched(pool, (limit) => ({
      text: `delete from plane_logs where id in (
               select id from plane_logs
                where created_at < now() - ($1::int * interval '1 day')
                order by id limit $2
             )`,
      values: [cfg.logRetentionDays, limit],
    }))
  }
  let d1OpsDeleted = 0
  if (cfg.opsRetentionDays > 0) {
    d1OpsDeleted = await deleteBatched(pool, (limit) => ({
      text: `delete from plane_d1_ops where id in (
               select id from plane_d1_ops
                where status <> 'PENDING'
                  and created_at < now() - ($1::int * interval '1 day')
                order by seq limit $2
             )`,
      values: [cfg.opsRetentionDays, limit],
    }))
  }
  let cellOpsDeleted = 0
  if (cfg.opsRetentionDays > 0) {
    cellOpsDeleted = await deleteBatched(pool, (limit) => ({
      text: `delete from plane_cell_ops where id in (
               select id from plane_cell_ops
                where status <> 'PENDING'
                  and created_at < now() - ($1::int * interval '1 day')
                order by seq limit $2
             )`,
      values: [cfg.opsRetentionDays, limit],
    }))
  }
  const publications = await store.pruneTerminalPublications({
    keepPerCell: cfg.keepPerCell,
    batchSize: 500,
    maxRows: 5_000,
    deadlineMs: 30_000,
  })
  return {
    logsDeleted,
    d1OpsDeleted,
    cellOpsDeleted,
    publicationsDeleted: publications.deletedRows,
    publicationsTruncated: publications.truncated,
  }
}
