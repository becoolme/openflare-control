/**
 * Retention maintenance: delete terminal-acked publications beyond the
 * newest N per cell. Non-terminal rows are never touched. Run it from cron
 * (daily is plenty; one row per publication per ~20 min per cell).
 *
 *   DATABASE_URL=... tsx src/maintain.ts [--keep 20]
 */
import { Pool } from 'pg'
import { createPlaneStore } from './store.js'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: url })
try {
  const store = createPlaneStore(pool)
  const keep = Number(arg('keep') ?? 20)
  if (!Number.isSafeInteger(keep) || keep < 0)
    throw new Error('--keep must be a non-negative integer')
  const result = await store.pruneTerminalPublications({
    keepPerCell: keep,
    batchSize: 500,
    maxRows: 5_000,
    deadlineMs: 30_000,
  })
  const cells = await store.countCellStates()
  console.log(
    `openflare-plane retention: ${result.deletedRows} rows deleted across ${cells} cells` +
      (result.truncated ? ' (budget reached, run again)' : '')
  )
} finally {
  await pool.end()
}
