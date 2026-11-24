import type { Hono } from 'hono'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, rows } from './context.js'

export function registerDoAlarmService(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/do-alarms', async (c) => {
    const [row] = await rows(
      deps,
      `select updated_at, payload from plane_cell_alarm_snapshots where cell_id=$1`,
      [c.req.param('cellId')]
    )
    if (!row) throw new VrtControlError(404, 'No alarm snapshot for this cell')
    return c.json({
      data: {
        updatedAt: row.updated_at,
        snapshot: row.payload,
      },
    })
  })
}
