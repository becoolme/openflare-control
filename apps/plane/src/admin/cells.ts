import type { Hono } from 'hono'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { collectRenderInputs } from '../renderInputs.js'
import { type AdminDeps, cellId, mapCell, parse, readJson, rows } from './context.js'

export function registerCells(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells', async (c) => {
    const list = await rows(
      deps,
      `select c.cell_id, c.cluster_id, c.revision, c.capabilities,
              (select count(*)::int from plane_workers w where w.cluster_id=c.cell_id) as workers,
              (select max(revision) from plane_publications p where p.cell_id=c.cell_id) as latest_revision
         from plane_cells c order by c.cell_id`
    )
    return c.json({ data: { cells: list.map(mapCell) } })
  })

  app.post('/api/v1/cells', async (c) => {
    const body = parse(z.object({ cellId }).strict(), await readJson(c))
    await deps.pool.query(
      `insert into plane_cells (cell_id, cluster_id) values ($1,$1)
       on conflict (cell_id) do nothing`,
      [body.cellId]
    )
    return c.json({ data: { cellId: body.cellId } }, 201)
  })

  // Issue (or rotate) the cell's pull credential. The plaintext is returned
  // exactly once and only the sha256 is stored — there is no GET for it, and
  // a rotation invalidates the previous token on the next cell poll.
  app.post('/api/v1/cells/:cellId/token', async (c) => {
    const cell = c.req.param('cellId')
    parse(cellId, cell)
    const [exists] = await rows(deps, 'select 1 from plane_cells where cell_id=$1', [cell])
    if (!exists) throw new VrtControlError(404, 'Cell not found', 'VRT_CELL_NOT_FOUND')
    const token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await deps.pool.query(
      `insert into plane_cell_tokens (cell_id, token_hash) values ($1,$2)
       on conflict (cell_id) do update set token_hash=excluded.token_hash,
         created_at=now()`,
      [cell, tokenHash]
    )
    return c.json({ data: { cellId: cell, token } }, 201)
  })

  app.get('/api/v1/cells/:cellId', async (c) => {
    const cell = c.req.param('cellId')
    const [state] = await rows(deps, 'select * from plane_cells where cell_id=$1', [cell])
    if (!state) throw new VrtControlError(404, 'Cell not found', 'VRT_CELL_NOT_FOUND')
    const [counts] = await rows(
      deps,
      `select
         (select count(*)::int from plane_workers where cluster_id=$1) as workers,
         (select count(*)::int from plane_publications where cell_id=$1) as publications,
         (select count(*)::int from plane_d1_ops where cell_id=$1) as d1_ops,
         (select count(*)::int from plane_cell_ops where cell_id=$1) as cell_ops`,
      [cell]
    )
    const [latest] = await rows(
      deps,
      `select revision, ack_status, issued_at, expires_at from plane_publications
        where cell_id=$1 order by revision desc limit 1`,
      [cell]
    )
    return c.json({
      data: { ...mapCell({ ...state, ...counts }), latestPublication: latest ?? null },
    })
  })

  app.get('/api/v1/cells/:cellId/render-inputs', async (c) => {
    const inputs = await collectRenderInputs(deps.pool, c.req.param('cellId'))
    return c.json({ data: inputs })
  })

  app.delete('/api/v1/cells/:cellId', async (c) => {
    const cell = c.req.param('cellId')
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'delete from plane_workers where cluster_id in (select cell_id from plane_cells where cell_id=$1)',
        [cell]
      )
      await client.query('delete from plane_publications where cell_id=$1', [cell])
      await client.query('delete from plane_d1_ops where cell_id=$1', [cell])
      await client.query('delete from plane_cell_ops where cell_id=$1', [cell])
      await client.query('delete from plane_logs where cell_id=$1', [cell])
      const deleted = await client.query('delete from plane_cells where cell_id=$1', [cell])
      await client.query('commit')
      if (deleted.rowCount === 0) throw new VrtControlError(404, 'Cell not found')
      return c.json({ data: { deleted: true } })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  })
}
