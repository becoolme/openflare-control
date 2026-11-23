import { Hono, type Context } from 'hono'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  VrtControlError,
  bundleKeyFor,
  latestDesiredEnvelope,
  recordDesiredAck,
  vrtDesiredAckSchema,
  type BundleStore,
  type VrtControlStore,
} from 'openflare-control'
import { collectRenderInputs } from './renderInputs.js'
import { cellReportSchema } from './cellReport.js'
import type { Pool } from 'pg'
import type { SnapshotSigningContext } from 'openflare-control'
import { createAdminApp } from './admin/index.js'

export interface AppDeps {
  store: VrtControlStore
  pool: Pool
  bundleStore: BundleStore
  /** Management API token — required, distinct from every cell token. */
  adminToken?: string
  /** Needed by the management publish endpoint. */
  signing?: SnapshotSigningContext
  /** Refuse to buffer a bundle larger than this (default 128 MiB). */
  maxBundleBytes?: number
  /** Deployment retention policy (logs/ops/publications). */
  retention?: import('./retention.js').RetentionConfig
  /** At-rest cipher for `plane_secrets.value` — required, no plaintext fallback. */
  secrets: import('./secretsCipher.js').SecretsCipher
  /** Optional content-addressed asset store (shared with the cell provider). */
  assetStore?: import('./assetStore.js').AssetStore
}

const MAX_BODY = 16 * 1024

// Cell pull auth is per-cell: the bearer token's sha256 must match the hash
// provisioned for the `clusterId` in the URL (POST .../cells/:cellId/token,
// admin-only). A single global token would let any one cell's leaked
// credential read every other cell's desired state — including every worker
// secret via render-inputs. Unknown cells fail the same way as a bad token.
async function auth(c: Context, deps: AppDeps): Promise<string> {
  const header = c.req.header('authorization') ?? ''
  const got = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const cellId = c.req.param('clusterId')!
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(cellId) || !got) {
    throw new VrtControlError(401, 'Invalid cell controller token')
  }
  const { rows } = await deps.pool.query(
    'select token_hash from plane_cell_tokens where cell_id=$1',
    [cellId]
  )
  const expected = (rows[0] as { token_hash?: string } | undefined)?.token_hash ?? ''
  const a = Buffer.from(createHash('sha256').update(got).digest('hex'))
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new VrtControlError(401, 'Invalid cell controller token')
  }
  return cellId
}

function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof VrtControlError) {
    return c.json(
      {
        data: null,
        error: { code: error.errorCode ?? 'REQUEST_REJECTED', message: error.message },
      },
      error.status as 400
    )
  }
  // Unknown failures are a server fault: log the name/message (never the
  // request body or headers) and keep the response opaque.
  console.error('[openflare-plane] unhandled request error:', error)
  return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'internal error' } }, 500)
}

async function readJson(c: Context, maxBytes: number): Promise<unknown> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new VrtControlError(413, 'Payload too large')
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new VrtControlError(400, 'Payload too large')
  try {
    return JSON.parse(raw)
  } catch {
    throw new VrtControlError(400, 'Invalid JSON')
  }
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  // Every typed rejection (auth, schema, store) keeps its status instead of
  // turning into a 500 in Hono's default handler.
  app.onError((error, c) => errorResponse(c, error))
  app.use('/api/internal/clusters/:clusterId/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  app.get('/healthz', (c) => c.json({ ok: true }))

  app.get('/api/internal/clusters/:clusterId/vrt/desired', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const envelope = await latestDesiredEnvelope(deps.store, cellId)
      return c.body(JSON.stringify(envelope), 200, { 'Content-Type': 'application/json' })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post('/api/internal/clusters/:clusterId/vrt/desired/ack', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const parsed = vrtDesiredAckSchema.safeParse(await readJson(c, MAX_BODY))
      if (!parsed.success) throw new VrtControlError(400, 'Invalid ack payload')
      // The echoed cell id is untrusted; a mismatch is a cross-cell attempt.
      if (parsed.data.cellId !== undefined && parsed.data.cellId !== cellId) {
        throw new VrtControlError(
          403,
          'ack cellId does not match the authenticated cell',
          'VRT_CELL_MISMATCH'
        )
      }
      const updated = await recordDesiredAck(deps.store, cellId, {
        revision: parsed.data.revision,
        payloadDigest: parsed.data.payloadDigest,
        envelopeDigest: parsed.data.envelopeDigest,
        fenceRevision: parsed.data.fenceRevision,
        status: parsed.data.status,
        reason: parsed.data.reason,
        capabilities: parsed.data.capabilities,
        tenantFailures: parsed.data.tenantFailures,
        podsApplied: parsed.data.podsApplied,
      })
      return c.json({
        data: {
          revision: updated.revision,
          ackStatus: updated.ackStatus,
          ackedAt: updated.ackedAt?.toISOString() ?? null,
        },
      })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get('/api/internal/clusters/:clusterId/vrt/render-inputs', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const inputs = await collectRenderInputs(deps.pool, cellId, deps.secrets)
      return c.body(JSON.stringify(inputs), 200, { 'Content-Type': 'application/json' })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get('/api/internal/clusters/:clusterId/vrt/bundles/:digest', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const digest = c.req.param('digest')
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new VrtControlError(404, 'Not found')
      // A cell may only fetch digests its own publications reference — but
      // the check must cover EVERY retained publication, not a recent slice:
      // a digest that fell outside the old 200-row window 404'd a bundle a
      // still-referenced envelope legitimately points at. This jsonb probe is
      // the SQL twin of `bundleDigestsInEnvelope` (packages/control/
      // publicationDigests.ts) — keep the two paths in sync if the envelope
      // shape moves.
      // Guard every SRF input with jsonb_typeof: a malformed/legacy row must
      // read as "no reference" (404), never as a SQL error that turns into a
      // 500. This preserves `bundleDigestsInEnvelope`'s defensive traversal.
      const { rowCount } = await deps.pool.query(
        `select 1
           from plane_publications p
          where p.cell_id = $1
            and exists (
              select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(p.envelope -> 'payload' -> 'tenants') = 'array'
                      then p.envelope -> 'payload' -> 'tenants'
                    else '[]'::jsonb
                  end
                ) as tenant
               where exists (
                 select 1
                   from jsonb_array_elements(
                     case
                       when jsonb_typeof(tenant -> 'workers') = 'array'
                         then tenant -> 'workers'
                       else '[]'::jsonb
                     end
                   ) as worker
                  where worker -> 'activeVersion' ->> 'artifactDigest' = $2
               )
            )
          limit 1`,
        [cellId, digest]
      )
      if ((rowCount ?? 0) === 0) throw new VrtControlError(404, 'Not found')
      const object = await deps.bundleStore.get(bundleKeyFor(digest))
      if (!object) throw new VrtControlError(404, 'Not found')
      const maxBytes = deps.maxBundleBytes ?? 128 * 1024 * 1024
      if (object.bytes !== null && object.bytes > maxBytes) {
        throw new VrtControlError(413, 'Bundle exceeds the configured size limit')
      }
      const bytes = new Uint8Array(await new Response(object.stream).arrayBuffer())
      if (bytes.byteLength > maxBytes) {
        throw new VrtControlError(413, 'Bundle exceeds the configured size limit')
      }
      return c.body(bytes, 200, { 'Content-Type': 'application/octet-stream' })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get('/api/internal/clusters/:clusterId/vrt/assets/manifests/:digest', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const digest = c.req.param('digest')!
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new VrtControlError(404, 'Not found')
      const store = deps.assetStore
      if (!store) throw new VrtControlError(501, 'Asset store is not configured')
      const { rows } = await deps.pool.query(
        `select tenant->>'tenantId' as team_id
           from plane_publications p,
                jsonb_array_elements(
                  case when jsonb_typeof(p.envelope->'payload'->'tenants')='array'
                    then p.envelope->'payload'->'tenants' else '[]'::jsonb end
                ) tenant,
                jsonb_array_elements(
                  case when jsonb_typeof(tenant->'workers')='array'
                    then tenant->'workers' else '[]'::jsonb end
                ) worker,
                jsonb_array_elements(
                  case when jsonb_typeof(worker->'bindings')='array'
                    then worker->'bindings' else '[]'::jsonb end
                ) binding
          where p.cell_id=$1 and binding->>'type'='assets'
            and binding->>'manifestDigest'=$2
          limit 1`,
        [cellId, digest]
      )
      const team = (rows[0] as { team_id?: string } | undefined)?.team_id
      if (!team) throw new VrtControlError(404, 'Not found')
      const bytes = await store.getManifest(team, digest)
      if (!bytes) throw new VrtControlError(404, 'Not found')
      return c.body(new Uint8Array(bytes).buffer, 200, { 'Content-Type': 'application/json' })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get('/api/internal/clusters/:clusterId/vrt/assets/objects/:digest', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const digest = c.req.param('digest')!
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new VrtControlError(404, 'Not found')
      const store = deps.assetStore
      if (!store) throw new VrtControlError(501, 'Asset store is not configured')
      const { rows } = await deps.pool.query(
        `select distinct tenant->>'tenantId' as team_id, binding->>'manifestDigest' as manifest
           from plane_publications p,
                jsonb_array_elements(
                  case when jsonb_typeof(p.envelope->'payload'->'tenants')='array'
                    then p.envelope->'payload'->'tenants' else '[]'::jsonb end
                ) tenant,
                jsonb_array_elements(
                  case when jsonb_typeof(tenant->'workers')='array'
                    then tenant->'workers' else '[]'::jsonb end
                ) worker,
                jsonb_array_elements(
                  case when jsonb_typeof(worker->'bindings')='array'
                    then worker->'bindings' else '[]'::jsonb end
                ) binding
          where p.cell_id=$1 and binding->>'type'='assets'
          limit 200`,
        [cellId]
      )
      for (const row of rows as { team_id?: string; manifest?: string }[]) {
        if (!row.team_id || !row.manifest) continue
        const manifest = await store.getManifest(row.team_id, row.manifest)
        if (!manifest) continue
        let parsed: { files?: { sha256?: unknown }[] }
        try {
          parsed = JSON.parse(Buffer.from(manifest).toString('utf8'))
        } catch {
          continue
        }
        if (parsed.files?.some((file) => file.sha256 === digest)) {
          const bytes = await store.getObject(row.team_id, digest)
          if (bytes) {
            return c.body(new Uint8Array(bytes).buffer, 200, {
              'Content-Type': 'application/octet-stream',
            })
          }
        }
      }
      throw new VrtControlError(404, 'Not found')
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  // D1 ops: PENDING, unexpired rows in SERIAL order. The cell dedupes by id;
  // the ACK moves the row terminal.
  app.get('/api/internal/clusters/:clusterId/vrt/d1-ops', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const { rows } = await deps.pool.query(
        `select id, seq, database_id, kind, payload, expires_at
           from plane_d1_ops
          where cell_id=$1 and status='PENDING'
            and (expires_at is null or expires_at > now())
          order by seq limit 100`,
        [cellId]
      )
      return c.json({
        data: {
          ops: rows.map((r) => ({
            id: r.id,
            seq: Number(r.seq),
            databaseId: r.database_id,
            kind: r.kind,
            payload: r.payload,
            expiresAt: r.expires_at ? Math.floor(new Date(r.expires_at).getTime() / 1000) : null,
          })),
        },
      })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post('/api/internal/clusters/:clusterId/vrt/d1-ops/ack', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const body = (await readJson(c, 2 * 1024 * 1024)) as { acks?: unknown }
      const acks = Array.isArray(body.acks) ? body.acks : []
      let acked = 0
      let malformed = 0
      for (const raw of acks.slice(0, 500)) {
        const ack = raw as { seq?: unknown; status?: unknown; result?: unknown; error?: unknown }
        const seq = Number(ack.seq)
        const status = ack.status
        if (!Number.isSafeInteger(seq) || seq < 0 || (status !== 'DONE' && status !== 'FAILED')) {
          malformed++
          continue
        }
        const r = await deps.pool.query(
          `update plane_d1_ops set status=$1, result=$2, error=$3
            where cell_id=$4 and seq=$5 and status='PENDING'`,
          [
            status,
            ack.result ?? null,
            typeof ack.error === 'string' ? ack.error.slice(0, 2048) : null,
            cellId,
            seq,
          ]
        )
        acked += r.rowCount ?? 0
      }
      return c.json({ data: { acked, malformed } })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get('/api/internal/clusters/:clusterId/vrt/cell-ops', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const { rows } = await deps.pool.query(
        `select id, seq, worker_id, resource_key, kind, payload, expires_at
           from plane_cell_ops
          where cell_id=$1 and status='PENDING'
            and (expires_at is null or expires_at > now())
          order by seq limit 100`,
        [cellId]
      )
      return c.json({
        data: {
          ops: rows.map((r) => ({
            id: r.id,
            seq: Number(r.seq),
            kind: r.kind,
            workerId: r.worker_id ?? '',
            resourceKey: r.resource_key ?? '',
            payload: r.payload,
            expiresAt: r.expires_at ? Math.floor(new Date(r.expires_at).getTime() / 1000) : null,
          })),
        },
      })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post('/api/internal/clusters/:clusterId/vrt/cell-ops/ack', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const body = (await readJson(c, 2 * 1024 * 1024)) as { acks?: unknown }
      const acks = Array.isArray(body.acks) ? body.acks : []
      let acked = 0
      let malformed = 0
      const statuses = new Set(['DONE', 'FAILED', 'EXPIRED'])
      for (const raw of acks.slice(0, 500)) {
        const ack = raw as { seq?: unknown; status?: unknown; result?: unknown; error?: unknown }
        const seq = Number(ack.seq)
        const status = ack.status
        if (
          !Number.isSafeInteger(seq) ||
          seq < 0 ||
          typeof status !== 'string' ||
          !statuses.has(status)
        ) {
          malformed++
          continue
        }
        const r = await deps.pool.query(
          `update plane_cell_ops set status=$1, result=$2, error=$3
            where cell_id=$4 and seq=$5 and status='PENDING'
            returning id, kind, payload, resource_key`,
          [
            status,
            ack.result ?? null,
            typeof ack.error === 'string' ? ack.error.slice(0, 2048) : null,
            cellId,
            seq,
          ]
        )
        const done = r.rows[0] as
          { id: string; kind: string; payload: unknown; resource_key: string } | undefined
        if (done && status === 'DONE' && done.kind === 'STORAGE_PURGE') {
          const p = done.payload as Record<string, unknown> | null
          if (
            p &&
            p.storage === 'vectorize' &&
            typeof p.storageId === 'string' &&
            typeof p.tenantId === 'string'
          ) {
            const result = (ack.result ?? {}) as Record<string, unknown>
            if (result.complete === true) {
              await deps.pool.query(
                `delete from plane_vectorize_indexes
                  where index_id=$1 and team_id=$2 and cluster_id=$3`,
                [p.storageId, p.tenantId, cellId]
              )
            } else if (result.complete === false) {
              await deps.pool.query(
                `insert into plane_cell_ops
                   (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
                 values ($1,$2,'',$3,'STORAGE_PURGE',$4,now() + interval '1 hour')`,
                [randomUUID(), cellId, done.resource_key, done.payload]
              )
            }
          }
        }
        acked += r.rowCount ?? 0
      }
      return c.json({ data: { acked, malformed } })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  // Log ingest: dedupe by (cell, worker, boot, seq), never fail the cell's
  // push because of one malformed record.
  app.post('/api/internal/clusters/:clusterId/vrt/logs', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const body = (await readJson(c, 2 * 1024 * 1024)) as {
        podId?: unknown
        bootId?: unknown
        records?: unknown
      }
      const records = Array.isArray(body.records) ? body.records.slice(0, 500) : []
      const podId = typeof body.podId === 'string' ? body.podId.slice(0, 128) : null
      const bootId = typeof body.bootId === 'string' ? body.bootId.slice(0, 128) : ''
      let accepted = 0
      for (const raw of records) {
        const r = raw as Record<string, unknown>
        const worker = typeof r.workerId === 'string' ? r.workerId : ''
        const seq = Number(r.seq)
        if (!worker || !Number.isSafeInteger(seq) || seq < 0) continue
        const insert = await deps.pool.query(
          `insert into plane_logs
             (cell_id, pod_id, boot_id, worker_id, seq, ts_ms, level, kind, message, outcome, status, code, truncated)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (cell_id, worker_id, boot_id, seq) do nothing`,
          [
            cellId,
            podId,
            bootId,
            worker,
            seq,
            Number.isFinite(Number(r.tsMs)) ? Math.trunc(Number(r.tsMs)) : Date.now(),
            String(r.level ?? 'info').slice(0, 16),
            String(r.kind ?? '').slice(0, 32),
            String(r.message ?? '').slice(0, 4096),
            typeof r.outcome === 'string' ? r.outcome.slice(0, 32) : null,
            Number.isInteger(Number(r.status)) ? Number(r.status) : null,
            typeof r.code === 'string' ? r.code.slice(0, 64) : null,
            r.truncated === true,
          ]
        )
        accepted += insert.rowCount ?? 0
      }
      return c.json({ data: { accepted, dropped: records.length - accepted } })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  // Periodic cell report: pod metrics deltas + data-plane resource stats +
  // Workflow/DO instance listings. Strict schema; unknown fields fail closed.
  app.post('/api/internal/clusters/:clusterId/vrt/metrics', async (c) => {
    try {
      const cellId = await auth(c, deps)
      const parsed = cellReportSchema.safeParse(await readJson(c, 8 * 1024 * 1024))
      if (!parsed.success) {
        const path = parsed.error.issues[0]?.path.join('.') ?? 'body'
        throw new VrtControlError(400, `Invalid cell report: ${path}`)
      }
      const report = parsed.data
      if (report.cellId !== cellId) {
        throw new VrtControlError(
          403,
          'report cellId does not match the authenticated cell',
          'VRT_CELL_MISMATCH'
        )
      }
      const sampledAt = new Date(report.sampledAtMs)
      if (!Number.isFinite(sampledAt.getTime())) {
        throw new VrtControlError(400, 'Invalid cell report: sampledAtMs')
      }
      // Store only the metrics window in the history table. The resource
      // snapshot (instance lists, D1 tables) is point-in-time and already
      // upserted once; copying it into every 30 s row would multiply storage
      // and read amplification for no consumer (the metrics API only reads
      // `pods`).
      const metricsPayload = {
        schemaVersion: report.schemaVersion,
        cellId: report.cellId,
        sampledAtMs: report.sampledAtMs,
        windowMs: report.windowMs,
        pods: report.pods,
      }
      const inserted = await deps.pool.query(
        `insert into plane_cell_metrics (cell_id, sampled_at, window_ms, payload)
         values ($1,$2,$3,$4)
         on conflict (cell_id, sampled_at) do nothing`,
        [cellId, sampledAt, report.windowMs, metricsPayload]
      )
      if (report.resources) {
        const resourcesAt = new Date(report.resources.sampledAtMs)
        await deps.pool.query(
          `insert into plane_cell_resources (cell_id, sampled_at, payload, updated_at)
           values ($1,$2,$3,now())
           on conflict (cell_id) do update
             set sampled_at = excluded.sampled_at,
                 payload = excluded.payload,
                 updated_at = now()
           where excluded.sampled_at >= plane_cell_resources.sampled_at`,
          [
            cellId,
            Number.isFinite(resourcesAt.getTime()) ? resourcesAt : sampledAt,
            report.resources,
          ]
        )
      }
      return c.json({
        data: {
          stored: (inserted.rowCount ?? 0) > 0,
          duplicate: (inserted.rowCount ?? 0) === 0,
          pods: report.pods.length,
        },
      })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  // Management API (cells/workers/versions/vars/secrets/hostnames/bundles/publish/ops/logs).
  app.route('/', createAdminApp(deps))

  return app
}
