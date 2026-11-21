/**
 * Management API (`/api/v1`): every resource and operation the reference plane
 * stores can be driven over HTTP, so the CLI seed/deploy/maintain paths are not
 * the only way to operate a cell.
 *
 * Auth: `Authorization: Bearer <PLANE_ADMIN_TOKEN>` (falls back to
 * `PLANE_TOKEN` for single-token deployments). Cell channels keep their own
 * scoped token and live under `/api/internal/clusters/...`.
 */
import { Hono, type Context } from 'hono'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import {
  VrtControlError,
  bundleKeyFor,
  type BundleStore,
  type SnapshotSigningContext,
  type VrtBindingRecord,
  type VrtControlStore,
  type VrtCreateVersionInput,
} from 'openflare-control'
import { publishCell } from './publish.js'
import { collectRenderInputs } from './renderInputs.js'

export interface AdminDeps {
  pool: Pool
  store: VrtControlStore
  bundleStore: BundleStore
  token: string
  adminToken?: string
  signing?: SnapshotSigningContext
  maxBundleBytes?: number
}

const MAX_JSON = 1024 * 1024

const cellId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
const teamId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
const workerName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
const key = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/)
const hostname = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const quotas = z
  .object({
    cpuMs: z.number().int().min(1).max(300_000),
    memoryMb: z.number().int().min(1).max(4096),
    subrequests: z.number().int().min(0).max(10_000),
    outboundConnections: z.number().int().min(0).max(1024),
  })
  .strict()

const versionBody = z
  .object({
    versionId: z.string().min(1).max(128),
    bundleSha256: digest,
    bundleBytes: z.number().int().min(0).optional(),
    mainModule: z.string().min(1).max(255).default('index.js'),
    modules: z.array(z.unknown()).default([]),
    compatibilityDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2024-01-01'),
    compatibilityFlags: z.array(z.string().max(64)).default([]),
    crons: z.array(z.object({ scheduleId: z.string(), expression: z.string() })).default([]),
    quotas: quotas.optional(),
    vars: z.record(key, z.string()).default({}),
    bindings: z.array(z.record(z.unknown())).default([]),
    assetsRouting: z.enum(['ASSETS_FIRST', 'WORKER_FIRST']).nullable().optional(),
    assetsRunWorkerFirst: z.array(z.string()).optional(),
    exportedClassNames: z.array(z.string()).optional(),
  })
  .strict()

function admin(c: Context, expected: string): void {
  const header = c.req.header('authorization') ?? ''
  const got = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!got || !timingSafeEqual(a, b)) {
    throw new VrtControlError(401, 'Invalid management token')
  }
}

async function readJson(c: Context, max = MAX_JSON): Promise<unknown> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max)
    throw new VrtControlError(413, 'Payload too large')
  const raw = await c.req.text()
  if (Buffer.byteLength(raw, 'utf8') > max) throw new VrtControlError(413, 'Payload too large')
  try {
    return JSON.parse(raw)
  } catch {
    throw new VrtControlError(400, 'Invalid JSON')
  }
}

const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> => {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new VrtControlError(
      400,
      `Invalid request: ${result.error.issues[0]?.path.join('.') ?? 'body'}`
    )
  }
  return result.data
}

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

type Row = Record<string, unknown>

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const n = (v: unknown): number => Number(v)
const nullableString = (v: unknown): string | null => (v == null ? null : String(v))
const iso = (v: unknown): string | null => (v == null ? null : new Date(String(v)).toISOString())

const mapCell = (r: Row) => ({
  cellId: s(r.cell_id),
  clusterId: s(r.cluster_id),
  revision: n(r.revision),
  capabilities: r.capabilities ?? null,
  ...(r.workers === undefined
    ? {}
    : {
        workerCount: n(r.workers),
        publicationCount: n(r.publications ?? 0),
        d1Ops: n(r.d1_ops ?? 0),
        cellOps: n(r.cell_ops ?? 0),
        latestRevision: r.latest_revision == null ? null : n(r.latest_revision),
      }),
})

const mapWorker = (r: Row) => ({
  workerId: s(r.id),
  teamId: s(r.team_id),
  clusterId: s(r.cluster_id),
  name: s(r.name),
  runtime: s(r.runtime),
  status: s(r.status),
  activeVersionId: nullableString(r.active_version_id),
  entrypoint: s(r.entrypoint),
  compatibilityDate: s(r.compatibility_date),
  statusReason: nullableString(r.status_reason),
})

const mapOp = (r: Row) => ({
  id: s(r.id),
  seq: n(r.seq),
  databaseId: nullableString(r.database_id),
  workerId: nullableString(r.worker_id),
  resourceKey: nullableString(r.resource_key),
  kind: s(r.kind),
  status: s(r.status),
  result: r.result ?? null,
  error: nullableString(r.error),
  expiresAt: iso(r.expires_at),
  createdAt: iso(r.created_at),
})

const mapLog = (r: Row) => ({
  workerId: s(r.worker_id),
  bootId: s(r.boot_id),
  seq: n(r.seq),
  tsMs: n(r.ts_ms),
  level: s(r.level),
  kind: s(r.kind),
  message: s(r.message),
  outcome: nullableString(r.outcome),
  status: r.status == null ? null : n(r.status),
  code: nullableString(r.code),
  truncated: r.truncated === true,
})

const workerId = (team: string, name: string): string => `${team}:${name}`

export function createAdminApp(deps: AdminDeps): Hono {
  const app = new Hono()
  const expected = deps.adminToken ?? deps.token
  const rows = async (sql: string, params: unknown[] = []) =>
    (await deps.pool.query(sql, params)).rows

  app.use('/api/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    admin(c, expected)
    await next()
  })

  // ---------- cells ----------
  app.get('/api/v1/cells', async (c) => {
    const list = await rows(
      `select c.cell_id, c.cluster_id, c.revision, c.capabilities,
              (select count(*)::int from plane_workers w where w.cluster_id=c.cell_id) as workers,
              (select max(revision) from plane_publications p where p.cell_id=c.cell_id) as latest_revision
         from plane_cells c order by c.cell_id`
    )
    return c.json({ data: { cells: list.map(mapCell) } })
  })

  app.post('/api/v1/cells', async (c) => {
    const body = parse(z.object({ cellId }).strict(), await readJson(c))
    await deps.pool.query(
      `insert into plane_cells (cell_id, cluster_id) values ($1,$1)
       on conflict (cell_id) do nothing`,
      [body.cellId]
    )
    return c.json({ data: { cellId: body.cellId } }, 201)
  })

  app.get('/api/v1/cells/:cellId', async (c) => {
    const cell = c.req.param('cellId')
    const [state] = await rows('select * from plane_cells where cell_id=$1', [cell])
    if (!state) throw new VrtControlError(404, 'Cell not found', 'VRT_CELL_NOT_FOUND')
    const [counts] = await rows(
      `select
         (select count(*)::int from plane_workers where cluster_id=$1) as workers,
         (select count(*)::int from plane_publications where cell_id=$1) as publications,
         (select count(*)::int from plane_d1_ops where cell_id=$1) as d1_ops,
         (select count(*)::int from plane_cell_ops where cell_id=$1) as cell_ops`,
      [cell]
    )
    const [latest] = await rows(
      `select revision, ack_status, issued_at, expires_at from plane_publications
        where cell_id=$1 order by revision desc limit 1`,
      [cell]
    )
    return c.json({
      data: { ...mapCell({ ...state, ...counts }), latestPublication: latest ?? null },
    })
  })

  app.delete('/api/v1/cells/:cellId', async (c) => {
    const cell = c.req.param('cellId')
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'delete from plane_workers where cluster_id in (select cell_id from plane_cells where cell_id=$1)',
        [cell]
      )
      await client.query('delete from plane_publications where cell_id=$1', [cell])
      await client.query('delete from plane_d1_ops where cell_id=$1', [cell])
      await client.query('delete from plane_cell_ops where cell_id=$1', [cell])
      await client.query('delete from plane_logs where cell_id=$1', [cell])
      const deleted = await client.query('delete from plane_cells where cell_id=$1', [cell])
      await client.query('commit')
      if (deleted.rowCount === 0) throw new VrtControlError(404, 'Cell not found')
      return c.json({ data: { deleted: true } })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  })

  app.get('/api/v1/cells/:cellId/render-inputs', async (c) => {
    const inputs = await collectRenderInputs(deps.pool, c.req.param('cellId'))
    return c.json({ data: inputs })
  })

  // ---------- workers ----------
  app.get('/api/v1/cells/:cellId/workers', async (c) => {
    const cell = c.req.param('cellId')
    const team = c.req.query('teamId')
    const list = await rows(
      `select * from plane_workers where cluster_id=$1 and ($2::text is null or team_id=$2)
        order by team_id, name`,
      [cell, team ?? null]
    )
    return c.json({ data: { workers: list.map(mapWorker) } })
  })

  app.post('/api/v1/cells/:cellId/workers', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          teamId,
          name: workerName,
          entrypoint: z.string().min(1).max(255).optional(),
          compatibilityDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .strict(),
      await readJson(c)
    )
    const id = workerId(body.teamId, body.name)
    await deps.pool.query(
      `insert into plane_workers (id, team_id, cluster_id, name, entrypoint, compatibility_date)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do nothing`,
      [
        id,
        body.teamId,
        cell,
        body.name,
        body.entrypoint ?? 'src/index.ts',
        body.compatibilityDate ?? '2024-01-01',
      ]
    )
    const [worker] = await rows('select * from plane_workers where id=$1', [id])
    return c.json({ data: { worker: mapWorker(worker) } }, 201)
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows('select * from plane_workers where id=$1 and cluster_id=$2', [
      id,
      cell,
    ])
    if (!worker) throw new VrtControlError(404, 'Worker not found', 'VRT_WORKER_NOT_FOUND')
    const versions = await deps.store.listVersions(id, { limit: 50 })
    const vars = await rows('select key, value from plane_vars where worker_id=$1 order by key', [
      id,
    ])
    const secrets = await rows('select key from plane_secrets where worker_id=$1 order by key', [
      id,
    ])
    const hosts = await rows(
      'select hostname, status, kind from plane_hostnames where worker_id=$1',
      [id]
    )
    return c.json({
      data: {
        worker: mapWorker(worker),
        versions,
        vars,
        secretKeys: secrets.map((r) => r.key),
        hostnames: hosts,
      },
    })
  })

  app.patch('/api/v1/cells/:cellId/teams/:teamId/workers/:name', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const body = parse(
      z
        .object({
          entrypoint: z.string().min(1).max(255).optional(),
          compatibilityDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
        })
        .strict(),
      await readJson(c)
    )
    const [worker] = await rows(
      `update plane_workers set
         entrypoint = coalesce($3, entrypoint),
         compatibility_date = coalesce($4, compatibility_date),
         status = coalesce($5, status)
       where id=$1 and cluster_id=$2 returning *`,
      [id, cell, body.entrypoint ?? null, body.compatibilityDate ?? null, body.status ?? null]
    )
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    return c.json({ data: { worker: mapWorker(worker) } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const deleted = await deps.pool.query(
      'delete from plane_workers where id=$1 and cluster_id=$2',
      [workerId(team, name), cell]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Worker not found')
    return c.json({ data: { deleted: true } })
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/versions', async (c) => {
    const { teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const versions = await deps.store.listVersions(id, { limit: 100 })
    return c.json({ data: { versions } })
  })

  app.post('/api/v1/cells/:cellId/teams/:teamId/workers/:name/versions', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows('select * from plane_workers where id=$1 and cluster_id=$2', [
      id,
      cell,
    ])
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    const body = parse(versionBody, await readJson(c))
    await deps.store.registerBundleObject({
      digest: body.bundleSha256,
      bytes: body.bundleBytes ?? 0,
      createdById: 'plane-api',
    })
    const fp = sha256(
      JSON.stringify({
        bindings: body.bindings,
        vars: Object.keys(body.vars).sort(),
        crons: body.crons,
        compatibilityDate: body.compatibilityDate,
        compatibilityFlags: body.compatibilityFlags,
        quotas: body.quotas ?? null,
      })
    )
    const input: VrtCreateVersionInput = {
      workerId: id,
      versionId: body.versionId,
      bundleSha256: body.bundleSha256,
      bundleKey: bundleKeyFor(body.bundleSha256),
      bundleBytes: body.bundleBytes ?? 0,
      mainModule: body.mainModule,
      modules: body.modules,
      compatibilityDate: body.compatibilityDate,
      compatibilityFlags: body.compatibilityFlags,
      crons: body.crons,
      quotas: body.quotas ?? {
        cpuMs: 10_000,
        memoryMb: 128,
        subrequests: 50,
        outboundConnections: 6,
      },
      varValues: body.vars,
      bindingsFingerprint: fp,
      runtimeConfigDigest: fp,
      bindings: body.bindings as unknown as readonly VrtBindingRecord[],
      assetsRouting: body.assetsRouting ?? null,
      assetsRunWorkerFirst: body.assetsRunWorkerFirst ?? [],
      exportedClassNames: body.exportedClassNames,
      createdById: 'plane-api',
    }
    const { version, created } = await deps.store.createVersionWithBindings(input)
    for (const [k, value] of Object.entries(body.vars)) {
      await deps.pool.query(
        `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
         on conflict (worker_id, key) do update set value=excluded.value`,
        [id, k, value]
      )
    }
    return c.json({ data: { version, created } }, created ? 201 : 200)
  })

  app.post(
    '/api/v1/cells/:cellId/teams/:teamId/workers/:name/versions/:versionId/activate',
    async (c) => {
      const { cellId: cell, teamId: team, name, versionId } = c.req.param()
      const id = workerId(team, name)
      const version = await deps.store.getVersionByVersionId(id, versionId)
      if (!version) throw new VrtControlError(404, 'Version not found')
      await deps.store.runCellTransaction(cell, (tx) => tx.activateVersion(id, versionId))
      return c.json({ data: { workerId: id, versionId, activated: true } })
    }
  )

  // ---------- vars / secrets / hostnames ----------
  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars', async (c) => {
    const { teamId: team, name } = c.req.param()
    const list = await rows('select key, value from plane_vars where worker_id=$1 order by key', [
      workerId(team, name),
    ])
    return c.json({ data: { vars: list } })
  })

  app.put('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars/:key', async (c) => {
    const { teamId: team, name, key: k } = c.req.param()
    parse(key, k)
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    await deps.pool.query(
      `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
       on conflict (worker_id, key) do update set value=excluded.value`,
      [workerId(team, name), k, body.value]
    )
    return c.json({ data: { key: k, value: body.value } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/vars/:key', async (c) => {
    const { teamId: team, name, key: k } = c.req.param()
    await deps.pool.query('delete from plane_vars where worker_id=$1 and key=$2', [
      workerId(team, name),
      k,
    ])
    return c.json({ data: { deleted: true } })
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets', async (c) => {
    const { teamId: team, name } = c.req.param()
    const list = await rows('select key from plane_secrets where worker_id=$1 order by key', [
      workerId(team, name),
    ])
    return c.json({ data: { keys: list.map((r) => r.key) } })
  })

  app.put('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets/:key', async (c) => {
    const { teamId: team, name, key: k } = c.req.param()
    parse(key, k)
    const body = parse(z.object({ value: z.string() }).strict(), await readJson(c))
    await deps.pool.query(
      `insert into plane_secrets (worker_id, key, value) values ($1,$2,$3)
       on conflict (worker_id, key) do update set value=excluded.value`,
      [workerId(team, name), k, body.value]
    )
    return c.json({ data: { key: k } })
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/secrets/:key', async (c) => {
    const { teamId: team, name, key: k } = c.req.param()
    await deps.pool.query('delete from plane_secrets where worker_id=$1 and key=$2', [
      workerId(team, name),
      k,
    ])
    return c.json({ data: { deleted: true } })
  })

  app.post('/api/v1/cells/:cellId/teams/:teamId/workers/:name/hostnames', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows('select id from plane_workers where id=$1 and cluster_id=$2', [
      id,
      cell,
    ])
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    const body = parse(z.object({ hostname }).strict(), await readJson(c))
    if (await deps.store.isHostnameTaken(body.hostname, { excludeWorkerId: id })) {
      throw new VrtControlError(409, 'Hostname already claimed', 'VRT_HOSTNAME_TAKEN')
    }
    await deps.pool.query(
      `insert into plane_hostnames (id, hostname, worker_id) values ($1,$2,$3)
       on conflict (hostname, worker_id) do nothing`,
      [`${id}:${body.hostname}`, body.hostname, id]
    )
    return c.json({ data: { hostname: body.hostname } }, 201)
  })

  app.delete('/api/v1/cells/:cellId/teams/:teamId/workers/:name/hostnames/:hostname', async (c) => {
    const { teamId: team, name } = c.req.param()
    const host = c.req.param('hostname')
    const deleted = await deps.pool.query(
      'delete from plane_hostnames where worker_id=$1 and hostname=$2',
      [workerId(team, name), host]
    )
    if (deleted.rowCount === 0) throw new VrtControlError(404, 'Hostname not found')
    return c.json({ data: { deleted: true } })
  })

  // ---------- bundles ----------
  app.put('/api/v1/cells/:cellId/bundles/:digest', async (c) => {
    const d = c.req.param('digest')
    parse(digest, d)
    const max = deps.maxBundleBytes ?? 128 * 1024 * 1024
    const declared = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > max)
      throw new VrtControlError(413, 'Bundle too large')
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength > max) throw new VrtControlError(413, 'Bundle too large')
    if (sha256(bytes) !== d) throw new VrtControlError(400, 'Digest does not match body')
    await deps.store.registerBundleObject({
      digest: d,
      bytes: bytes.byteLength,
      createdById: 'plane-api',
    })
    await deps.bundleStore.put(bundleKeyFor(d), bytes)
    return c.json({ data: { digest: d, bytes: bytes.byteLength } }, 201)
  })

  app.get('/api/v1/cells/:cellId/bundles/:digest', async (c) => {
    const d = c.req.param('digest')
    parse(digest, d)
    const object = await deps.bundleStore.get(bundleKeyFor(d))
    if (!object) throw new VrtControlError(404, 'Bundle not found')
    const bytes = new Uint8Array(await new Response(object.stream).arrayBuffer())
    return c.body(bytes, 200, { 'Content-Type': 'application/octet-stream' })
  })

  // ---------- publish / publications ----------
  app.post('/api/v1/cells/:cellId/publish', async (c) => {
    const cell = c.req.param('cellId')
    if (!deps.signing) throw new VrtControlError(501, 'Signing is not configured')
    const raw = await c.req.text()
    const body = parse(
      z
        .object({
          cause: z.string().min(1).max(64).optional(),
          workerId: z.string().optional(),
          versionId: z.string().optional(),
        })
        .strict(),
      (() => {
        if (!raw.trim()) return {}
        try {
          return JSON.parse(raw)
        } catch {
          throw new VrtControlError(400, 'Invalid JSON')
        }
      })()
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

  // ---------- ops ----------
  app.post('/api/v1/cells/:cellId/d1-ops', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          databaseId: z.string().regex(/^[a-z0-9]{26}$/),
          kind: z.enum(['EXECUTE', 'MIGRATIONS_APPLY', 'DROP']),
          payload: z.record(z.unknown()),
          expiresAt: z.number().int().optional(),
        })
        .strict(),
      await readJson(c)
    )
    const id = randomUUID()
    await deps.pool.query(
      `insert into plane_d1_ops (id, cell_id, database_id, kind, payload, expires_at)
       values ($1,$2,$3,$4,$5,to_timestamp($6::double precision))`,
      [id, cell, body.databaseId, body.kind, body.payload, body.expiresAt ?? null]
    )
    return c.json({ data: { id } }, 201)
  })

  app.get('/api/v1/cells/:cellId/d1-ops', async (c) => {
    const status = c.req.query('status')
    const list = await rows(
      `select id, seq, database_id, kind, status, result, error, expires_at, created_at
         from plane_d1_ops where cell_id=$1 and ($2::text is null or status=$2)
        order by seq limit 200`,
      [c.req.param('cellId'), status ?? null]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })

  app.post('/api/v1/cells/:cellId/cell-ops', async (c) => {
    const cell = c.req.param('cellId')
    const body = parse(
      z
        .object({
          kind: z.string().min(1).max(64),
          workerId: z.string().optional(),
          resourceKey: z.string().max(128).optional(),
          payload: z.record(z.unknown()),
          expiresAt: z.number().int().optional(),
        })
        .strict(),
      await readJson(c)
    )
    const id = randomUUID()
    await deps.pool.query(
      `insert into plane_cell_ops (id, cell_id, worker_id, resource_key, kind, payload, expires_at)
       values ($1,$2,$3,$4,$5,$6,to_timestamp($7::double precision))`,
      [
        id,
        cell,
        body.workerId ?? null,
        body.resourceKey ?? '',
        body.kind,
        body.payload,
        body.expiresAt ?? null,
      ]
    )
    return c.json({ data: { id } }, 201)
  })

  app.get('/api/v1/cells/:cellId/cell-ops', async (c) => {
    const status = c.req.query('status')
    const list = await rows(
      `select id, seq, worker_id, resource_key, kind, status, result, error, expires_at, created_at
         from plane_cell_ops where cell_id=$1 and ($2::text is null or status=$2)
        order by seq limit 200`,
      [c.req.param('cellId'), status ?? null]
    )
    return c.json({ data: { ops: list.map(mapOp) } })
  })

  // ---------- logs / maintenance ----------
  app.get('/api/v1/cells/:cellId/logs', async (c) => {
    const worker = c.req.query('workerId')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 1000)
    const list = await rows(
      `select worker_id, boot_id, seq, ts_ms, level, kind, message, outcome, status, code, truncated
         from plane_logs where cell_id=$1 and ($2::text is null or worker_id=$2)
        order by ts_ms desc limit $3`,
      [c.req.param('cellId'), worker ?? null, limit]
    )
    return c.json({ data: { logs: list.map(mapLog) } })
  })

  app.post('/api/v1/maintenance/prune', async (c) => {
    const body = parse(
      z.object({ keepPerCell: z.number().int().min(0).max(10_000) }).strict(),
      await readJson(c)
    )
    const result = await deps.store.pruneTerminalPublications({
      keepPerCell: body.keepPerCell,
      batchSize: 500,
      maxRows: 5_000,
      deadlineMs: 30_000,
    })
    return c.json({ data: result })
  })

  return app
}
