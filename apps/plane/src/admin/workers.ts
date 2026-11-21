import type { Hono } from 'hono'
import { z } from 'zod'
import {
  VrtControlError,
  bundleKeyFor,
  type VrtBindingRecord,
  type VrtCreateVersionInput,
  type VrtQueueConsumerDraft,
} from 'openflare-control'
import {
  type AdminDeps,
  digest,
  key,
  mapWorker,
  parse,
  quotas,
  readJson,
  rows,
  sha256,
  teamId,
  workerId,
  workerName,
} from './context.js'

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
    queueConsumers: z
      .array(
        z
          .object({
            queueId: z.string().regex(/^[a-z0-9]{26}$/),
            queueName: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
            maxBatchSize: z.number().int().min(1).max(100).nullable().optional(),
            maxBatchTimeoutMs: z.number().int().min(0).max(60_000).nullable().optional(),
            maxRetries: z.number().int().min(0).max(100).nullable().optional(),
            retryDelaySeconds: z.number().int().min(0).max(3600).nullable().optional(),
            deadLetterQueueId: z
              .string()
              .regex(/^[a-z0-9]{26}$/)
              .nullable()
              .optional(),
            maxConcurrency: z.number().int().min(1).max(1000).nullable().optional(),
          })
          .strict()
      )
      .max(100)
      .optional(),
    assetsRouting: z.enum(['ASSETS_FIRST', 'WORKER_FIRST']).nullable().optional(),
    assetsRunWorkerFirst: z.array(z.string()).optional(),
    exportedClassNames: z.array(z.string()).optional(),
  })
  .strict()

export function registerWorkers(app: Hono, deps: AdminDeps): void {
  app.get('/api/v1/cells/:cellId/workers', async (c) => {
    const cell = c.req.param('cellId')
    const team = c.req.query('teamId')
    const list = await rows(
      deps,
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
    const [worker] = await rows(deps, 'select * from plane_workers where id=$1', [id])
    return c.json({ data: { worker: mapWorker(worker!) } }, 201)
  })

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows(deps, 'select * from plane_workers where id=$1 and cluster_id=$2', [
      id,
      cell,
    ])
    if (!worker) throw new VrtControlError(404, 'Worker not found', 'VRT_WORKER_NOT_FOUND')
    const versions = await deps.store.listVersions(id, { limit: 50 })
    const vars = await rows(
      deps,
      'select key, value from plane_vars where worker_id=$1 order by key',
      [id]
    )
    const secrets = await rows(
      deps,
      'select key from plane_secrets where worker_id=$1 order by key',
      [id]
    )
    const hosts = await rows(
      deps,
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

  app.get('/api/v1/cells/:cellId/teams/:teamId/workers/:name/durable-objects', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows(
      deps,
      'select active_version_id from plane_workers where id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    const versionId = worker.active_version_id as string | null
    if (!versionId) return c.json({ data: { classes: [], bindings: [] } })
    const version = await deps.store.getVersionByVersionId(id, versionId)
    if (!version) throw new VrtControlError(404, 'Active version not found')
    const bindings = (version.bindings ?? []).filter((b) => b.type === 'DO')
    return c.json({
      data: {
        versionId,
        classes: version.exportedClassNames ?? [],
        bindings,
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
      deps,
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
    const versions = await deps.store.listVersions(workerId(team, name), { limit: 100 })
    return c.json({ data: { versions } })
  })

  app.post('/api/v1/cells/:cellId/teams/:teamId/workers/:name/versions', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows(deps, 'select * from plane_workers where id=$1 and cluster_id=$2', [
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
      queueConsumers: body.queueConsumers as unknown as readonly VrtQueueConsumerDraft[],
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
}
