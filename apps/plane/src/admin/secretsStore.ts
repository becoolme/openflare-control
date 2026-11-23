import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, parse, readJson, rows, teamId } from './context.js'

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)

export function registerSecretsStore(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/teams/:teamId/secrets-store'

  app.get(base, async (c) => {
    parse(teamId, c.req.param('teamId'))
    const list = await rows(
      deps,
      `select store_id, secret_name, updated_at from plane_secrets_store
        where team_id=$1 order by store_id, secret_name`,
      [c.req.param('teamId')]
    )
    return c.json({ data: { secrets: list } })
  })

  app.put(`${base}/:storeId/:secretName`, async (c) => {
    const team = c.req.param('teamId')
    parse(teamId, team)
    const store = parse(identifier, c.req.param('storeId'))
    const secret = parse(identifier, c.req.param('secretName'))
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    await deps.pool.query(
      `insert into plane_secrets_store (team_id, store_id, secret_name, value, updated_at)
       values ($1,$2,$3,$4,now())
       on conflict (team_id, store_id, secret_name) do update set
         value=excluded.value, updated_at=now()`,
      [team, store, secret, deps.secrets.encrypt(body.value)]
    )
    return c.json({ data: { storeId: store, secretName: secret } })
  })

  app.delete(`${base}/:storeId/:secretName`, async (c) => {
    const team = c.req.param('teamId')
    parse(teamId, team)
    const store = parse(identifier, c.req.param('storeId'))
    const secret = parse(identifier, c.req.param('secretName'))
    const [referenced] = await rows(
      deps,
      `select 1
         from plane_workers w
         join plane_versions v on v.worker_id=w.id,
              jsonb_array_elements(
                case when jsonb_typeof(v.row->'bindings')='array'
                  then v.row->'bindings' else '[]'::jsonb end
              ) binding
        where w.team_id=$1 and binding->>'type'='SECRETS_STORE'
          and binding->>'storeId'=$2 and binding->>'secretName'=$3
        limit 1`,
      [team, store, secret]
    )
    if (referenced) {
      throw new VrtControlError(409, 'Secrets Store secret is referenced by a version')
    }
    const deleted = await deps.pool.query(
      'delete from plane_secrets_store where team_id=$1 and store_id=$2 and secret_name=$3',
      [team, store, secret]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Secret not found')
    return c.json({ data: { deleted: true } })
  })
}
