import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, parse, readJson, rows, teamId } from './context.js'

export function registerTeams(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/teams', async (c) => {
    const list = await rows(
      deps,
      `select t.*, q.requests_month, q.cpu_ms_month, q.workers_max,
              (select count(*)::int from plane_workers w where w.team_id=t.team_id) as workers
         from plane_teams t left join plane_team_quotas q using (team_id)
        order by t.team_id`
    )
    return c.json({ data: { teams: list } })
  })

  app.post('/api/v1/teams', async (c) => {
    const body = parse(
      z
        .object({
          teamId,
          name: z.string().min(1).max(191),
          plan: z.string().min(1).max(64).optional(),
        })
        .strict(),
      await readJson(c)
    )
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `insert into plane_teams (team_id, name, plan) values ($1,$2,$3)
         on conflict (team_id) do update set name=excluded.name, plan=excluded.plan`,
        [body.teamId, body.name, body.plan ?? 'Free']
      )
      await client.query(
        'insert into plane_team_quotas (team_id) values ($1) on conflict (team_id) do nothing',
        [body.teamId]
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    const [team] = await rows(
      deps,
      `select t.*, q.requests_month, q.cpu_ms_month, q.workers_max
         from plane_teams t left join plane_team_quotas q using (team_id)
        where t.team_id=$1`,
      [body.teamId]
    )
    return c.json({ data: { team } }, 201)
  })

  app.get('/api/v1/teams/:teamId', async (c) => {
    const [team] = await rows(
      deps,
      `select t.*, q.requests_month, q.cpu_ms_month, q.workers_max,
              (select count(*)::int from plane_workers w where w.team_id=t.team_id) as workers
         from plane_teams t left join plane_team_quotas q using (team_id)
        where t.team_id=$1`,
      [c.req.param('teamId')]
    )
    if (!team) throw new VrtControlError(404, 'Team not found')
    return c.json({ data: { team } })
  })

  app.patch('/api/v1/teams/:teamId', async (c) => {
    const id = c.req.param('teamId')
    const body = parse(
      z
        .object({
          name: z.string().min(1).max(191).optional(),
          plan: z.string().min(1).max(64).optional(),
          quotas: z
            .object({
              requestsMonth: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
              cpuMsMonth: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
              workersMax: z.number().int().min(0).max(2_147_483_647).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      await readJson(c)
    )
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      const upd = await client.query(
        `update plane_teams set name=coalesce($2,name), plan=coalesce($3,plan)
          where team_id=$1 returning *`,
        [id, body.name ?? null, body.plan ?? null]
      )
      if (upd.rowCount === 0) throw new VrtControlError(404, 'Team not found')
      if (body.quotas) {
        await client.query(
          `insert into plane_team_quotas (team_id, requests_month, cpu_ms_month, workers_max)
           values ($1, coalesce($2,100000000), coalesce($3,3600000000), coalesce($4,100))
           on conflict (team_id) do update set
             requests_month=coalesce($2, plane_team_quotas.requests_month),
             cpu_ms_month=coalesce($3, plane_team_quotas.cpu_ms_month),
             workers_max=coalesce($4, plane_team_quotas.workers_max)`,
          [
            id,
            body.quotas.requestsMonth ?? null,
            body.quotas.cpuMsMonth ?? null,
            body.quotas.workersMax ?? null,
          ]
        )
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    const [team] = await rows(
      deps,
      `select t.*, q.requests_month, q.cpu_ms_month, q.workers_max
         from plane_teams t left join plane_team_quotas q using (team_id)
        where t.team_id=$1`,
      [id]
    )
    return c.json({ data: { team } })
  })

  app.delete('/api/v1/teams/:teamId', async (c) => {
    const id = c.req.param('teamId')
    const [count] = await rows(
      deps,
      'select count(*)::int as n from plane_workers where team_id=$1',
      [id]
    )
    if (Number(count!.n) > 0) {
      throw new VrtControlError(409, 'Team still has workers', 'VRT_TEAM_NOT_EMPTY')
    }
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      await client.query('delete from plane_flagship_apps where team_id=$1', [id])
      await client.query('delete from plane_vectorize_indexes where team_id=$1', [id])
      await client.query('delete from plane_secrets_store where team_id=$1', [id])
      const deleted = await client.query('delete from plane_teams where team_id=$1', [id])
      if (deleted.rowCount === 0) throw new VrtControlError(404, 'Team not found')
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    return c.json({ data: { deleted: true } })
  })
}
