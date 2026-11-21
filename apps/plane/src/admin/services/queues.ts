import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, generatedId, parse, readJson, rows, teamId } from '../context.js'

export function registerQueueService(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/queues', async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select queue_id, team_id, cluster_id, name, delivery_delay_seconds, created_at
         from plane_queues where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, name`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { queues: list } })
  })

  app.post('/api/v1/cells/:cellId/queues', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
          deliveryDelaySeconds: z.number().int().min(0).max(86_400).optional(),
        })
        .strict(),
      await readJson(c)
    )
    const queueId = generatedId(`${cell}:${body.teamId}:queue:${body.name}`)
    await deps.pool.query(
      `insert into plane_queues (queue_id, team_id, cluster_id, name, delivery_delay_seconds)
       values ($1,$2,$3,$4,$5) on conflict (queue_id) do nothing`,
      [queueId, body.teamId, cell, body.name, body.deliveryDelaySeconds ?? null]
    )
    const [queue] = await rows(deps, 'select * from plane_queues where queue_id=$1', [queueId])
    return c.json({ data: { queue } }, 201)
  })

  app.patch('/api/v1/cells/:cellId/queues/:queueId', async (c) => {
    const body = parse(
      z.object({ deliveryDelaySeconds: z.number().int().min(0).max(86_400) }).strict(),
      await readJson(c)
    )
    const [queue] = await rows(
      deps,
      `update plane_queues set delivery_delay_seconds=$3
        where queue_id=$1 and cluster_id=$2 returning *`,
      [c.req.param('queueId'), c.req.param('cellId'), body.deliveryDelaySeconds]
    )
    if (!queue) throw new VrtControlError(404, 'Queue not found')
    return c.json({ data: { queue } })
  })

  app.delete('/api/v1/cells/:cellId/queues/:queueId', async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_queues where queue_id=$1 and cluster_id=$2',
      [c.req.param('queueId'), c.req.param('cellId')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Queue not found')
    return c.json({ data: { deleted: true } })
  })
}
