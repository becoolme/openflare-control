import { Hono, type Context } from 'hono'
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  VrtControlError,
  bundleDigestsInEnvelope,
  bundleKeyFor,
  latestDesiredEnvelope,
  recordDesiredAck,
  vrtDesiredAckSchema,
  type BundleStore,
  type VrtControlStore,
} from 'openflare-control'
import { collectRenderInputs } from './renderInputs.js'
import type { Pool } from 'pg'

export interface AppDeps {
  store: VrtControlStore
  pool: Pool
  bundleStore: BundleStore
  token: string
  /** Refuse to buffer a bundle larger than this (default 128 MiB). */
  maxBundleBytes?: number
}

const MAX_BODY = 16 * 1024

function auth(c: Context, token: string): string {
  const header = c.req.header('authorization') ?? ''
  const got = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(token).digest()
  if (!got || !timingSafeEqual(a, b)) {
    throw new VrtControlError(401, 'Invalid cell controller token')
  }
  return c.req.param('clusterId')!
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
      const cellId = auth(c, deps.token)
      const envelope = await latestDesiredEnvelope(deps.store, cellId)
      return c.body(JSON.stringify(envelope), 200, { 'Content-Type': 'application/json' })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post('/api/internal/clusters/:clusterId/vrt/desired/ack', async (c) => {
    try {
      const cellId = auth(c, deps.token)
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
      const cellId = auth(c, deps.token)
      const inputs = await collectRenderInputs(deps.pool, cellId)
      return c.body(JSON.stringify(inputs), 200, { 'Content-Type': 'application/json' })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get('/api/internal/clusters/:clusterId/vrt/bundles/:digest', async (c) => {
    try {
      const cellId = auth(c, deps.token)
      const digest = c.req.param('digest')
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new VrtControlError(404, 'Not found')
      const publications = await deps.store.recentPublications(cellId, 200)
      const allowed = new Set<string>()
      for (const p of publications)
        for (const d of bundleDigestsInEnvelope(p.envelope)) allowed.add(d)
      if (!allowed.has(digest)) throw new VrtControlError(404, 'Not found')
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

  // Channels the reference plane does not implement yet: answer the shape a
  // cell polls, but never pretend an operation was applied.
  const emptyOps = (c: Context): Response => {
    auth(c, deps.token)
    return c.json({ data: { ops: [] } })
  }
  const emptyAck = (c: Context): Response => {
    auth(c, deps.token)
    return c.json({ data: { acked: 0, malformed: 0 } })
  }
  const emptyLogs = (c: Context): Response => {
    auth(c, deps.token)
    return c.json({ data: { accepted: 0, dropped: 0 } })
  }
  app.get('/api/internal/clusters/:clusterId/vrt/d1-ops', emptyOps)
  app.post('/api/internal/clusters/:clusterId/vrt/d1-ops/ack', emptyAck)
  app.get('/api/internal/clusters/:clusterId/vrt/cell-ops', emptyOps)
  app.post('/api/internal/clusters/:clusterId/vrt/cell-ops/ack', emptyAck)
  app.post('/api/internal/clusters/:clusterId/vrt/logs', emptyLogs)

  return app
}
