import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { applySchema } from './applySchema.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip

maybe('applySchema', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })

  it('serializes concurrent boots and leaves the schema usable', async () => {
    await Promise.all([applySchema(pool), applySchema(pool), applySchema(pool)])
    const { rows } = await pool.query('select count(*)::int as n from plane_cells')
    expect(rows[0]?.n).toBeGreaterThanOrEqual(0)
  })
})
