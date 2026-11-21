import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: url })
try {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(sql)
  console.log('openflare-plane schema applied')
} finally {
  await pool.end()
}
