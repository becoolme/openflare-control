import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import {
  type AdminDeps,
  databaseId,
  generatedId,
  mapOp,
  opExpiresAt,
  parse,
  readJson,
  rows,
  teamId,
} from '../context.js'

export function registerD1Service(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/d1/databases', async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select * from plane_d1_databases
        where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, name`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { databases: list } })
  })

  app.post('/api/v1/cells/:cellId/d1/databases', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z.object({ teamId, name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) }).strict(),
      await readJson(c)
    )
    const id = generatedId(`${cell}:${body.teamId}:d1:${body.name}`)
    await deps.pool.query(
      `insert into plane_d1_databases (database_id, team_id, cluster_id, name)
       values ($1,$2,$3,$4) on conflict (database_id) do nothing`,
      [id, body.teamId, cell, body.name]
    )
    const [database] = await rows(deps, 'select * from plane_d1_databases where database_id=$1', [
      id,
    ])
    return c.json({ data: { database } }, 201)
  })

  app.get('/api/v1/cells/:cellId/d1/databases/:databaseId', async (c) => {
    const [database] = await rows(
      deps,
      'select * from plane_d1_databases where database_id=$1 and cluster_id=$2',
      [c.req.param('databaseId'), c.req.param('cellId')]
    )
    if (!database) throw new VrtControlError(404, 'D1 database not found')
    return c.json({ data: { database } })
  })

  app.delete('/api/v1/cells/:cellId/d1/databases/:databaseId', async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_d1_databases where database_id=$1 and cluster_id=$2',
      [c.req.param('databaseId'), c.req.param('cellId')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'D1 database not found')
    return c.json({ data: { deleted: true } })
  })

  app.post('/api/v1/cells/:cellId/d1/databases/:databaseId/query', async (c) => {
    const id = c.req.param('databaseId')
    parse(databaseId, id)
    await requireDatabase(deps, c.req.param('cellId'), id)
    const body = parse(
      z
        .object({
          sql: z
            .string()
            .min(1)
            .max(100 * 1024),
          params: z.array(z.unknown()).max(100).optional(),
          expiresAt: opExpiresAt,
        })
        .strict(),
      await readJson(c)
    )
    const opId = randomUUID()
    await deps.pool.query(
      `insert into plane_d1_ops (id, cell_id, database_id, kind, payload, expires_at)
       values ($1,$2,$3,'EXECUTE',$4,to_timestamp($5::double precision))`,
      [
        opId,
        c.req.param('cellId'),
        id,
        { sql: body.sql, ...(body.params ? { params: body.params } : {}) },
        body.expiresAt ?? null,
      ]
    )
    return c.json({ data: { opId, channel: 'd1' } }, 202)
  })

  app.post('/api/v1/cells/:cellId/d1/databases/:databaseId/migrations', async (c) => {
    const id = c.req.param('databaseId')
    parse(databaseId, id)
    await requireDatabase(deps, c.req.param('cellId'), id)
    const body = parse(
      z
        .object({
          migrations: z
            .array(z.object({ name: z.string().min(1).max(200), sql: z.string().min(1) }))
            .min(1)
            .max(512),
          expiresAt: opExpiresAt,
        })
        .strict(),
      await readJson(c)
    )
    const opId = randomUUID()
    await deps.pool.query(
      `insert into plane_d1_ops (id, cell_id, database_id, kind, payload, expires_at)
       values ($1,$2,$3,'MIGRATIONS_APPLY',$4,to_timestamp($5::double precision))`,
      [opId, c.req.param('cellId'), id, { migrations: body.migrations }, body.expiresAt ?? null]
    )
    return c.json({ data: { opId, channel: 'd1' } }, 202)
  })

  app.get('/api/v1/cells/:cellId/d1/databases/:databaseId/ops', async (c) => {
    const list = await rows(
      deps,
      `select id, seq, database_id, kind, status, result, error, expires_at, created_at
         from plane_d1_ops where cell_id=$1 and database_id=$2 order by seq desc limit 100`,
      [c.req.param('cellId'), c.req.param('databaseId')]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })
}

async function requireDatabase(deps: AdminDeps, cell: string, id: string): Promise<void> {
  const [row] = await rows(
    deps,
    'select 1 from plane_d1_databases where database_id=$1 and cluster_id=$2',
    [id, cell]
  )
  if (!row) throw new VrtControlError(404, 'D1 database not found')
}
