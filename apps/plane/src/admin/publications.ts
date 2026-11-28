import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { publishCell } from '../publish.js'
import { type AdminDeps, parse, readJsonOrEmpty } from './context.js'

export function registerPublications(app: Hono, deps: AdminDeps): void {
  app.post('/api/v1/cells/:cellId/publish', async (c) => {
    const cell = c.req.param('cellId')
    if (!deps.signing) throw new VrtControlError(501, 'Signing is not configured')
    const body = parse(
      z
        .object({
          cause: z.string().min(1).max(64).optional(),
          workerId: z.string().max(128).optional(),
          versionId: z.string().max(128).optional(),
        })
        .strict(),
      await readJsonOrEmpty(c)
    )
    const revision = await publishCell(deps.store, {
      cellId: cell,
      signing: deps.signing,
      cause: body.cause ?? 'API',
      workerId: body.workerId ?? null,
      versionId: body.versionId,
    })
    return c.json({ data: { revision } }, 201)
  })

  app.get('/api/v1/cells/:cellId/publications', async (c) => {
    const raw = Number(c.req.query('limit') ?? '50')
    const limit = Number.isSafeInteger(raw) ? Math.min(Math.max(raw, 1), 200) : 50
    const list = await deps.store.recentPublications(c.req.param('cellId'), limit)
    return c.json({
      data: {
        publications: list.map((p) => ({
          revision: p.revision,
          ackStatus: p.ackStatus,
          issuedAt: p.issuedAt,
          expiresAt: p.expiresAt,
          cause: p.cause,
          workerId: p.workerId,
          versionId: p.versionId,
          payloadDigest: p.payloadDigest,
          // Rollout truth: without these a rejected generation is invisible
          // in the list — the client would have to fetch every revision.
          ackReason: p.ackReason,
          ackTenantFailures: (p.ackTenantFailures ?? []).map((f) => ({
            tenant: f.tenant,
            code: f.code,
            detail: typeof f.detail === 'string' ? f.detail.slice(0, 2048) : f.detail,
          })),
        })),
      },
    })
  })

  app.get('/api/v1/cells/:cellId/publications/:revision', async (c) => {
    const revision = Number(c.req.param('revision'))
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new VrtControlError(400, 'Invalid revision')
    }
    const pub = await deps.store.findPublication(c.req.param('cellId'), revision)
    if (!pub) throw new VrtControlError(404, 'Publication not found')
    return c.json({ data: { publication: pub } })
  })
}
