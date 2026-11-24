/**
 * Retention policy for operator-visible data. Deployment decides how long the
 * plane keeps logs (the source of request/error metrics), terminal D1/cell ops
 * (the source of op stats) and publication history.
 *
 *   PLANE_LOG_RETENTION_DAYS=7       # 0 = keep forever
 *   PLANE_OPS_RETENTION_DAYS=30      # terminal ops only; pending is never deleted
 *   PLANE_METRICS_RETENTION_DAYS=14  # runtime cell reports (metrics/stats source)
 *   PLANE_ASSET_RETENTION_DAYS=7     # unreferenced asset manifests/objects
 *   PLANE_PUBLICATION_KEEP=20        # rows per cell (existing prune semantics)
 *   PLANE_RETENTION_SWEEP_MS=21600000
 */
import type { Pool } from 'pg'
import type { VrtControlStore } from 'openflare-control'
import type { AssetStore } from './assetStore.js'
import { pruneAssets } from './assetRetention.js'

export interface RetentionConfig {
  logRetentionDays: number
  opsRetentionDays: number
  metricsRetentionDays: number
  assetRetentionDays: number
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
  const metricsRetentionDays = int(env.PLANE_METRICS_RETENTION_DAYS, 14)
  const assetRetentionDays = int(env.PLANE_ASSET_RETENTION_DAYS, 7)
  const keepPerCell = int(env.PLANE_PUBLICATION_KEEP, 20)
  const sweepMs = int(env.PLANE_RETENTION_SWEEP_MS, 6 * 60 * 60 * 1000)
  if (logRetentionDays > 365) throw new Error('PLANE_LOG_RETENTION_DAYS must be <= 365')
  if (opsRetentionDays > 3650) throw new Error('PLANE_OPS_RETENTION_DAYS must be <= 3650')
  if (metricsRetentionDays > 365) throw new Error('PLANE_METRICS_RETENTION_DAYS must be <= 365')
  if (assetRetentionDays > 3650) throw new Error('PLANE_ASSET_RETENTION_DAYS must be <= 3650')
  if (keepPerCell > 10_000) throw new Error('PLANE_PUBLICATION_KEEP must be <= 10000')
  if (sweepMs !== 0 && sweepMs < 60_000) {
    throw new Error('PLANE_RETENTION_SWEEP_MS must be 0 or >= 60000')
  }
  return {
    logRetentionDays,
    opsRetentionDays,
    metricsRetentionDays,
    assetRetentionDays,
    keepPerCell,
    sweepMs,
  }
}

export interface RetentionReport {
  logsDeleted: number
  d1OpsDeleted: number
  cellOpsDeleted: number
  /** PENDING ops whose dispatch deadline passed (never executed). */
  expiredD1OpsDeleted: number
  expiredCellOpsDeleted: number
  metricsDeleted: number
  assetManifestsDeleted: number
  assetObjectsDeleted: number
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
  cfg: RetentionConfig,
  assets?: AssetStore
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
  // Expired PENDING ops can never be dispatched. Keep a one-day grace for a
  // late ACK, then reclaim them independently of the terminal-op window.
  const expiredD1OpsDeleted =
    cfg.opsRetentionDays > 0
      ? await deleteBatched(pool, (limit) => ({
          text: `delete from plane_d1_ops where id in (
                   select id from plane_d1_ops
                    where status='PENDING'
                      and expires_at is not null
                      and expires_at < now() - interval '1 day'
                    order by seq limit $1
                 )`,
          values: [limit],
        }))
      : 0
  const expiredCellOpsDeleted =
    cfg.opsRetentionDays > 0
      ? await deleteBatched(pool, (limit) => ({
          text: `delete from plane_cell_ops where id in (
                   select id from plane_cell_ops
                    where status='PENDING'
                      and expires_at is not null
                      and expires_at < now() - interval '1 day'
                    order by seq limit $1
                 )`,
          values: [limit],
        }))
      : 0
  let metricsDeleted = 0
  if (cfg.metricsRetentionDays > 0) {
    metricsDeleted = await deleteBatched(pool, (limit) => ({
      text: `delete from plane_cell_metrics where id in (
               select id from plane_cell_metrics
                where created_at < now() - ($1::int * interval '1 day')
                order by id limit $2
             )`,
      values: [cfg.metricsRetentionDays, limit],
    }))
  }
  const publications = await store.pruneTerminalPublications({
    keepPerCell: cfg.keepPerCell,
    batchSize: 500,
    maxRows: 5_000,
    deadlineMs: 30_000,
  })
  const assetsResult = assets
    ? await pruneAssets(pool, assets, cfg.assetRetentionDays)
    : { manifestsDeleted: 0, objectsDeleted: 0 }
  return {
    logsDeleted,
    d1OpsDeleted,
    cellOpsDeleted,
    expiredD1OpsDeleted,
    expiredCellOpsDeleted,
    metricsDeleted,
    assetManifestsDeleted: assetsResult.manifestsDeleted,
    assetObjectsDeleted: assetsResult.objectsDeleted,
    publicationsDeleted: publications.deletedRows,
    publicationsTruncated: publications.truncated,
  }
}
