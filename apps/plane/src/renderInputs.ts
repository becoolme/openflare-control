/** FileRenderInputs payload for the reference plane (vars + secrets only). */
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { SecretsCipher } from './secretsCipher.js'

export interface CellRenderInputs {
  fingerprint: string
  tenants: Record<string, { vars: Record<string, string>; secrets: Record<string, string> }>
}

export async function collectRenderInputs(
  pool: Pool,
  cellId: string,
  secrets: SecretsCipher
): Promise<CellRenderInputs> {
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
    const secretRows = await pool.query('select key, value from plane_secrets where worker_id=$1', [
      worker.id,
    ])
    for (const row of secretRows.rows as { key: string; value: string }[]) {
      const plaintext = secrets.decrypt(row.value)
      tenant.secrets[row.key] = plaintext
      // Upgrade a pre-encryption row on the first read instead of leaving it
      // in plaintext forever. The value guard makes concurrent readers
      // idempotent: only the first sealer rewrites the row.
      if (!secrets.isEncrypted(row.value)) {
        try {
          await pool.query(
            `update plane_secrets set value=$3
              where worker_id=$1 and key=$2 and value=$4`,
            [worker.id, row.key, secrets.encrypt(plaintext), row.value]
          )
        } catch (error) {
          // Rendering must not fail just because the best-effort re-seal
          // could not write; the secret is already available in memory.
          console.error(
            '[openflare-plane] failed to seal a legacy secret:',
            error instanceof Error ? error.message : 'unknown error'
          )
        }
      }
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(tenants)).digest('hex')
  return { fingerprint, tenants }
}
