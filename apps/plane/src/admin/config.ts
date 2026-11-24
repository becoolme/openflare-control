import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, hostname, key, parse, readJson, rows, workerId } from './context.js'

async function assertEnvNameAvailable(
  deps: AdminDeps,
  worker: string,
  name: string,
  source: 'var' | 'secret'
): Promise<void> {
  const otherTable = source === 'var' ? 'plane_secrets' : 'plane_vars'
  const [other] = await rows(
    deps,
    `select 1 from ${otherTable} where worker_id=$1 and key=$2 limit 1`,
    [worker, name]
  )
  if (other) {
    throw new VrtControlError(
      409,
      `${name} is already used by a ${source === 'var' ? 'secret' : 'var'}`
    )
  }
  const [inVersion] = await rows(
    deps,
    `select 1
       from plane_workers w
       join plane_versions v on v.worker_id=w.id and v.version_id=w.active_version_id
      where w.id=$1
        and (
          exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(v.row->'bindings')='array'
                  then v.row->'bindings' else '[]'::jsonb end
              ) binding
             where binding->>'name'=$2
          )
          or (case when jsonb_typeof(v.row->'jsonVars')='object'
            then v.row->'jsonVars' else '{}'::jsonb end) ? $2
          or v.row->>'versionMetadata'=$2
        )
      union all
      select 1 from plane_workflows where worker_id=$1 and binding=$2
      limit 1`,
    [worker, name]
  )
  if (inVersion) {
    throw new VrtControlError(409, `${name} is already used by the active version`)
  }
}

export function registerConfig(app: Hono, deps: AdminDeps): void {
  const worker = (c: { req: { param: (k: string) => string } }) => {
    const team = c.req.param('teamId')
    const name = c.req.param('name')
    return workerId(team, name)
  }

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars', async (c) => {
    const list = await rows(
      deps,
      'select key, value from plane_vars where worker_id=$1 order by key',
      [worker(c)]
    )
    return c.json({ data: { vars: list } })
  })

  app.put('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars/:key', async (c) => {
    const k = c.req.param('key')
    parse(key, k)
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    await assertEnvNameAvailable(deps, worker(c), k, 'var')
    await deps.pool.query(
      `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
       on conflict (worker_id, key) do update set value=excluded.value`,
      [worker(c), k, body.value]
    )
    return c.json({ data: { key: k, value: body.value } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars/:key', async (c) => {
    await deps.pool.query('delete from plane_vars where worker_id=$1 and key=$2', [
      worker(c),
      c.req.param('key'),
    ])
    return c.json({ data: { deleted: true } })
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets', async (c) => {
    const list = await rows(deps, 'select key from plane_secrets where worker_id=$1 order by key', [
      worker(c),
    ])
    return c.json({ data: { keys: list.map((r) => r.key) } })
  })

  app.put('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets/:key', async (c) => {
    const k = c.req.param('key')
    parse(key, k)
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    await assertEnvNameAvailable(deps, worker(c), k, 'secret')
    await deps.pool.query(
      `insert into plane_secrets (worker_id, key, value) values ($1,$2,$3)
       on conflict (worker_id, key) do update set value=excluded.value`,
      [worker(c), k, deps.secrets.encrypt(body.value)]
    )
    return c.json({ data: { key: k } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets/:key', async (c) => {
    await deps.pool.query('delete from plane_secrets where worker_id=$1 and key=$2', [
      worker(c),
      c.req.param('key'),
    ])
    return c.json({ data: { deleted: true } })
  })

  app.post('/api/v1/cells/:cellId/teams/:teamId/workers/:name/hostnames', async (c) => {
    const cell = c.req.param('cellId')
    const id = worker(c)
    const [row] = await rows(deps, 'select id from plane_workers where id=$1 and cluster_id=$2', [
      id,
      cell,
    ])
    if (!row) throw new VrtControlError(404, 'Worker not found')
    const body = parse(z.object({ hostname }).strict(), await readJson(c))
    if (await deps.store.isHostnameTaken(body.hostname, { excludeWorkerId: id })) {
      throw new VrtControlError(409, 'Hostname already claimed', 'VRT_HOSTNAME_TAKEN')
    }
    await deps.pool.query(
      `insert into plane_hostnames (id, hostname, worker_id) values ($1,$2,$3)
       on conflict (hostname, worker_id) do nothing`,
      [`${id}:${body.hostname}`, body.hostname, id]
    )
    return c.json({ data: { hostname: body.hostname } }, 201)
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/hostnames/:hostname', async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_hostnames where worker_id=$1 and hostname=$2',
      [worker(c), c.req.param('hostname')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Hostname not found')
    return c.json({ data: { deleted: true } })
  })
}
