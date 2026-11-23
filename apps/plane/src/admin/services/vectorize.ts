import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, generatedId, parse, readJson, rows, teamId } from '../context.js'

const metric = z.enum(['cosine', 'euclidean', 'dot-product'])
const indexName = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(64)

export function registerVectorizeService(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/vectorize/indexes'

  app.get(base, async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select index_id, team_id, cluster_id, name, dimensions, metric, created_at
         from plane_vectorize_indexes
        where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, name`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { indexes: list } })
  })

  app.post(base, async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          name: indexName,
          dimensions: z.number().int().min(1).max(1536),
          metric,
        })
        .strict(),
      await readJson(c)
    )
    const id = generatedId(`${cell}:${body.teamId}:vectorize:${body.name}`)
    await deps.pool.query(
      `insert into plane_vectorize_indexes
         (index_id, team_id, cluster_id, name, dimensions, metric)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (team_id, cluster_id, name) do update set
         dimensions=excluded.dimensions, metric=excluded.metric`,
      [id, body.teamId, cell, body.name, body.dimensions, body.metric]
    )
    const [index] = await rows(
      deps,
      `select index_id, team_id, cluster_id, name, dimensions, metric, created_at
         from plane_vectorize_indexes
        where team_id=$1 and cluster_id=$2 and name=$3`,
      [body.teamId, cell, body.name]
    )
    return c.json({ data: { index } }, 201)
  })

  app.delete(`${base}/:indexId`, async (c) => {
    const deleted = await deps.pool.query(
      'delete from plane_vectorize_indexes where index_id=$1 and cluster_id=$2',
      [c.req.param('indexId'), c.req.param('cellId')]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Vectorize index not found')
    return c.json({ data: { deleted: true } })
  })

  app.get(`${base}/:indexId/binding`, async (c) => {
    const [index] = await rows(
      deps,
      `select index_id, name, dimensions, metric from plane_vectorize_indexes
        where index_id=$1 and cluster_id=$2`,
      [c.req.param('indexId'), c.req.param('cellId')]
    )
    if (!index) throw new VrtControlError(404, 'Vectorize index not found')
    return c.json({
      data: {
        binding: {
          type: 'VECTORIZE',
          resourceId: String(index.index_id),
          indexName: String(index.name),
          dimensions: Number(index.dimensions),
          metric: String(index.metric),
          permissionRead: true,
          permissionWrite: true,
        },
      },
    })
  })
}
