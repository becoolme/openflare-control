import type { Hono } from 'hono'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, hostname, key, parse, readJson, rows, workerId } from './context.js'

async function assertEnvNameAvailable(
  client: PoolClient,
  worker: string,
  name: string,
  source: 'var' | 'secret'
): Promise<void> {
  const otherTable = source === 'var' ? 'plane_secrets' : 'plane_vars'
  const [other] = (
    await client.query(`select 1 from ${otherTable} where worker_id=$1 and key=$2 limit 1`, [
      worker,
      name,
    ])
  ).rows
  if (other) {
    throw new VrtControlError(
      409,
      `${name} is already used by a ${source === 'var' ? 'secret' : 'var'}`
    )
  }
  const [inVersion] = (
    await client.query(
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
  ).rows
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

  // The worker id is `team:name` — globally unique — so a lookup that skips
  // `cluster_id` resolves the same row through any cell's path. Every
  // vars/secrets/hostname route must pin the worker to `:cellId` or a write
  // issued under the wrong cell silently mutates the real worker.
  const assertWorkerOnCell = async (c: {
    req: { param: (k: string) => string }
  }): Promise<void> => {
    const [row] = await rows(deps, 'select 1 from plane_workers where id=$1 and cluster_id=$2', [
      worker(c),
      c.req.param('cellId'),
    ])
    if (!row) throw new VrtControlError(404, 'Worker not found')
  }

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars', async (c) => {
    await assertWorkerOnCell(c)
    const list = await rows(
      deps,
      'select key, value from plane_vars where worker_id=$1 order by key',
      [worker(c)]
    )
    return c.json({ data: { vars: list } })
  })

  app.put('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars/:key', async (c) => {
    await assertWorkerOnCell(c)
    const k = c.req.param('key')
    parse(key, k)
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      // Serialize env-name claims per worker: the cross-table check and the
      // insert must hold the same lock or a var and a secret can race into
      // the same name.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`plane-env:${worker(c)}`])
      await assertEnvNameAvailable(client, worker(c), k, 'var')
      await client.query(
        `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
         on conflict (worker_id, key) do update set value=excluded.value`,
        [worker(c), k, body.value]
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    return c.json({ data: { key: k, value: body.value } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars/:key', async (c) => {
    await assertWorkerOnCell(c)
    await deps.pool.query('delete from plane_vars where worker_id=$1 and key=$2', [
      worker(c),
      c.req.param('key'),
    ])
    return c.json({ data: { deleted: true } })
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets', async (c) => {
    await assertWorkerOnCell(c)
    const list = await rows(deps, 'select key from plane_secrets where worker_id=$1 order by key', [
      worker(c),
    ])
    return c.json({ data: { keys: list.map((r) => r.key) } })
  })

  app.put('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets/:key', async (c) => {
    await assertWorkerOnCell(c)
    const k = c.req.param('key')
    parse(key, k)
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`plane-env:${worker(c)}`])
      await assertEnvNameAvailable(client, worker(c), k, 'secret')
      await client.query(
        `insert into plane_secrets (worker_id, key, value) values ($1,$2,$3)
         on conflict (worker_id, key) do update set value=excluded.value`,
        [worker(c), k, deps.secrets.encrypt(body.value)]
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    return c.json({ data: { key: k } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets/:key', async (c) => {
    await assertWorkerOnCell(c)
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
    await assertWorkerOnCell(c)
    const deleted = await deps.pool.query(
      'delete from plane_hostnames where worker_id=$1 and hostname=$2',
      [worker(c), c.req.param('hostname')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Hostname not found')
    return c.json({ data: { deleted: true } })
  })
}
