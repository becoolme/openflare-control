/** FileRenderInputs payload for the reference plane (vars + secrets only). */
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

export interface CellRenderInputs {
  fingerprint: string
  tenants: Record<string, { vars: Record<string, string>; secrets: Record<string, string> }>
}

export async function collectRenderInputs(pool: Pool, cellId: string): Promise<CellRenderInputs> {
  const workers = await pool.query(
    `select w.id, w.team_id from plane_workers w
     where w.cluster_id=$1 and w.runtime='VRT' and w.active_version_id is not null`,
    [cellId]
  )
  const tenants: CellRenderInputs['tenants'] = {}
  for (const worker of workers.rows as { id: string; team_id: string }[]) {
    const tenant = (tenants[worker.team_id] ??= { vars: {}, secrets: {} })
    const vars = await pool.query('select key, value from plane_vars where worker_id=$1', [
      worker.id,
    ])
    for (const row of vars.rows as { key: string; value: string }[])
      tenant.vars[row.key] = row.value
    const secrets = await pool.query('select key, value from plane_secrets where worker_id=$1', [
      worker.id,
    ])
    for (const row of secrets.rows as { key: string; value: string }[]) {
      tenant.secrets[row.key] = row.value
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(tenants)).digest('hex')
  return { fingerprint, tenants }
}
