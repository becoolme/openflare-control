import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError, workerDoClassNameSchema } from 'openflare-control'
import { type AdminDeps, parse, readJson, rows, sha256, workerId } from './context.js'

const workerRef = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}:[a-z0-9][a-z0-9-]{0,62}$/)

const mapClass = (row: Record<string, unknown>) => ({
  className: String(row.class_name),
  uniqueKey: String(row.unique_key),
  enableSql: row.enable_sql === true,
  transferFromWorkerId: (row.transfer_from_worker_id as string | null) ?? null,
})

export function registerDoClasses(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/teams/:teamId/workers/:name/durable-object-classes'

  const workerFor = async (c: {
    req: { param: (key: string) => string }
  }): Promise<{ id: string; cell: string; team: string }> => {
    const cell = c.req.param('cellId')
    const team = c.req.param('teamId')
    const id = workerId(team, c.req.param('name'))
    const [worker] = await rows(
      deps,
      'select id from plane_workers where id=$1 and team_id=$2 and cluster_id=$3',
      [id, team, cell]
    )
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    return { id, cell, team }
  }

  app.get(base, async (c) => {
    const { id } = await workerFor(c)
    const list = await rows(
      deps,
      `select class_name, unique_key, enable_sql, transfer_from_worker_id
         from plane_do_classes where worker_id=$1 order by class_name`,
      [id]
    )
    return c.json({ data: { classes: list.map(mapClass) } })
  })

  app.post(base, async (c) => {
    const { id, cell } = await workerFor(c)
    const body = parse(
      z
        .object({
          className: workerDoClassNameSchema,
          enableSql: z.boolean().optional(),
          transferFromWorkerId: workerRef.nullable().optional(),
        })
        .strict(),
      await readJson(c)
    )
    if (body.transferFromWorkerId) {
      if (body.transferFromWorkerId === id) {
        throw new VrtControlError(400, 'A class cannot transfer from its own worker')
      }
      const [source] = await rows(
        deps,
        'select id from plane_workers where id=$1 and cluster_id=$2',
        [body.transferFromWorkerId, cell]
      )
      if (!source) throw new VrtControlError(400, 'Transfer source worker not found in this cell')
    }
    const uniqueKey = sha256(`${id}:do:${body.className}`)
    await deps.pool.query(
      `insert into plane_do_classes
         (worker_id, class_name, unique_key, enable_sql, transfer_from_worker_id)
       values ($1,$2,$3,$4,$5)
       on conflict (worker_id, class_name) do update set
         enable_sql=excluded.enable_sql,
         transfer_from_worker_id=excluded.transfer_from_worker_id`,
      [id, body.className, uniqueKey, body.enableSql ?? true, body.transferFromWorkerId ?? null]
    )
    return c.json(
      {
        data: {
          className: body.className,
          uniqueKey,
          enableSql: body.enableSql ?? true,
          transferFromWorkerId: body.transferFromWorkerId ?? null,
        },
      },
      201
    )
  })

  app.delete(`${base}/:className`, async (c) => {
    const { id } = await workerFor(c)
    const className = parse(workerDoClassNameSchema, c.req.param('className'))
    const deleted = await deps.pool.query(
      'delete from plane_do_classes where worker_id=$1 and class_name=$2',
      [id, className]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Durable Object class not found')
    return c.json({ data: { deleted: true } })
  })

  app.post(`${base}/migrations`, async (c) => {
    const { id } = await workerFor(c)
    const body = parse(
      z
        .object({
          newClasses: z.array(workerDoClassNameSchema).max(64).optional(),
          newSqliteClasses: z.array(workerDoClassNameSchema).max(64).optional(),
          renamedClasses: z
            .array(
              z.object({ from: workerDoClassNameSchema, to: workerDoClassNameSchema }).strict()
            )
            .max(64)
            .optional(),
          deletedClasses: z.array(workerDoClassNameSchema).max(64).optional(),
          transferredClasses: z.array(z.unknown()).optional(),
        })
        .strict(),
      await readJson(c)
    )
    if (body.transferredClasses !== undefined && body.transferredClasses.length > 0) {
      throw new VrtControlError(400, 'transferredClasses is not supported by the reference plane')
    }
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      for (const className of body.deletedClasses ?? []) {
        await client.query('delete from plane_do_classes where worker_id=$1 and class_name=$2', [
          id,
          className,
        ])
      }
      for (const rename of body.renamedClasses ?? []) {
        const updated = await client.query(
          `update plane_do_classes set class_name=$3
            where worker_id=$1 and class_name=$2`,
          [id, rename.from, rename.to]
        )
        if (updated.rowCount === 0) {
          throw new VrtControlError(404, `Durable Object class not found: ${rename.from}`)
        }
      }
      for (const [flag, list] of [
        [false, body.newClasses ?? []],
        [true, body.newSqliteClasses ?? []],
      ] as const) {
        for (const className of list) {
          await client.query(
            `insert into plane_do_classes
               (worker_id, class_name, unique_key, enable_sql)
             values ($1,$2,$3,$4)
             on conflict (worker_id, class_name) do update set enable_sql=excluded.enable_sql`,
            [id, className, sha256(`${id}:do:${className}`), flag]
          )
        }
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    return c.json({ data: { applied: true } })
  })
}
