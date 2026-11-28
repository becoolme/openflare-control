import { randomBytes } from 'node:crypto'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  buildRuntimeBundle,
  VRT_DEFAULT_QUOTAS,
  VRT_MAX_JSON_BINDING_BYTES,
  VrtControlError,
  missingCapabilities,
  serializeBinding,
  requiredCapabilities,
  workerDoClassNameSchema,
  bundleKeyFor,
  type VrtBindingRecord,
  type VrtCreateVersionInput,
  type VrtQueueConsumerDraft,
} from 'openflare-control'
import { publishCell } from '../publish.js'
import { bindingsSchema } from './bindingSchema.js'
import {
  type AdminDeps,
  digest,
  key,
  mapWorker,
  parse,
  quotas,
  readJson,
  requireTeam,
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
    // CF `vars` may carry strings or JSON values. Strings stay in the
    // worker-level var table; non-strings become version-scoped `jsonVars`
    // (rendered as `{"type":"json"}` bindings by computeDesired).
    vars: z
      .record(
        key,
        z.union([
          z.string(),
          z.number().finite(),
          z.boolean(),
          z.null(),
          z.array(z.unknown()),
          z.record(z.unknown()),
        ])
      )
      .default({}),
    bindings: bindingsSchema,
    observability: z
      .object({
        enabled: z.boolean(),
        logsEnabled: z.boolean(),
        invocationLogs: z.boolean(),
        headSamplingRatePpm: z.number().int().min(0).max(1_000_000),
      })
      .strict()
      .nullable()
      .optional(),
    // Workers Cache (`[cache]`): entrypoint response cache. `enabled` is the
    // master switch; key shaping mirrors computeDesired's bounds (names
    // 1..256 chars, sorted+deduped at the snapshot boundary).
    cache: z
      .object({
        enabled: z.boolean(),
        crossVersionCache: z.boolean().default(false),
        key: z
          .object({
            includeQuery: z.array(z.string().min(1).max(256)).max(64).nullable().optional(),
            excludeQuery: z.array(z.string().min(1).max(256)).max(64).nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    // CF `[version_metadata]`: env binding name for `{id, tag, timestamp}`.
    versionMetadata: key.nullable().optional(),
    // Tail consumers are resolved worker ids (`team:name`), same team/cell.
    tailConsumers: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}:[a-z0-9][a-z0-9-]{0,62}$/))
      .max(16)
      .optional(),
    streamingTailConsumers: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}:[a-z0-9][a-z0-9-]{0,62}$/))
      .max(16)
      .optional(),
    queueConsumers: z
      .array(
        z
          .object({
            queueId: z.string().regex(/^[a-z0-9]{26}$/),
            queueName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
            maxBatchSize: z.number().int().min(1).max(100).nullable().optional(),
            maxBatchTimeoutMs: z
              .number()
              .int()
              .min(0)
              .max(60_000)
              .refine((v) => v % 1000 === 0, 'maxBatchTimeoutMs must be whole seconds')
              .nullable()
              .optional(),
            maxRetries: z.number().int().min(0).max(100).nullable().optional(),
            retryDelaySeconds: z.number().int().min(0).max(86_400).nullable().optional(),
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
    exportedClassNames: z.array(workerDoClassNameSchema).optional(),
  })
  .strict()


const moduleSource = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['esModule', 'commonJs']).default('esModule'),
  text: z.string().min(1).max(10 * 1024 * 1024),
})

const deploySourceBody = versionBody
  .omit({ bundleSha256: true, bundleBytes: true, modules: true, versionId: true })
  .extend({
    versionId: z.string().min(1).max(128).optional(),
    modules: z.array(moduleSource).min(1).max(64),
    activate: z.boolean().default(true),
    publish: z.boolean().default(true),
  })
  .strict()

const deployBody = versionBody.extend({
  activate: z.boolean().default(true),
  publish: z.boolean().default(false),
})

type VersionBody = z.output<typeof versionBody>

/**
 * Create a version only when its content-addressed bundle has actually been
 * uploaded. A version row that references missing bytes would fail later at
 * the cell's bundle fetch; fail closed here instead.
 */
async function createVersion(
  deps: AdminDeps,
  workerId: string,
  body: VersionBody
): Promise<{
  version: Awaited<ReturnType<AdminDeps['store']['createVersionWithBindings']>>['version']
  created: boolean
}> {
  const [bundle] = await rows(deps, 'select bytes from plane_bundle_objects where digest=$1', [
    body.bundleSha256,
  ])
  if (!bundle) {
    throw new VrtControlError(409, 'Bundle not uploaded', 'VRT_BUNDLE_NOT_UPLOADED')
  }
  const actualBytes = Number(bundle.bytes)
  if (body.bundleBytes !== undefined && body.bundleBytes !== actualBytes) {
    throw new VrtControlError(
      409,
      'bundleBytes does not match the uploaded bundle',
      'VRT_BUNDLE_SIZE_MISMATCH'
    )
  }
  if (deps.bundleStore.has && !(await deps.bundleStore.has(bundleKeyFor(body.bundleSha256)))) {
    throw new VrtControlError(409, 'Bundle content is missing', 'VRT_BUNDLE_NOT_UPLOADED')
  }
  await deps.store.registerBundleObject({
    digest: body.bundleSha256,
    bytes: actualBytes,
    createdById: 'plane-api',
  })
  // CF vars may be strings or JSON values. Strings stay worker-scoped in
  // plane_vars (render-inputs); JSON values are version-scoped and go through
  // computeDesired as `{"type":"json"}` bindings.
  const stringVars: Record<string, string> = Object.create(null)
  const jsonVars: Record<string, unknown> = Object.create(null)
  for (const [name, value] of Object.entries(body.vars)) {
    if (typeof value === 'string') {
      stringVars[name] = value
      continue
    }
    const encoded = JSON.stringify(value)
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > VRT_MAX_JSON_BINDING_BYTES) {
      throw new VrtControlError(400, `vars.${name} exceeds the JSON binding limit`)
    }
    jsonVars[name] = value
  }

  const [owner] = (await rows(deps, 'select team_id, cluster_id from plane_workers where id=$1', [
    workerId,
  ])) as { team_id: string; cluster_id: string }[]
  if (!owner) throw new VrtControlError(404, 'Worker not found')

  // `nullable().optional()` inputs must reach the store as explicit nulls:
  // computeDesired distinguishes `null` from `undefined` while validating.
  const queueConsumers = (body.queueConsumers ?? []).map((c) => ({
    queueId: c.queueId,
    queueName: c.queueName,
    maxBatchSize: c.maxBatchSize ?? null,
    maxBatchTimeoutMs: c.maxBatchTimeoutMs ?? null,
    maxRetries: c.maxRetries ?? null,
    retryDelaySeconds: c.retryDelaySeconds ?? null,
    deadLetterQueueId: c.deadLetterQueueId ?? null,
    maxConcurrency: c.maxConcurrency ?? null,
  }))

  for (const consumer of queueConsumers) {
    const [queue] = await rows(
      deps,
      'select name from plane_queues where queue_id=$1 and team_id=$2 and cluster_id=$3',
      [consumer.queueId, owner.team_id, owner.cluster_id]
    )
    if (!queue) throw new VrtControlError(400, 'Queue consumer target not found')
    if (String(queue.name) !== consumer.queueName) {
      throw new VrtControlError(400, 'Queue consumer name does not match the target queue')
    }
    if (consumer.deadLetterQueueId !== null) {
      const [dlq] = await rows(
        deps,
        'select 1 from plane_queues where queue_id=$1 and team_id=$2 and cluster_id=$3',
        [consumer.deadLetterQueueId, owner.team_id, owner.cluster_id]
      )
      if (!dlq) throw new VrtControlError(400, 'Dead-letter queue not found')
    }
  }

  const tailConsumers = body.tailConsumers ?? []
  const streamingTailConsumers = body.streamingTailConsumers ?? []
  const tailIds = [...tailConsumers, ...streamingTailConsumers]
  if (new Set(tailIds).size !== tailIds.length) {
    throw new VrtControlError(400, 'tail consumers must be unique across both channels')
  }
  if (tailIds.includes(workerId)) {
    throw new VrtControlError(400, 'a worker cannot tail itself')
  }
  if (tailIds.length > 0) {
    const found = await rows(
      deps,
      `select id from plane_workers
        where id = any($1::text[]) and team_id=$2 and cluster_id=$3
          and runtime='VRT' and status='ACTIVE' and active_version_id is not null`,
      [tailIds, owner.team_id, owner.cluster_id]
    )
    if (found.length !== tailIds.length) {
      throw new VrtControlError(
        400,
        'tail consumers must be existing workers of the same team and cell'
      )
    }
  }

  // `exportedClassNames` predates the class resource API. Keep it as an
  // alias that declares the classes instead of silently ignoring it.
  for (const className of body.exportedClassNames ?? []) {
    await deps.pool.query(
      `insert into plane_do_classes (worker_id, class_name, unique_key, enable_sql)
       values ($1,$2,$3,true) on conflict (worker_id, class_name) do nothing`,
      [workerId, className, randomBytes(32).toString('hex')]
    )
  }

  for (const binding of body.bindings) {
    if (binding.type !== 'DO' || typeof binding.resourceId !== 'string') continue
    const sep = binding.resourceId.lastIndexOf(':')
    const declaringId = sep === -1 ? '' : binding.resourceId.slice(0, sep)
    const className = sep === -1 ? '' : binding.resourceId.slice(sep + 1)
    const [declaringWorker] = await rows(
      deps,
      'select id from plane_workers where id=$1 and team_id=$2 and cluster_id=$3',
      [declaringId, owner.team_id, owner.cluster_id]
    )
    if (!declaringWorker) {
      throw new VrtControlError(400, 'DO binding declaring worker is not in this team/cell')
    }
    const [declared] = await rows(
      deps,
      'select 1 from plane_do_classes where worker_id=$1 and class_name=$2',
      [declaringId, className]
    )
    if (!declared) {
      throw new VrtControlError(400, `Durable Object class is not declared: ${className}`)
    }
  }

  for (const binding of body.bindings) {
    if (binding.type !== 'FLAGSHIP' || typeof binding.resourceId !== 'string') continue
    const [flagshipApp] = await rows(
      deps,
      'select 1 from plane_flagship_apps where team_id=$1 and app_id=$2',
      [owner.team_id, binding.resourceId]
    )
    if (!flagshipApp) {
      throw new VrtControlError(400, `Flagship app is not declared: ${binding.resourceId}`)
    }
  }

  for (const binding of body.bindings) {
    if (binding.type !== 'VECTORIZE' || typeof binding.resourceId !== 'string') continue
    const [index] = await rows(
      deps,
      `select name, dimensions, metric from plane_vectorize_indexes
        where index_id=$1 and team_id=$2 and cluster_id=$3`,
      [binding.resourceId, owner.team_id, owner.cluster_id]
    )
    if (!index) throw new VrtControlError(400, 'Vectorize index is not declared')
    if (
      index.name !== binding.indexName ||
      Number(index.dimensions) !== binding.dimensions ||
      index.metric !== binding.metric
    ) {
      throw new VrtControlError(400, 'Vectorize binding does not match the declared index')
    }
  }

  for (const binding of body.bindings) {
    if (binding.type !== 'SECRETS_STORE') continue
    const storeId = binding.storeId
    const secretName = binding.secretName
    if (
      typeof storeId !== 'string' ||
      typeof secretName !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(storeId) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(secretName) ||
      `secrets-store:${storeId}:${secretName}`.length > 256
    ) {
      throw new VrtControlError(400, 'Invalid Secrets Store binding')
    }
    const [secret] = await rows(
      deps,
      `select 1 from plane_secrets_store
        where team_id=$1 and store_id=$2 and secret_name=$3`,
      [owner.team_id, storeId, secretName]
    )
    if (!secret) throw new VrtControlError(400, 'Secrets Store secret is not declared')
  }

  for (const binding of body.bindings) {
    try {
      serializeBinding(
        binding as unknown as VrtBindingRecord,
        workerId,
        body.assetsRouting ?? null,
        body.assetsRunWorkerFirst ?? []
      )
    } catch (error) {
      throw new VrtControlError(
        400,
        `Invalid binding ${String(binding.name)}: ${
          error instanceof Error ? error.message : 'invalid'
        }`
      )
    }
  }

  for (const binding of body.bindings) {
    if (binding.type !== 'ASSETS' || typeof binding.resourceId !== 'string') continue
    if (
      deps.assetStore &&
      !(await deps.assetStore.hasManifest(owner.team_id, binding.resourceId))
    ) {
      throw new VrtControlError(400, 'Asset manifest is not uploaded')
    }
  }

  const capabilities = await deps.store.cellCapabilities(owner.cluster_id)
  if (capabilities !== null) {
    const required = requiredCapabilities({
      cronCount: body.crons.length,
      bindingTypes: body.bindings
        .map((binding) => (typeof binding.type === 'string' ? binding.type : ''))
        .filter((type) => type.length > 0),
      queueConsumerCount: queueConsumers.length,
      workflowCount: 0,
      crossWorkerWorkflowCount: 0,
      serviceEntrypointCount: body.bindings.filter(
        (binding) => binding.type === 'SERVICE' && typeof binding.entrypoint === 'string'
      ).length,
      servicePropsCount: body.bindings.filter(
        (binding) => binding.type === 'SERVICE' && binding.props != null
      ).length,
      queueDeliveryDelayCount: body.bindings.filter(
        (binding) => binding.type === 'QUEUE' && typeof binding.deliveryDelaySeconds === 'number'
      ).length,
      workerLoaderCount: body.bindings.filter((binding) => binding.type === 'WORKER_LOADER').length,
      nonDefaultQuotaCount: body.quotas ? 1 : 0,
      tailConsumerCount: tailConsumers.length,
      streamingTailConsumerCount: streamingTailConsumers.length,
      observabilityDeclared: body.observability != null,
      cacheDeclared: body.cache?.enabled === true,
      versionMetadata: body.versionMetadata != null,
    })
    const missing = missingCapabilities(required, capabilities)
    if (missing.length > 0) {
      throw new VrtControlError(
        409,
        `Cell lacks capabilities: ${missing.join(', ')}`,
        'VRT_CELL_CAPABILITY_MISSING'
      )
    }
  }

  const envNames = new Set<string>()
  const claimEnvName = (name: string, source: string): void => {
    if (envNames.has(name)) {
      throw new VrtControlError(400, `${source} name "${name}" collides with another env name`)
    }
    envNames.add(name)
  }
  for (const binding of body.bindings) {
    const name = binding?.name
    if (typeof name === 'string') claimEnvName(name, 'binding')
  }
  for (const name of Object.keys(body.vars)) claimEnvName(name, 'var')
  if (body.versionMetadata) claimEnvName(body.versionMetadata, 'versionMetadata')
  for (const secret of await rows(deps, 'select key from plane_secrets where worker_id=$1', [
    workerId,
  ])) {
    claimEnvName(String(secret.key), 'secret')
  }
  for (const workflow of await rows(
    deps,
    'select binding from plane_workflows where worker_id=$1 and binding is not null',
    [workerId]
  )) {
    claimEnvName(String(workflow.binding), 'workflow')
  }

  const fp = sha256(
    JSON.stringify({
      bindings: body.bindings,
      vars: Object.keys(body.vars)
        .sort()
        .map((name) => [name, body.vars[name]]),
      crons: body.crons,
      compatibilityDate: body.compatibilityDate,
      compatibilityFlags: body.compatibilityFlags,
      quotas: body.quotas ?? null,
      queueConsumers,
      tailConsumers,
      streamingTailConsumers,
      versionMetadata: body.versionMetadata ?? null,
      observability: body.observability ?? null,
      cache: body.cache ?? null,
      jsonVars,
      assetsRouting: body.assetsRouting ?? null,
      assetsRunWorkerFirst: body.assetsRunWorkerFirst ?? [],
      exportedClassNames: body.exportedClassNames ?? [],
    })
  )
  const effectiveQuotas = body.quotas ?? VRT_DEFAULT_QUOTAS
  const input: VrtCreateVersionInput = {
    workerId,
    versionId: body.versionId,
    bundleSha256: body.bundleSha256,
    bundleKey: bundleKeyFor(body.bundleSha256),
    bundleBytes: actualBytes,
    mainModule: body.mainModule,
    modules: body.modules,
    compatibilityDate: body.compatibilityDate,
    compatibilityFlags: body.compatibilityFlags,
    crons: body.crons,
    quotas: effectiveQuotas,
    varValues: stringVars,
    bindingsFingerprint: fp,
    runtimeConfigDigest: fp,
    bindings: body.bindings as unknown as readonly VrtBindingRecord[],
    queueConsumers,
    tailConsumers: tailConsumers.length > 0 ? tailConsumers : undefined,
    streamingTailConsumers: streamingTailConsumers.length > 0 ? streamingTailConsumers : undefined,
    versionMetadata: body.versionMetadata ?? null,
    observability: body.observability ?? null,
    cache: body.cache ?? null,
    jsonVars: Object.keys(jsonVars).length > 0 ? jsonVars : null,
    assetsRouting: body.assetsRouting ?? null,
    assetsRunWorkerFirst: body.assetsRunWorkerFirst ?? [],
    exportedClassNames: body.exportedClassNames,
    createdById: 'plane-api',
  }
  return deps.store.createVersionWithBindings(input)
}

async function isWorkflowTarget(
  deps: AdminDeps,
  cell: string,
  targetWorkerId: string
): Promise<boolean> {
  const [row] = await rows(
    deps,
    'select 1 from plane_workflows where cluster_id=$1 and service_worker_id=$2 limit 1',
    [cell, targetWorkerId]
  )
  return Boolean(row)
}

async function isActiveTailTarget(
  deps: AdminDeps,
  cell: string,
  targetWorkerId: string
): Promise<boolean> {
  const [row] = await rows(
    deps,
    `select 1
       from plane_workers w
       join plane_versions v on v.worker_id=w.id and v.version_id=w.active_version_id
      where w.cluster_id=$1
        and ((v.row->'tailConsumers') @> to_jsonb($2::text)
          or (v.row->'streamingTailConsumers') @> to_jsonb($2::text))
      limit 1`,
    [cell, targetWorkerId]
  )
  return Boolean(row)
}

/** Activate a version and replace its render-input vars atomically. The
 * reference plane's `PlaneCellTx` exposes `applyVersionVars`; keep this cast
 * local so the portable VrtCellTx interface stays unchanged. */
interface ActivatableVersion {
  readonly versionId: string
  readonly varValues: Readonly<Record<string, string>>
  readonly bindings?: readonly {
    readonly name?: string
    readonly type?: string
    readonly resourceId?: string
  }[]
  readonly jsonVars?: Readonly<Record<string, unknown>> | null
  readonly versionMetadata?: string | null
  readonly queueConsumers?: readonly VrtQueueConsumerDraft[] | null
  readonly tailConsumers?: readonly string[] | null
  readonly streamingTailConsumers?: readonly string[] | null
}

async function activateVersionWithVars(
  deps: AdminDeps,
  cell: string,
  teamIdValue: string,
  workerIdToActivate: string,
  version: ActivatableVersion
): Promise<void> {
  await deps.store.runCellTransaction(cell, async (tx) => {
    const referenceTx = tx as unknown as {
      assertVersionReferences?: (
        teamId: string,
        workerIdToActivate: string,
        version: ActivatableVersion
      ) => Promise<void>
      applyVersionVars?: (workerId: string, vars: Readonly<Record<string, string>>) => Promise<void>
    }
    if (referenceTx.assertVersionReferences) {
      await referenceTx.assertVersionReferences(teamIdValue, workerIdToActivate, version)
    }
    await tx.activateVersion(workerIdToActivate, version.versionId)
    if (typeof referenceTx.applyVersionVars !== 'function') {
      throw new VrtControlError(501, 'store does not support version vars')
    }
    await referenceTx.applyVersionVars(workerIdToActivate, version.varValues ?? {})
  })
}

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
    await requireTeam(deps, body.teamId)
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
    const activeVersionId = (worker.active_version_id as string | null) ?? null
    const activeVersion = activeVersionId
      ? await deps.store.getVersionByVersionId(id, activeVersionId)
      : null
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
        jsonVars: activeVersion?.jsonVars ?? null,
        observability: activeVersion?.observability ?? null,
        cache: activeVersion?.cache ?? null,
        versionMetadata: activeVersion?.versionMetadata ?? null,
        tailConsumers: activeVersion?.tailConsumers ?? [],
        streamingTailConsumers: activeVersion?.streamingTailConsumers ?? [],
        queueConsumers: activeVersion?.queueConsumers ?? [],
        assetsRouting: activeVersion?.assetsRouting ?? null,
        assetsRunWorkerFirst: activeVersion?.assetsRunWorkerFirst ?? [],
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
    const version = versionId ? await deps.store.getVersionByVersionId(id, versionId) : null
    const classes = await rows(
      deps,
      `select class_name, unique_key, enable_sql, transfer_from_worker_id
         from plane_do_classes where worker_id=$1 order by class_name`,
      [id]
    )
    const bindings = (version?.bindings ?? []).filter((b) => b.type === 'DO')
    return c.json({
      data: {
        versionId,
        classes: classes.map((row) => ({
          className: String(row.class_name),
          uniqueKey: String(row.unique_key),
          enableSql: row.enable_sql === true,
          transferFromWorkerId: (row.transfer_from_worker_id as string | null) ?? null,
        })),
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
    if (body.status !== undefined && body.status !== 'ACTIVE') {
      if (await isActiveTailTarget(deps, cell, id)) {
        throw new VrtControlError(409, 'Worker is an active tail consumer')
      }
      if (await isWorkflowTarget(deps, cell, id)) {
        throw new VrtControlError(409, 'Worker is the target of a workflow binding')
      }
    }
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
    const id = workerId(team, name)
    if (await isActiveTailTarget(deps, cell, id)) {
      throw new VrtControlError(409, 'Worker is an active tail consumer')
    }
    if (await isWorkflowTarget(deps, cell, id)) {
      throw new VrtControlError(409, 'Worker is the target of a workflow binding')
    }
    const [transferSource] = await rows(
      deps,
      'select 1 from plane_do_classes where transfer_from_worker_id=$1 limit 1',
      [id]
    )
    if (transferSource) {
      throw new VrtControlError(409, 'Worker is a DO class transfer source')
    }
    const client = await deps.pool.connect()
    try {
      await client.query('begin')
      const deleted = await client.query(
        'delete from plane_workers where id=$1 and cluster_id=$2',
        [id, cell]
      )
      if (deleted.rowCount === 0) throw new VrtControlError(404, 'Worker not found')
      // Ops for this worker (WF_*, worker-scoped) key on the deterministic
      // `team:name` id — leave them and a same-named worker inherits the
      // dead worker's queued/resulted ops.
      await client.query('delete from plane_cell_ops where worker_id=$1', [id])
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
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
    const { version, created } = await createVersion(deps, id, body)
    return c.json({ data: { version, created } }, created ? 201 : 200)
  })

  // One-call deploy: create the version, optionally activate it, optionally
  // publish the cell. The bundle bytes are still uploaded first via
  // `PUT /cells/{cell}/bundles/{sha256}`; this endpoint validates that upload.
  app.post('/api/v1/cells/:cellId/teams/:teamId/workers/:name/deploy', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows(
      deps,
      'select id from plane_workers where id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    const body = parse(deployBody, await readJson(c))
    if (body.publish && !deps.signing) {
      throw new VrtControlError(501, 'Signing is not configured')
    }
    const { version, created } = await createVersion(deps, id, body)
    let activated = false
    let revision: number | null = null
    if (body.activate) {
      await activateVersionWithVars(deps, cell, team, id, version)
      activated = true
    }
    if (body.publish) {
      revision = await publishCell(deps.store, {
        cellId: cell,
        signing: deps.signing!,
        cause: 'DEPLOY',
        workerId: id,
        versionId: version.versionId,
      })
    }
    return c.json({ data: { version, created, activated, revision } }, created ? 201 : 200)
  })

  app.post(
    '/api/v1/cells/:cellId/teams/:teamId/workers/:name/versions/:versionId/activate',
    async (c) => {
      const { cellId: cell, teamId: team, name, versionId } = c.req.param()
      const id = workerId(team, name)
      const [worker] = await rows(
        deps,
        'select id from plane_workers where id=$1 and cluster_id=$2',
        [id, cell]
      )
      if (!worker) throw new VrtControlError(404, 'Worker not found')
      const version = await deps.store.getVersionByVersionId(id, versionId)
      if (!version) throw new VrtControlError(404, 'Version not found')
      await activateVersionWithVars(deps, cell, team, id, version)
      return c.json({ data: { workerId: id, versionId, activated: true } })
    }
  )

  /**
   * Source-level deploy for browser/console clients: accepts raw module
   * sources, builds the canonical runtime bundle server-side, stores it and
   * runs the identical create/activate/publish pipeline as /deploy. Keeping
   * bundling server-side means browser clients never need node primitives,
   * and the deploy boundary validates the same way for every client.
   */
  app.post('/api/v1/cells/:cellId/teams/:teamId/workers/:name/deploy-source', async (c) => {
    const { cellId: cell, teamId: team, name } = c.req.param()
    const id = workerId(team, name)
    const [worker] = await rows(
      deps,
      'select id from plane_workers where id=$1 and cluster_id=$2',
      [id, cell]
    )
    if (!worker) throw new VrtControlError(404, 'Worker not found')
    const body = parse(deploySourceBody, await readJson(c))
    if (body.publish && !deps.signing) {
      throw new VrtControlError(501, 'Signing is not configured')
    }
    const bundle = buildRuntimeBundle({
      mainModule: body.mainModule,
      modules: body.modules,
      compatibilityDate: body.compatibilityDate,
      compatibilityFlags: body.compatibilityFlags,
    })
    const bytes = new Uint8Array(bundle.bytes)
    await deps.store.registerBundleObject({
      digest: bundle.digest,
      bytes: bytes.byteLength,
      createdById: 'plane-api',
    })
    await deps.bundleStore.put(bundleKeyFor(bundle.digest), bytes)
    const {
      modules: sourceModules,
      activate,
      publish,
      versionId,
      ...rest
    } = body
    const versionInput: VersionBody = {
      ...rest,
      versionId: versionId ?? `v-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      bundleSha256: bundle.digest,
      bundleBytes: bytes.byteLength,
      modules: sourceModules.map((m) => m.name),
    }
    const { version, created } = await createVersion(deps, id, versionInput)
    let activated = false
    let revision: number | null = null
    if (activate) {
      await activateVersionWithVars(deps, cell, team, id, version)
      activated = true
    }
    if (publish) {
      revision = await publishCell(deps.store, {
        cellId: cell,
        signing: deps.signing!,
        cause: 'DEPLOY',
        workerId: id,
        versionId: version.versionId,
      })
    }
    return c.json(
      { data: { version, created, activated, revision, bundleDigest: bundle.digest } },
      created ? 201 : 200
    )
  })
}

