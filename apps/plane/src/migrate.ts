import { Pool } from 'pg'
import { applySchema } from './applySchema.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: url })
try {
  await applySchema(pool)
  console.log('openflare-plane schema applied')
} finally {
  await pool.end()
}
