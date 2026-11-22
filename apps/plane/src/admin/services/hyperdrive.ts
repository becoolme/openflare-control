import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError, hyperdriveResourceId } from 'openflare-control'
import { type AdminDeps, generatedId, parse, readJson, rows, teamId } from '../context.js'

export function registerHyperdriveService(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/hyperdrive', async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select * from plane_hyperdrives
        where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, name`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { hyperdrives: list } })
  })

  app.post('/api/v1/cells/:cellId/hyperdrive', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
          origin: z.string().min(1).max(512),
          caching: z.boolean().optional(),
        })
        .strict(),
      await readJson(c)
    )
    const id = generatedId(`${cell}:${body.teamId}:hyperdrive:${body.name}`)
    await deps.pool.query(
      `insert into plane_hyperdrives
         (hyperdrive_id, team_id, cluster_id, name, origin, caching)
       values ($1,$2,$3,$4,$5,$6) on conflict (hyperdrive_id) do nothing`,
      [id, body.teamId, cell, body.name, body.origin, body.caching ?? true]
    )
    const [hyperdrive] = await rows(
      deps,
      'select * from plane_hyperdrives where hyperdrive_id=$1',
      [id]
    )
    return c.json({ data: { hyperdrive } }, 201)
  })

  app.get('/api/v1/cells/:cellId/hyperdrive/:hyperdriveId', async (c) => {
    const [hyperdrive] = await rows(
      deps,
      `select * from plane_hyperdrives
        where hyperdrive_id=$1 and cluster_id=$2`,
      [c.req.param('hyperdriveId'), c.req.param('cellId')]
    )
    if (!hyperdrive) throw new VrtControlError(404, 'Hyperdrive not found')
    return c.json({ data: { hyperdrive } })
  })

  app.delete('/api/v1/cells/:cellId/hyperdrive/:hyperdriveId', async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_hyperdrives where hyperdrive_id=$1 and cluster_id=$2',
      [c.req.param('hyperdriveId'), c.req.param('cellId')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Hyperdrive not found')
    return c.json({ data: { deleted: true } })
  })

  // The binding carries only a server-minted identity; credentials stay with the
  // provider. This is the same resourceId the control-plane adapter mints.
  app.get('/api/v1/cells/:cellId/hyperdrive/:hyperdriveId/binding', async (c) => {
    const [hyperdrive] = await rows(
      deps,
      `select * from plane_hyperdrives
        where hyperdrive_id=$1 and cluster_id=$2`,
      [c.req.param('hyperdriveId'), c.req.param('cellId')]
    )
    if (!hyperdrive) throw new VrtControlError(404, 'Hyperdrive not found')
    return c.json({
      data: {
        binding: {
          type: 'HYPERDRIVE',
          resourceId: hyperdriveResourceId('database', String(hyperdrive.hyperdrive_id)),
        },
        credentialNote:
          'connection credentials are provider-managed and are not stored in the plane',
      },
    })
  })
}
