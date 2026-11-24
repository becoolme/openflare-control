import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import { z } from 'zod'
import { VrtControlError } from 'openflare-control'
import { type AdminDeps, parse, readBody, teamId } from './context.js'

const digest = z.string().regex(/^[0-9a-f]{64}$/)
const OBJECT_MAX = 8 * 1024 * 1024
const FILES_MAX = 8192
const TEAM_ASSET_QUOTA = 512 * 1024 * 1024
const assetPath = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (!value.startsWith('/')) return false
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      return false
    }
    if (decoded.includes('\\') || decoded.includes('\0')) return false
    const segments = decoded.split('/')
    return segments[0] === '' && segments.slice(1).every((s) => s && s !== '.' && s !== '..')
  })
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
            path: assetPath,
            sha256: digest,
            size: z.number().int().min(0).max(OBJECT_MAX),
            mime: z.string().regex(/^[\x20-\x7E]{1,128}$/),
          })
          .strict()
      )
      .max(FILES_MAX),
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
        'select id from plane_workers where cluster_id=$1 and team_id=$2 order by id limit 1',
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
    const max = OBJECT_MAX
    const bytes = new Uint8Array(await readBody(c, max))
    if (sha(bytes) !== d) throw new VrtControlError(400, 'Object digest mismatch')
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`plane-assets:${team}`])
      const used = await client.query(
        `select coalesce(sum(bytes),0)::bigint as n
           from plane_asset_objects where team_id=$1 and digest<>$2`,
        [team, d]
      )
      if (Number(used.rows[0]?.n ?? 0) + bytes.byteLength > TEAM_ASSET_QUOTA) {
        throw new VrtControlError(409, 'Asset quota exceeded')
      }
      await client.query(
        `insert into plane_asset_objects (team_id, digest, bytes) values ($1,$2,$3)
         on conflict (team_id, digest) do update set bytes=excluded.bytes`,
        [team, d, bytes.byteLength]
      )
      await store.putObject(team, d, bytes)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    return c.json({ data: { digest: d, bytes: bytes.byteLength } }, 201)
  })

  app.put(`${base}/manifests/:digest`, async (c) => {
    const { team, workerId } = await requireTeam(c)
    const store = deps.assetStore
    if (!store) throw new VrtControlError(501, 'Asset store is not configured')
    const d = parse(digest, c.req.param('digest'))
    const max = 1024 * 1024
    const bytes = new Uint8Array(await readBody(c, max))
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
      const stored = await store.statObject(team, file.sha256)
      if (stored === null || stored !== file.size) {
        throw new VrtControlError(400, `Asset object size mismatch: ${file.sha256}`)
      }
    }
    await store.putManifest(team, d, bytes)
    try {
      await deps.store.claimAssetsManifest({
        digest: d,
        teamId: team,
        workerId,
        objects: body.data.files.map((file) => ({ digest: file.sha256, bytes: file.size })),
        totalBytes: body.data.files.reduce((sum, file) => sum + file.size, 0),
        quotaBytes: TEAM_ASSET_QUOTA,
      })
    } catch (error) {
      await store.deleteManifest(team, d)
      throw error
    }
    return c.json({ data: { digest: d, files: body.data.files.length } }, 201)
  })
}
