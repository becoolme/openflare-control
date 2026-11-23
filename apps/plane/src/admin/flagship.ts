import type { Hono } from 'hono'
import { z } from 'zod'
import { FlagshipConfigError, VrtControlError, validateFlagshipConfig } from 'openflare-control'
import { type AdminDeps, parse, readJson, rows } from './context.js'

const appId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)

export function registerFlagship(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/teams/:teamId/flagship/apps'

  app.get(base, async (c) => {
    const list = await rows(
      deps,
      `select app_id, config, updated_at from plane_flagship_apps
        where team_id=$1 order by app_id`,
      [c.req.param('teamId')]
    )
    return c.json({
      data: {
        apps: list.map((row) => ({
          appId: String(row.app_id),
          config: JSON.parse(String(row.config)),
          updatedAt: row.updated_at,
        })),
      },
    })
  })

  app.put(`${base}/:appId`, async (c) => {
    const team = c.req.param('teamId')
    const id = parse(appId, c.req.param('appId'))
    const body = parse(z.object({ config: z.unknown() }).strict(), await readJson(c))
    let config: string
    try {
      config = validateFlagshipConfig(id, body.config)
    } catch (error) {
      if (error instanceof FlagshipConfigError) {
        throw new VrtControlError(400, `Invalid Flagship config: ${error.message}`)
      }
      throw error
    }
    await deps.pool.query(
      `insert into plane_flagship_apps (team_id, app_id, config, updated_at)
       values ($1,$2,$3,now())
       on conflict (team_id, app_id) do update set config=excluded.config, updated_at=now()`,
      [team, id, config]
    )
    return c.json({ data: { appId: id } }, 201)
  })

  app.delete(`${base}/:appId`, async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_flagship_apps where team_id=$1 and app_id=$2',
      [c.req.param('teamId'), parse(appId, c.req.param('appId'))]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Flagship app not found')
    return c.json({ data: { deleted: true } })
  })
}
