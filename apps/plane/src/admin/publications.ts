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
          workerId: z.string().optional(),
          versionId: z.string().optional(),
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
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '50'), 1), 200)
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
        })),
      },
    })
  })

  app.get('/api/v1/cells/:cellId/publications/:revision', async (c) => {
    const revision = Number(c.req.param('revision'))
    const pub = await deps.store.findPublication(c.req.param('cellId'), revision)
    if (!pub) throw new VrtControlError(404, 'Publication not found')
    return c.json({ data: { publication: pub } })
  })
}
