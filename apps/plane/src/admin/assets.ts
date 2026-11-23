import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, parse, teamId } from './context.js'

const digest = z.string().regex(/^[0-9a-f]{64}$/)
const htmlHandling = z.enum([
  'auto-trailing-slash',
  'force-trailing-slash',
  'drop-trailing-slash',
  'none',
])
const notFoundHandling = z.enum(['none', '404-page', 'single-page-application'])
const manifest = z
  .object({
    schemaVersion: z.literal(1),
    htmlHandling: htmlHandling.optional(),
    notFoundHandling: notFoundHandling.optional(),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(1024)
              .refine((p) => p.startsWith('/') && !p.split('/').includes('..')),
            sha256: digest,
            size: z.number().int().min(0),
            mime: z.string().min(1).max(255),
          })
          .strict()
      )
      .max(20_000),
  })
  .strict()

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export function registerAssets(app: Hono, deps: AdminDeps): void {
  const base = '/api/v1/cells/:cellId/teams/:teamId/assets'

  const requireTeam = async (c: {
    req: { param: (key: string) => string }
  }): Promise<{ cell: string; team: string; workerId: string }> => {
    const cell = c.req.param('cellId')
    const team = c.req.param('teamId')
    parse(teamId, team)
    const [worker] = (
      await deps.pool.query(
        'select id from plane_workers where cluster_id=$1 and team_id=$2 limit 1',
        [cell, team]
      )
    ).rows as { id: string }[]
    if (!worker) throw new VrtControlError(404, 'Team has no worker on this cell')
    return { cell, team, workerId: worker.id }
  }

  app.put(`${base}/objects/:digest`, async (c) => {
    const { team } = await requireTeam(c)
    const store = deps.assetStore
    if (!store) throw new VrtControlError(501, 'Asset store is not configured')
    const d = parse(digest, c.req.param('digest'))
    const max = 25 * 1024 * 1024
    const declared = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > max) {
      throw new VrtControlError(413, 'Asset object too large')
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength > max) throw new VrtControlError(413, 'Asset object too large')
    if (sha(bytes) !== d) throw new VrtControlError(400, 'Object digest mismatch')
    await store.putObject(team, d, bytes)
    return c.json({ data: { digest: d, bytes: bytes.byteLength } }, 201)
  })

  app.put(`${base}/manifests/:digest`, async (c) => {
    const { team, workerId } = await requireTeam(c)
    const store = deps.assetStore
    if (!store) throw new VrtControlError(501, 'Asset store is not configured')
    const d = parse(digest, c.req.param('digest'))
    const max = 1024 * 1024
    const declared = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > max) {
      throw new VrtControlError(413, 'Asset manifest too large')
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength > max) throw new VrtControlError(413, 'Asset manifest too large')
    if (sha(bytes) !== d) throw new VrtControlError(400, 'Manifest digest mismatch')
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString('utf8'))
    } catch {
      throw new VrtControlError(400, 'Invalid asset manifest JSON')
    }
    const body = manifest.safeParse(parsed)
    if (!body.success) {
      throw new VrtControlError(
        400,
        `Invalid asset manifest: ${body.error.issues[0]?.path.join('.') ?? 'body'}`
      )
    }
    for (const file of body.data.files) {
      if (!(await store.hasObject(team, file.sha256))) {
        throw new VrtControlError(400, `Asset object is not uploaded: ${file.sha256}`)
      }
    }
    await store.putManifest(team, d, bytes)
    await deps.store.claimAssetsManifest({
      digest: d,
      teamId: team,
      workerId,
      objects: body.data.files.map((file) => ({ digest: file.sha256, bytes: file.size })),
      totalBytes: body.data.files.reduce((sum, file) => sum + file.size, 0),
    })
    return c.json({ data: { digest: d, files: body.data.files.length } }, 201)
  })
}
