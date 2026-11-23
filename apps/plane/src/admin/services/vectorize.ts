import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { randomBytes, randomUUID } from 'node:crypto'
import { type AdminDeps, generatedId, parse, readJson, rows, teamId } from '../context.js'

const metric = z.enum(['cosine', 'euclidean', 'dot-product'])
const indexName = z
  .string()
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)

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
    const [existing] = await rows(
      deps,
      `select index_id, team_id, cluster_id, name, dimensions, metric, created_at
         from plane_vectorize_indexes
        where team_id=$1 and cluster_id=$2 and name=$3`,
      [body.teamId, cell, body.name]
    )
    if (existing) {
      if (
        Number(existing.dimensions) !== body.dimensions ||
        String(existing.metric) !== body.metric
      ) {
        throw new VrtControlError(409, 'Vectorize index dimensions/metric are immutable')
      }
      return c.json({ data: { index: existing } }, 200)
    }
    // Include a per-incarnation component so delete + re-create never reopens
    // the old physical index (the provider has no purge op yet).
    const id = generatedId(
      `${cell}:${body.teamId}:vectorize:${body.name}:${randomBytes(8).toString('hex')}`
    )
    await deps.pool.query(
      `insert into plane_vectorize_indexes
         (index_id, team_id, cluster_id, name, dimensions, metric)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (team_id, cluster_id, name) do nothing`,
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
    const cell = c.req.param('cellId')
    const indexId = c.req.param('indexId')
    const [index] = await rows(
      deps,
      `select index_id, team_id
         from plane_vectorize_indexes
        where index_id=$1 and cluster_id=$2`,
      [indexId, cell]
    )
    if (!index) throw new VrtControlError(404, 'Vectorize index not found')
    const [referenced] = await rows(
      deps,
      `select 1
         from plane_workers w
         join plane_versions v on v.worker_id=w.id,
              jsonb_array_elements(
                case when jsonb_typeof(v.row->'bindings')='array'
                  then v.row->'bindings' else '[]'::jsonb end
              ) binding
        where w.cluster_id=$1 and binding->>'type'='VECTORIZE'
          and binding->>'resourceId'=$2
        limit 1`,
      [cell, indexId]
    )
    if (referenced) throw new VrtControlError(409, 'Vectorize index is referenced by a version')
    // Purge is a runtime storage operation. A cell that cannot prove both
    // the storage-purge channel and a Vectorize store must not lose the
    // metadata (which would orphan the data with no retry path).
    const caps = await deps.store.cellCapabilities(cell)
    if (!caps?.storagePurge || !caps.vectorizePurge) {
      throw new VrtControlError(409, 'Cell does not support Vectorize storage purge')
    }
    const [pending] = await rows(
      deps,
      `select id, seq
         from plane_cell_ops
        where cell_id=$1 and kind='STORAGE_PURGE' and status='PENDING'
          and resource_key=$2 and payload->>'storage'='vectorize'
          and payload->>'storageId'=$2 and payload->>'tenantId'=$3
        order by seq limit 1`,
      [cell, indexId, String(index.team_id)]
    )
    if (pending) {
      return c.json(
        {
          data: {
            opId: pending.id,
            seq: Number(pending.seq),
            channel: 'cell',
            status: 'PURGE_PENDING',
          },
        },
        202
      )
    }
    const opId = randomUUID()
    const payload = {
      storage: 'vectorize',
      storageId: indexId,
      tenantId: String(index.team_id),
    }
    const inserted = await deps.pool.query(
      `insert into plane_cell_ops
         (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,'',$3,'STORAGE_PURGE',$4,now() + interval '1 hour')
       returning seq`,
      [opId, cell, indexId, payload]
    )
    return c.json(
      {
        data: {
          opId,
          seq: Number(inserted.rows[0]!.seq),
          channel: 'cell',
          status: 'PURGE_PENDING',
        },
      },
      202
    )
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
