import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import {
  type AdminDeps,
  generatedId,
  mapOp,
  opExpiresAt,
  parse,
  readJson,
  requireTeam,
  resourceId,
  rows,
  teamId,
} from '../context.js'

const KV_KINDS = [
  'KV_GET',
  'KV_PUT',
  'KV_DELETE',
  'KV_LIST',
  'KV_BULK_PUT',
  'KV_BULK_DELETE',
] as const

/**
 * Build the exact payload the cell's KV executor accepts. The cell
 * deserializes with `deny_unknown_fields`, so spreading the client payload
 * verbatim means any stray key fails the op with "malformed payload" — and
 * values cross the JSON op channel base64-encoded, which is a wire concern
 * that belongs at this boundary, not in the browser. The plane API speaks
 * plain text (`value`); the cell speaks `valueBase64`.
 */
function kvCellPayload(
  kind: (typeof KV_KINDS)[number],
  payload: Record<string, unknown>
): Record<string, unknown> {
  const key = typeof payload.key === 'string' && payload.key ? payload.key : null
  switch (kind) {
    case 'KV_GET':
    case 'KV_DELETE':
      if (!key) throw new VrtControlError(400, 'key is required')
      return { key }
    case 'KV_PUT': {
      if (!key) throw new VrtControlError(400, 'key is required')
      if (typeof payload.value !== 'string') {
        throw new VrtControlError(400, 'value must be a string')
      }
      const out: Record<string, unknown> = {
        key,
        valueBase64: Buffer.from(payload.value, 'utf8').toString('base64'),
      }
      if (typeof payload.expiration === 'number') out.expiration = payload.expiration
      if (typeof payload.expirationTtl === 'number') out.expirationTtl = payload.expirationTtl
      if (payload.metadata !== undefined) out.metadata = payload.metadata
      return out
    }
    case 'KV_LIST': {
      const out: Record<string, unknown> = {}
      if (typeof payload.prefix === 'string') out.prefix = payload.prefix
      if (typeof payload.cursor === 'string') out.cursor = payload.cursor
      if (typeof payload.limit === 'number') out.limit = payload.limit
      return out
    }
    case 'KV_BULK_DELETE': {
      if (!Array.isArray(payload.keys) || payload.keys.some((k) => typeof k !== 'string')) {
        throw new VrtControlError(400, 'keys must be an array of strings')
      }
      return { keys: payload.keys }
    }
    case 'KV_BULK_PUT': {
      if (!Array.isArray(payload.entries)) {
        throw new VrtControlError(400, 'entries must be an array')
      }
      return {
        entries: payload.entries.map((entry, i) => {
          const e = entry as Record<string, unknown>
          if (typeof e.key !== 'string' || typeof e.value !== 'string') {
            throw new VrtControlError(400, `entries[${i}] needs string key and value`)
          }
          const out: Record<string, unknown> = {
            key: e.key,
            valueBase64: Buffer.from(e.value, 'utf8').toString('base64'),
          }
          if (typeof e.expiration === 'number') out.expiration = e.expiration
          if (typeof e.expirationTtl === 'number') out.expirationTtl = e.expirationTtl
          if (e.metadata !== undefined) out.metadata = e.metadata
          return out
        }),
      }
    }
  }
}

export function registerKvService(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/kv/namespaces', async (c) => {
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
      `select namespace_id, physical_id, team_id, cluster_id, title, created_at
         from plane_kv_namespaces
        where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, title`,
      [c.req.param('cellId'), team ?? null]
    )
    return c.json({ data: { namespaces: list } })
  })

  app.post('/api/v1/cells/:cellId/kv/namespaces', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          title: z.string().min(1).max(63),
        })
        .strict(),
      await readJson(c)
    )
    const namespaceId = generatedId(`${cell}:${body.teamId}:kv:${body.title}`)
    const physicalId = `vrtkv_${namespaceId}`
    await requireTeam(deps, body.teamId)
    await deps.pool.query(
      `insert into plane_kv_namespaces (namespace_id, physical_id, team_id, cluster_id, title)
       values ($1,$2,$3,$4,$5) on conflict (namespace_id) do nothing`,
      [namespaceId, physicalId, body.teamId, cell, body.title]
    )
    const [namespace] = await rows(
      deps,
      'select * from plane_kv_namespaces where namespace_id=$1',
      [namespaceId]
    )
    return c.json({ data: { namespace } }, 201)
  })

  app.delete('/api/v1/cells/:cellId/kv/namespaces/:namespaceId', async (c) => {
    const cell = c.req.param('cellId')
    const id = parse(resourceId, c.req.param('namespaceId'))
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      // Ops key on the namespace's physical_id — a re-created namespace id
      // must not inherit ops minted against the deleted one.
      await client.query(
        `delete from plane_cell_ops
          where cell_id=$1
            and resource_key=(
              select physical_id from plane_kv_namespaces
               where namespace_id=$2 and cluster_id=$1)`,
        [cell, id]
      )
      const deleted = await client.query(
        'delete from plane_kv_namespaces where namespace_id=$1 and cluster_id=$2',
        [id, cell]
      )
      await client.query('commit')
      if (deleted.rowCount === 0) throw new VrtControlError(404, 'KV namespace not found')
      return c.json({ data: { deleted: true } })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  })

  app.post('/api/v1/cells/:cellId/kv/namespaces/:namespaceId/ops', async (c) => {
    const cell = c.req.param('cellId')
    const id = parse(resourceId, c.req.param('namespaceId'))
    const [ns] = await rows(
      deps,
      'select * from plane_kv_namespaces where namespace_id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!ns) throw new VrtControlError(404, 'KV namespace not found')
    const body = parse(
      z
        .object({
          kind: z.enum(KV_KINDS),
          payload: z.record(z.unknown()).default({}),
          expiresAt: opExpiresAt,
        })
        .strict(),
      await readJson(c)
    )
    if ('tenantId' in body.payload || 'namespaceId' in body.payload) {
      throw new VrtControlError(400, 'Scope fields are server-injected')
    }
    const opId = randomUUID()
    await deps.pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,null,$3,$4,$5,to_timestamp($6::double precision))`,
      [
        opId,
        cell,
        ns.physical_id,
        body.kind,
        {
          tenantId: ns.team_id,
          namespaceId: ns.physical_id,
          ...kvCellPayload(body.kind, body.payload),
        },
        body.expiresAt ?? null,
      ]
    )
    return c.json({ data: { opId, channel: 'cell' } }, 202)
  })

  app.get('/api/v1/cells/:cellId/kv/namespaces/:namespaceId/ops', async (c) => {
    const [ns] = await rows(
      deps,
      'select physical_id from plane_kv_namespaces where namespace_id=$1 and cluster_id=$2',
      [parse(resourceId, c.req.param('namespaceId')), c.req.param('cellId')]
    )
    if (!ns) throw new VrtControlError(404, 'KV namespace not found')
    const list = await rows(
      deps,
      `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
         from plane_cell_ops
        where cell_id=$1 and resource_key=$2 and kind like 'KV\\_%'
        order by seq desc limit 100`,
      [c.req.param('cellId'), ns.physical_id]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })
}
