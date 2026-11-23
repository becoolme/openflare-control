/** Apply the idempotent reference-plane schema under a cross-replica lock. */
import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'

/**
 * `create ... if not exists` is not concurrency-safe in Postgres: two
 * replicas booting together can race on catalog rows even when both statements
 * are idempotent. A transaction-scoped advisory lock serializes the whole
 * apply, and the transaction makes a partial failure roll back atomically.
 */
const SCHEMA_LOCK = 'openflare-plane-schema'

export async function applySchema(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [SCHEMA_LOCK])
    await client.query(sql)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
