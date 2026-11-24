import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError, hyperdriveResourceId } from 'openflare-control'
import { type AdminDeps, generatedId, parse, readJson, rows, teamId } from '../context.js'

// Origins are `host:port/db` or `scheme://host/db` — credentials live with
// the provider, never in the plane. Writes reject an embedded userinfo and
// reads mask it, so a legacy row can't echo a password back through GETs.
const authorityOf = (origin: string) =>
  origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0] ?? ''

function assertNoCredentials(origin: string): void {
  if (authorityOf(origin).includes('@')) {
    throw new VrtControlError(
      400,
      'origin must not embed credentials — store them with the provider, not the plane'
    )
  }
}

function maskOrigin<T>(row: T): T {
  const r = row as { origin?: unknown }
  if (typeof r.origin !== 'string') return row
  // userinfo sits between the optional scheme and the first `/` — masking
  // there leaves `host/db@path` untouched.
  return { ...row, origin: r.origin.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^@/\s]+@/i, '$1***@') }
}

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
    return c.json({ data: { hyperdrives: list.map(maskOrigin) } })
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
    assertNoCredentials(body.origin)
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
    return c.json({ data: { hyperdrive: maskOrigin(hyperdrive) } }, 201)
  })

  app.get('/api/v1/cells/:cellId/hyperdrive/:hyperdriveId', async (c) => {
    const [hyperdrive] = await rows(
      deps,
      `select * from plane_hyperdrives
        where hyperdrive_id=$1 and cluster_id=$2`,
      [c.req.param('hyperdriveId'), c.req.param('cellId')]
    )
    if (!hyperdrive) throw new VrtControlError(404, 'Hyperdrive not found')
    return c.json({ data: { hyperdrive: maskOrigin(hyperdrive) } })
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
