import type { Hono } from 'hono'
import { z } from 'zod'
import { type AdminDeps, mapLog, parse, readJson, rows } from './context.js'

export function registerLogs(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/logs', async (c) => {
    const worker = c.req.query('workerId')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 1000)
    const list = await rows(
      deps,
      `select worker_id, boot_id, seq, ts_ms, level, kind, message, outcome, status, code, truncated
         from plane_logs where cell_id=$1 and ($2::text is null or worker_id=$2)
        order by ts_ms desc limit $3`,
      [c.req.param('cellId'), worker ?? null, limit]
    )
    return c.json({ data: { logs: list.map(mapLog) } })
  })

  app.post('/api/v1/maintenance/prune', async (c) => {
    const body = parse(
      z.object({ keepPerCell: z.number().int().min(0).max(10_000) }).strict(),
      await readJson(c)
    )
    const result = await deps.store.pruneTerminalPublications({
      keepPerCell: body.keepPerCell,
      batchSize: 500,
      maxRows: 5_000,
      deadlineMs: 30_000,
    })
    return c.json({ data: result })
  })
}
