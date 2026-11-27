import type { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, parse, readJson, requireTeam, teamId, workerName } from '../context.js'

// Workers Cache invalidation. The cell controller fans a CACHE_PURGE op out
// to every pod's loopback purge endpoint (cache entries are pod-local and
// ingress may serve a worker from any pod), so minting the op here is the
// whole control-plane side — polling uses the generic cell-ops endpoints.
//
// Payload shape is the vrt-host `wc_admin` wire contract byte-for-byte —
// the cell re-validates before any IO, but this boundary is where malformed
// purges SHOULD die: an op the cell FAILs costs a pointless round trip.
// `tenantId` is server-injected from the verified team, never caller input
// (the generic ops endpoint already rejects it as a scope key).
export function registerCacheService(app: Hono, deps: AdminDeps): void {
  app.post('/api/v1/cells/:cellId/teams/:teamId/cache/purge', async (c) => {
    const cell = c.req.param('cellId')
    const team = parse(teamId, c.req.param('teamId'))
    const body = parse(
      z
        .object({
          // Purge one worker's entries, addressed by NAME like every other
          // worker endpoint — the wire `team:name` id is derived here. The
          // worker need not still exist: purge means "no matching entries
          // may survive", trivially true for an absent worker, and residue
          // from a deleted worker is a legitimate target.
          workerName: workerName.optional(),
          // Host bound is `wc::MAX_TAGS` — keep byte-identical.
          tags: z.array(z.string().min(1)).min(1).max(1000).optional(),
          pathPrefix: z.string().startsWith('/').max(2048).optional(),
          all: z.boolean().optional(),
        })
        .strict(),
      await readJson(c)
    )
    const modes = [
      body.workerName !== undefined,
      body.tags !== undefined,
      body.pathPrefix !== undefined,
      body.all === true,
    ].filter(Boolean).length
    if (modes !== 1) {
      throw new VrtControlError(400, 'exactly one of workerName/tags/pathPrefix/all')
    }
    await requireTeam(deps, team)

    // Fail closed like every storage-purge path: a cell that cannot prove
    // the cache-purge channel would leave the op PENDING until expiry —
    // report it instead of enqueueing an op nothing can ack.
    const caps = await deps.store.cellCapabilities(cell)
    if (!caps?.cachePurge) {
      throw new VrtControlError(409, 'Cell does not support cache purge')
    }

    const payload: Record<string, unknown> = { tenantId: team }
    let resourceKey = team
    if (body.workerName !== undefined) {
      const target = `${team}:${body.workerName}`
      payload.workerId = target
      resourceKey = target
    } else if (body.tags !== undefined) {
      payload.tags = body.tags
    } else if (body.pathPrefix !== undefined) {
      payload.pathPrefix = body.pathPrefix
    } else {
      payload.all = true
    }

    const opId = randomUUID()
    const inserted = await deps.pool.query(
      `insert into plane_cell_ops
         (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,'',$3,'CACHE_PURGE',$4,now() + interval '1 hour')
       returning seq`,
      [opId, cell, resourceKey, payload]
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
}
