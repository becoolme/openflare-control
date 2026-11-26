/**
 * Postgres-backed reference store for the OSS plane.
 *
 * Scope: the cell channel (desired/ack/bundles/render-inputs) and the
 * minimal deploy path. Methods the single-owner plane does not need yet
 * (team quotas, DO/workflow management, assets manifests, auto-rollback
 * audit) are intentionally unimplemented and answer 501 through the proxy
 * below instead of pretending to work.
 */
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  VrtControlError,
  type VrtAckStatus,
  type VrtAckTenantFailure,
  type VrtBindingRecord,
  type VrtAckWriteResult,
  type VrtCellCapabilities,
  type VrtCellTx,
  type VrtCellWorkerView,
  type VrtControlStore,
  type VrtCreateVersionInput,
  type VrtStoreHostname,
  type VrtStorePublication,
  type VrtStorePublicationDetail,
  type VrtStoreVersion,
  type VrtStoreWorker,
} from 'openflare-control'

type Row = Record<string, unknown>

const mapWorker = (r: Row): VrtStoreWorker => ({
  id: r.id as string,
  name: r.name as string,
  teamId: r.team_id as string,
  clusterId: r.cluster_id as string,
  runtime: r.runtime as string,
  status: r.status as string,
  activeVrtVersionId: (r.active_version_id as string | null) ?? null,
  entrypoint: r.entrypoint as string,
  compatibilityDate: r.compatibility_date as string,
  statusReason: (r.status_reason as string | null) ?? null,
})

const mapVersion = (r: Row): VrtStoreVersion => {
  const doc = r.row as VrtStoreVersion
  return {
    ...doc,
    versionId: r.version_id as string,
    workerId: r.worker_id as string,
    status: r.status as VrtStoreVersion['status'],
    statusReason: (r.status_reason as string | null) ?? doc.statusReason,
    createdAt: r.created_at as Date,
  }
}

const mapPublication = (r: Row): VrtStorePublicationDetail => ({
  id: r.id as string,
  cellId: r.cell_id as string,
  revision: Number(r.revision),
  payloadDigest: r.payload_digest as string,
  envelopeDigest: r.envelope_digest as string,
  clusterId: r.cell_id as string,
  envelope: r.envelope,
  publishedById: (r.published_by_id as string | null) ?? null,
  publishedBySource: (r.published_by_source as 'USER' | 'SYSTEM_RENEWAL') ?? 'USER',
  issuedAt: r.issued_at as Date,
  expiresAt: r.expires_at as Date,
  workerId: (r.worker_id as string | null) ?? null,
  versionId: (r.version_id as string | null) ?? null,
  cause: r.cause as string,
  ackStatus: r.ack_status as VrtStorePublicationDetail['ackStatus'],
  ackedAt: (r.acked_at as Date | null) ?? null,
  ackRevision:
    r.ack_revision === null || r.ack_revision === undefined ? null : Number(r.ack_revision),
  ackEnvelopeDigest: (r.ack_envelope_digest as string | null) ?? null,
  ackReason: (r.ack_reason as string | null) ?? null,
  ackTenantFailures: (r.ack_tenant_failures as VrtAckTenantFailure[] | null) ?? null,
})

export class PlaneStore {
  constructor(readonly pool: Pool) {}

  private async rows(sql: string, params: unknown[] = [], client: Pool | PoolClient = this.pool) {
    const res = await client.query(sql, params)
    return res.rows as Row[]
  }

  async getWorker(workerId: string, teamId: string): Promise<VrtStoreWorker | null> {
    const [r] = await this.rows('select * from plane_workers where id=$1 and team_id=$2', [
      workerId,
      teamId,
    ])
    return r ? mapWorker(r) : null
  }

  async findWorkerById(workerId: string): Promise<VrtStoreWorker | null> {
    const [r] = await this.rows('select * from plane_workers where id=$1', [workerId])
    return r ? mapWorker(r) : null
  }

  async findWorkerByName(
    teamId: string,
    clusterId: string,
    name: string
  ): Promise<VrtStoreWorker | null> {
    const [r] = await this.rows(
      'select * from plane_workers where team_id=$1 and cluster_id=$2 and name=$3',
      [teamId, clusterId, name]
    )
    return r ? mapWorker(r) : null
  }

  async findDatabaseTeamId(): Promise<string | null> {
    return null
  }
  async findVrtD1DatabaseScope(): Promise<{ teamId: string; clusterId: string } | null> {
    return null
  }
  async findVrtQueueScope(): Promise<{ teamId: string; clusterId: string } | null> {
    return null
  }
  async listDoClasses(): Promise<readonly never[]> {
    return []
  }
  async listWorkflowDeclarations(): Promise<readonly never[]> {
    return []
  }
  async countVersionQueueConsumers(): Promise<number> {
    return 0
  }

  async getVersionByVersionId(
    workerId: string,
    versionId: string
  ): Promise<VrtStoreVersion | null> {
    const [r] = await this.rows(
      'select * from plane_versions where worker_id=$1 and version_id=$2',
      [workerId, versionId]
    )
    return r ? mapVersion(r) : null
  }

  async findVersionByContent(
    workerId: string,
    bundleSha256: string,
    bindingsFingerprint: string
  ): Promise<VrtStoreVersion | null> {
    const [r] = await this.rows(
      'select * from plane_versions where worker_id=$1 and bundle_sha256=$2 and bindings_fingerprint=$3',
      [workerId, bundleSha256, bindingsFingerprint]
    )
    return r ? mapVersion(r) : null
  }

  async listVersions(
    workerId: string,
    opts: { limit?: number; alwaysIncludeVersionId?: string | null } = {}
  ): Promise<readonly VrtStoreVersion[]> {
    const limit = opts.limit ?? 20
    const rows = await this.rows(
      `select * from plane_versions where worker_id=$1 order by created_at desc, version_id desc limit $2`,
      [workerId, limit]
    )
    const list = rows.map(mapVersion)
    const always = opts.alwaysIncludeVersionId
    if (always && !list.some((v) => v.versionId === always)) {
      const extra = await this.getVersionByVersionId(workerId, always)
      if (extra) list.push(extra)
    }
    return list
  }

  async listVars(workerId: string): Promise<readonly { key: string; value: string }[]> {
    const rows = await this.rows('select key, value from plane_vars where worker_id=$1', [workerId])
    return rows.map((r) => ({ key: r.key as string, value: r.value as string }))
  }

  async listSecretKeys(workerId: string): Promise<readonly string[]> {
    const rows = await this.rows('select key from plane_secrets where worker_id=$1', [workerId])
    return rows.map((r) => r.key as string)
  }

  async listHostnames(workerId: string): Promise<readonly VrtStoreHostname[]> {
    const rows = await this.rows('select * from plane_hostnames where worker_id=$1', [workerId])
    return rows.map((r) => ({
      id: r.id as string,
      hostname: r.hostname as string,
      status: r.status as VrtStoreHostname['status'],
      kind: r.kind as VrtStoreHostname['kind'],
    }))
  }

  async isHostnameTaken(hostname: string, opts: { excludeWorkerId?: string } = {}) {
    const rows = await this.rows(
      'select 1 from plane_hostnames where hostname=$1 and ($2::text is null or worker_id <> $2)',
      [hostname, opts.excludeWorkerId ?? null]
    )
    return rows.length > 0
  }

  async setVersionExportedClassNames(): Promise<void> {
    return
  }

  async createVersionWithBindings(
    input: VrtCreateVersionInput
  ): Promise<{ version: VrtStoreVersion; created: boolean }> {
    const doc: VrtStoreVersion = {
      id: randomUUID(),
      workerId: input.workerId,
      versionId: input.versionId,
      bundleSha256: input.bundleSha256,
      bundleKey: input.bundleKey,
      bundleBytes: input.bundleBytes,
      mainModule: input.mainModule,
      modules: input.modules,
      compatibilityDate: input.compatibilityDate,
      compatibilityFlags: input.compatibilityFlags,
      crons: input.crons,
      quotas: input.quotas,
      varValues: input.varValues,
      bindings: input.bindings,
      queueConsumers: input.queueConsumers ?? [],
      tailConsumers: input.tailConsumers ?? null,
      streamingTailConsumers: input.streamingTailConsumers ?? null,
      versionMetadata: input.versionMetadata ?? null,
      observability: input.observability ?? null,
      jsonVars: input.jsonVars ?? null,
      bindingsFingerprint: input.bindingsFingerprint,
      runtimeConfigDigest: input.runtimeConfigDigest,
      assetsRouting: input.assetsRouting ?? null,
      assetsRunWorkerFirst: input.assetsRunWorkerFirst ?? [],
      exportedClassNames: input.exportedClassNames ?? null,
      status: 'UPLOADED',
      statusReason: null,
      createdAt: new Date(),
    } as unknown as VrtStoreVersion
    const insert = await this.pool.query(
      `insert into plane_versions (version_id, worker_id, bundle_sha256, bindings_fingerprint, status, row)
       values ($1,$2,$3,$4,'UPLOADED',$5)
       on conflict (worker_id, bundle_sha256, bindings_fingerprint) do nothing
       returning *`,
      [input.versionId, input.workerId, input.bundleSha256, input.bindingsFingerprint, doc]
    )
    if (insert.rows.length > 0) {
      return { version: mapVersion(insert.rows[0] as Row), created: true }
    }
    const existing = await this.findVersionByContent(
      input.workerId,
      input.bundleSha256,
      input.bindingsFingerprint
    )
    if (!existing) throw new VrtControlError(500, 'version insert raced with no row')
    return { version: existing, created: false }
  }

  async registerBundleObject(input: {
    digest: string
    bytes: number
    createdById?: string | null
  }): Promise<void> {
    await this.pool.query(
      `insert into plane_bundle_objects (digest, bytes) values ($1,$2)
       on conflict (digest) do update set last_referenced_at = now()`,
      [input.digest, input.bytes]
    )
  }

  async markVersionFailed(versionId: string, reason: string): Promise<void> {
    await this.pool.query(
      `update plane_versions set status='FAILED', status_reason=$2
       where version_id=$1 and status in ('UPLOADED','FAILED')`,
      [versionId, reason.slice(0, 256)]
    )
  }

  async markWorkersDeployFailed(): Promise<readonly string[]> {
    return []
  }
  async recoverCellDeployFailures(): Promise<readonly string[]> {
    return []
  }
  async recordAutoRollback(): Promise<void> {
    return
  }
  async workerCellApplyRecoveredAtRevision(): Promise<boolean> {
    return false
  }
  async latestAutoRollbackDecision(): Promise<null> {
    return null
  }

  async latestAppliedPublicationBelow(
    cellId: string,
    belowRevision: number
  ): Promise<VrtStorePublicationDetail | null> {
    const [r] = await this.rows(
      `select * from plane_publications
       where cell_id=$1 and revision < $2 and ack_status in ('APPLIED','REJECTED')
       order by revision desc limit 1`,
      [cellId, belowRevision]
    )
    return r ? mapPublication(r) : null
  }

  async latestPublication(cellId: string): Promise<VrtStorePublicationDetail | null> {
    const [r] = await this.rows(
      'select * from plane_publications where cell_id=$1 order by revision desc limit 1',
      [cellId]
    )
    return r ? mapPublication(r) : null
  }

  async recentPublications(
    cellId: string,
    limit: number
  ): Promise<readonly VrtStorePublicationDetail[]> {
    const rows = await this.rows(
      'select * from plane_publications where cell_id=$1 order by revision desc limit $2',
      [cellId, Math.max(1, limit)]
    )
    return rows.map(mapPublication)
  }

  async findPublication(
    cellId: string,
    revision: number
  ): Promise<VrtStorePublicationDetail | null> {
    const [r] = await this.rows(
      'select * from plane_publications where cell_id=$1 and revision=$2',
      [cellId, revision]
    )
    return r ? mapPublication(r) : null
  }

  async recordPublicationAck(
    cellId: string,
    revision: number,
    ack: {
      status: VrtAckStatus
      ackedAt: Date
      envelopeDigest: string
      reason?: string | null
      tenantFailures?: readonly VrtAckTenantFailure[]
    }
  ): Promise<VrtAckWriteResult> {
    // Conditional UPDATE so two conflicting acks can never both win: the
    // terminal verdict is the one that flipped the row out of PENDING/PARTIAL.
    const updated = await this.pool.query(
      `update plane_publications set
         ack_status=$3, acked_at=$4, ack_revision=$2, ack_envelope_digest=$5, ack_reason=$6,
         ack_tenant_failures = case when $7::jsonb is null then ack_tenant_failures else $7::jsonb end
       where cell_id=$1 and revision=$2 and ack_status in ('PENDING','PARTIAL')`,
      [
        cellId,
        revision,
        ack.status,
        ack.ackedAt,
        ack.envelopeDigest,
        ack.reason ?? null,
        ack.tenantFailures === undefined ? null : JSON.stringify(ack.tenantFailures),
      ]
    )
    if (updated.rowCount === 1) return 'written'
    const current = await this.findPublication(cellId, revision)
    if (!current) return 'missing'
    return current.ackStatus === ack.status ? 'idempotent' : 'terminal'
  }

  async countServiceDependents(): Promise<number> {
    return 0
  }
  async countCrossWorkerDependents() {
    return { service: 0, durableObject: 0, workflow: 0 }
  }
  async countWfDependents(): Promise<number> {
    return 0
  }
  async claimAssetsManifest(input: {
    digest: string
    teamId: string
    workerId: string
    objects?: readonly { digest: string; bytes: number }[]
    totalBytes?: number
    quotaBytes?: number
    legacyManifestBytes?: number
  }): Promise<void> {
    const total =
      input.totalBytes ??
      input.objects?.reduce((sum, object) => sum + object.bytes, 0) ??
      input.legacyManifestBytes ??
      0
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `plane-assets:${input.teamId}`,
      ])
      const used = await client.query(
        `select coalesce(sum(total_bytes),0)::bigint as n
           from plane_asset_manifests where team_id=$1 and digest<>$2`,
        [input.teamId, input.digest]
      )
      if (
        input.quotaBytes !== undefined &&
        Number(used.rows[0]?.n ?? 0) + total > input.quotaBytes
      ) {
        throw new VrtControlError(409, 'Asset quota exceeded')
      }
      await client.query(
        `insert into plane_asset_manifests (team_id, digest, total_bytes, objects)
         values ($1,$2,$3,$4)
         on conflict (team_id, digest) do update set
           total_bytes=excluded.total_bytes, objects=excluded.objects`,
        [input.teamId, input.digest, total, JSON.stringify(input.objects ?? [])]
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }
  async isAssetsManifestClaimed(digest: string, teamId: string): Promise<boolean> {
    const rows = await this.rows(
      'select 1 from plane_asset_manifests where team_id=$1 and digest=$2 limit 1',
      [teamId, digest]
    )
    return rows.length > 0
  }
  async latestPublicationForVersion(): Promise<null> {
    return null
  }

  async runCellTransaction<T>(clusterId: string, fn: (tx: VrtCellTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query(
        'insert into plane_cells (cell_id, cluster_id) values ($1,$1) on conflict do nothing',
        [clusterId]
      )
      await client.query('select 1 from plane_cells where cluster_id=$1 for update', [clusterId])
      const out = await fn(new PlaneCellTx(client, clusterId) as unknown as VrtCellTx)
      await client.query('commit')
      return out
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async raiseCellRevisionFloor(
    clusterId: string,
    reported: number,
    opts?: { proven?: boolean }
  ): Promise<'raised' | 'ok' | 'rejected'> {
    if (!Number.isSafeInteger(reported) || reported < 0) return 'rejected'
    const [row] = await this.rows('select revision from plane_cells where cluster_id=$1', [
      clusterId,
    ])
    if (row && reported <= Number(row.revision)) return 'ok'
    return this.runCellTransaction(clusterId, (tx) => tx.raiseRevisionFloor(reported, opts))
  }

  async cellCapabilities(clusterId: string): Promise<VrtCellCapabilities | null> {
    const [r] = await this.rows('select capabilities from plane_cells where cluster_id=$1', [
      clusterId,
    ])
    return (r?.capabilities as VrtCellCapabilities | null) ?? null
  }

  async recordCellCapabilities(clusterId: string, caps: VrtCellCapabilities): Promise<void> {
    await this.runCellTransaction(clusterId, (tx) => tx.setCapabilities(caps))
  }

  async pruneTerminalPublications(opts: {
    keepPerCell: number
    batchSize: number
    maxRows: number
    deadlineMs: number
  }): Promise<{ deletedRows: number; truncated: boolean }> {
    const deadline = Date.now() + opts.deadlineMs
    let deletedRows = 0
    let truncated = false
    for (;;) {
      if (deletedRows >= opts.maxRows || Date.now() > deadline) {
        truncated = true
        break
      }
      const ids = await this.rows(
        `select id from (
           select id, ack_status, row_number() over (partition by cell_id order by revision desc) as rn
           from plane_publications
         ) ranked
         where ack_status in ('APPLIED','REJECTED') and rn > $1 limit $2`,
        [opts.keepPerCell, opts.batchSize]
      )
      if (ids.length === 0) break
      const res = await this.pool.query(
        'delete from plane_publications where id = any($1::uuid[])',
        [ids.map((r) => r.id as string)]
      )
      deletedRows += res.rowCount ?? 0
      if (ids.length < opts.batchSize) break
    }
    return { deletedRows, truncated }
  }

  async countCellStates(): Promise<number> {
    const [r] = await this.rows('select count(*)::int as n from plane_cells')
    return Number(r?.n ?? 0)
  }
}

class PlaneCellTx {
  readonly cellId: string

  constructor(
    private readonly client: PoolClient,
    readonly clusterId: string
  ) {
    this.cellId = clusterId
  }

  private async rows(sql: string, params: unknown[] = []): Promise<Row[]> {
    const res = await this.client.query(sql, params)
    return res.rows as Row[]
  }

  async lockCell(): Promise<boolean> {
    const rows = await this.rows('select 1 from plane_cells where cluster_id=$1 for update', [
      this.clusterId,
    ])
    return rows.length > 0
  }

  async allocateRevision(): Promise<number> {
    const [r] = await this.rows(
      'update plane_cells set revision = revision + 1 where cluster_id=$1 returning revision',
      [this.clusterId]
    )
    if (!r) throw new VrtControlError(500, 'cell row missing')
    return Number(r.revision)
  }

  async ackD1Op(input: {
    seq: number
    status: string
    result: unknown
    error: string | null
  }): Promise<{ databaseId: string; kind: string; payload: unknown } | null> {
    const [r] = await this.rows(
      `update plane_d1_ops set status=$1, result=$2::jsonb, error=$3
        where cell_id=$4 and seq=$5 and status='PENDING'
        returning database_id, kind, payload`,
      [input.status, input.result ?? null, input.error, this.clusterId, input.seq]
    )
    if (!r) return null
    return {
      databaseId: String(r.database_id),
      kind: String(r.kind),
      payload: r.payload,
    }
  }

  async applyD1Writer(input: {
    databaseId: string
    epoch: number
    writerAddr?: string | null
    lsn?: number | null
  }): Promise<boolean> {
    const rows = await this.rows(
      `update plane_d1_databases
          set writer_epoch=$2,
              writer_addr=coalesce($3, writer_addr),
              writer_lsn=coalesce($4, writer_lsn),
              writer_updated_at=now()
        where cluster_id=$1 and database_id=$5 and writer_epoch < $2
        returning database_id`,
      [this.clusterId, input.epoch, input.writerAddr ?? null, input.lsn ?? null, input.databaseId]
    )
    return rows.length > 0
  }

  async flagshipApps(): Promise<readonly { tenantId: string; appId: string; config: string }[]> {
    return (
      await this.rows(
        `select a.team_id, a.app_id, a.config
         from plane_flagship_apps a
        where a.team_id in (
          select distinct team_id from plane_workers
           where cluster_id=$1 and runtime='VRT'
        )
        order by a.team_id, a.app_id`,
        [this.clusterId]
      )
    ).map((row) => ({
      tenantId: String(row.team_id),
      appId: String(row.app_id),
      config: String(row.config),
    }))
  }

  async activateVersion(workerId: string, versionId: string): Promise<void> {
    await this.client.query('update plane_workers set active_version_id=$2 where id=$1', [
      workerId,
      versionId,
    ])
    await this.client.query(
      `update plane_versions set status='ACTIVE' where worker_id=$1 and version_id=$2`,
      [workerId, versionId]
    )
  }

  /** Reference-plane-only: revalidate queue/tail references against the
   * current rows while holding share locks, so a concurrent delete/suspend
   * cannot race activation. Kept off VrtCellTx (reference-only hardening). */
  async assertVersionReferences(
    teamId: string,
    workerIdToActivate: string,
    version: {
      readonly bindings?: readonly {
        readonly name?: string
        readonly type?: string
        readonly resourceId?: string
      }[]
      readonly varValues?: Readonly<Record<string, string>>
      readonly jsonVars?: Readonly<Record<string, unknown>> | null
      readonly versionMetadata?: string | null
      readonly queueConsumers?:
        | readonly {
            readonly queueId: string
            readonly queueName: string
            readonly deadLetterQueueId: string | null
          }[]
        | null
      readonly tailConsumers?: readonly string[] | null
      readonly streamingTailConsumers?: readonly string[] | null
    }
  ): Promise<void> {
    for (const consumer of version.queueConsumers ?? []) {
      const [queue] = await this.rows(
        `select name from plane_queues
          where queue_id=$1 and team_id=$2 and cluster_id=$3 for share`,
        [consumer.queueId, teamId, this.clusterId]
      )
      if (!queue) throw new VrtControlError(409, 'Queue consumer target not found')
      if (String(queue.name) !== consumer.queueName) {
        throw new VrtControlError(409, 'Queue consumer name does not match the target queue')
      }
      if (consumer.deadLetterQueueId !== null) {
        const [dlq] = await this.rows(
          `select 1 from plane_queues
            where queue_id=$1 and team_id=$2 and cluster_id=$3 for share`,
          [consumer.deadLetterQueueId, teamId, this.clusterId]
        )
        if (!dlq) throw new VrtControlError(409, 'Dead-letter queue not found')
      }
    }
    const versionNames = new Set<string>()
    for (const binding of version.bindings ?? []) {
      if (typeof binding.name === 'string') versionNames.add(binding.name)
    }
    for (const name of Object.keys(version.jsonVars ?? {})) versionNames.add(name)
    for (const name of Object.keys(version.varValues ?? {})) versionNames.add(name)
    if (version.versionMetadata) versionNames.add(version.versionMetadata)
    const workflows = await this.rows(
      `select binding from plane_workflows where worker_id=$1 and binding is not null`,
      [workerIdToActivate]
    )
    for (const workflow of workflows) {
      if (versionNames.has(String(workflow.binding))) {
        throw new VrtControlError(
          409,
          `Workflow binding "${String(workflow.binding)}" collides with the activated version`
        )
      }
    }

    for (const binding of version.bindings ?? []) {
      if (binding.type === 'FLAGSHIP' && typeof binding.resourceId === 'string') {
        const [app] = await this.rows(
          `select 1 from plane_flagship_apps
            where team_id=$1 and app_id=$2 for share`,
          [teamId, binding.resourceId]
        )
        if (!app) throw new VrtControlError(409, 'Flagship app is no longer declared')
        continue
      }
      if (binding.type !== 'DO' || typeof binding.resourceId !== 'string') continue
      const sep = binding.resourceId.lastIndexOf(':')
      const declaringId = sep === -1 ? '' : binding.resourceId.slice(0, sep)
      const className = sep === -1 ? '' : binding.resourceId.slice(sep + 1)
      const [declaringWorker] = await this.rows(
        `select id from plane_workers
          where id=$1 and team_id=$2 and cluster_id=$3 for share`,
        [declaringId, teamId, this.clusterId]
      )
      if (!declaringWorker) {
        throw new VrtControlError(409, 'DO binding declaring worker is not in this team/cell')
      }
      const [declared] = await this.rows(
        `select 1 from plane_do_classes
          where worker_id=$1 and class_name=$2 for share`,
        [declaringId, className]
      )
      if (!declared) {
        throw new VrtControlError(409, `Durable Object class is not declared: ${className}`)
      }
    }

    const tailIds = [...(version.tailConsumers ?? []), ...(version.streamingTailConsumers ?? [])]
    if (tailIds.length === 0) return
    const found = await this.rows(
      `select id from plane_workers
        where id = any($1::text[]) and team_id=$2 and cluster_id=$3
          and runtime='VRT' and status='ACTIVE' and active_version_id is not null
        for share`,
      [tailIds, teamId, this.clusterId]
    )
    if (found.length !== tailIds.length) {
      throw new VrtControlError(409, 'Tail consumer target is not an active worker')
    }
  }

  /** Reference-plane-only: replace the worker's render-input vars with the
   * activated version's values inside the same cell transaction. Kept off
   * VrtCellTx so other store implementations are not forced to grow it. */
  async applyVersionVars(workerId: string, vars: Readonly<Record<string, string>>): Promise<void> {
    await this.client.query('delete from plane_vars where worker_id=$1', [workerId])
    for (const [key, value] of Object.entries(vars)) {
      await this.client.query(
        `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
         on conflict (worker_id, key) do update set value=excluded.value`,
        [workerId, key, value]
      )
    }
  }

  async applyDoClasses(): Promise<readonly never[]> {
    return []
  }
  async applyWorkflowDeclarations(): Promise<readonly never[]> {
    return []
  }
  async deleteWorker(): Promise<void> {
    return
  }
  async pendingDoTombstones(): Promise<readonly never[]> {
    return []
  }
  async assertServiceTargetsInTx(): Promise<void> {
    return
  }
  async tenantServingWorkers(): Promise<readonly never[]> {
    return []
  }
  async countServiceDependents(): Promise<number> {
    return 0
  }
  async countCrossWorkerDependents() {
    return { service: 0, durableObject: 0, workflow: 0 }
  }
  async readWorkerForDelete(): Promise<null> {
    return null
  }
  async readWorkerState(): Promise<null> {
    return null
  }
  async clearCellApplyMark(): Promise<void> {
    return
  }
  async markVersionApplyFailed(): Promise<void> {
    return
  }
  async activateVersionForAutoRollback(): Promise<void> {
    return
  }
  async countWfDependents(): Promise<number> {
    return 0
  }

  async insertHostname(input: {
    hostname: string
    workerId: string
    status: VrtStoreHostname['status']
    kind: VrtStoreHostname['kind']
  }): Promise<VrtStoreHostname> {
    const id = randomUUID()
    await this.client.query(
      'insert into plane_hostnames (id, hostname, worker_id, status, kind) values ($1,$2,$3,$4,$5)',
      [id, input.hostname, input.workerId, input.status, input.kind]
    )
    return { id, hostname: input.hostname, status: input.status, kind: input.kind }
  }

  async promoteHostnameToManaged(
    hostname: string,
    workerId: string
  ): Promise<VrtStoreHostname | null> {
    await this.client.query(
      `update plane_hostnames set kind='MANAGED', status='VERIFIED' where hostname=$1 and worker_id=$2`,
      [hostname, workerId]
    )
    const [r] = await this.rows(
      'select * from plane_hostnames where hostname=$1 and worker_id=$2',
      [hostname, workerId]
    )
    return r
      ? {
          id: r.id as string,
          hostname: r.hostname as string,
          status: r.status as VrtStoreHostname['status'],
          kind: r.kind as VrtStoreHostname['kind'],
        }
      : null
  }

  async deleteHostname(hostname: string, workerId: string): Promise<boolean> {
    const res = await this.client.query(
      'delete from plane_hostnames where hostname=$1 and worker_id=$2',
      [hostname, workerId]
    )
    return (res.rowCount ?? 0) > 0
  }

  async latestPublication(): Promise<VrtStorePublicationDetail | null> {
    const [r] = await this.rows(
      'select * from plane_publications where cell_id=$1 order by revision desc limit 1',
      [this.cellId]
    )
    return r ? mapPublication(r) : null
  }

  async raiseRevisionFloor(
    reported: number,
    opts?: { proven?: boolean }
  ): Promise<'raised' | 'ok' | 'rejected'> {
    const [row] = await this.rows(
      'select revision from plane_cells where cluster_id=$1 for update',
      [this.clusterId]
    )
    const current = Number(row?.revision ?? 0)
    if (!Number.isSafeInteger(reported) || reported <= current) return 'ok'
    // Issue #63: a verified fence attestation may jump past the bounded delta
    // (notably after a control-plane restore). Unproven reports stay capped.
    if (!opts?.proven && reported - current > 1000) return 'rejected'
    await this.client.query('update plane_cells set revision=$2 where cluster_id=$1', [
      this.clusterId,
      reported,
    ])
    return 'raised'
  }

  async setCapabilities(caps: VrtCellCapabilities): Promise<void> {
    await this.client.query('update plane_cells set capabilities=$2 where cluster_id=$1', [
      this.clusterId,
      caps,
    ])
  }

  async cellView(): Promise<readonly VrtCellWorkerView[]> {
    const rows = await this.rows(
      `select w.*, v.row as version_row
       from plane_workers w
       join plane_versions v on v.worker_id = w.id and v.version_id = w.active_version_id
       where w.cluster_id=$1 and w.runtime='VRT' and w.status='ACTIVE'`,
      [this.clusterId]
    )
    const d1Writers = new Map<string, { epoch: number; addr: string | null }>()
    const d1Rows = await this.rows(
      `select database_id, writer_epoch, writer_addr from plane_d1_databases where cluster_id=$1`,
      [this.clusterId]
    )
    for (const row of d1Rows) {
      d1Writers.set(String(row.database_id), {
        epoch: Number(row.writer_epoch ?? 1),
        addr: row.writer_addr == null ? null : String(row.writer_addr),
      })
    }
    const hydrateD1 = (bindings: readonly VrtBindingRecord[]): VrtBindingRecord[] =>
      bindings.map((binding) => {
        if (binding.type !== 'D1') return binding
        const writer = d1Writers.get(binding.resourceId)
        if (!writer) return binding
        return {
          ...binding,
          epoch: writer.epoch,
          ...(writer.addr ? { writerAddr: writer.addr } : {}),
        }
      })
    const out: VrtCellWorkerView[] = []
    for (const r of rows) {
      const version = r.version_row as VrtStoreVersion
      const hostnames = await this.rows(
        `select hostname from plane_hostnames where worker_id=$1 and status='VERIFIED'`,
        [r.id as string]
      )
      const workflows = await this.rows(
        `select name, binding, class_name, unique_key, limits_steps, service_worker_id,
                success_retention_ms, error_retention_ms, concurrency_limit
           from plane_workflows
          where worker_id=$1 and binding is not null and unique_key is not null
          order by name`,
        [r.id as string]
      )
      const doClasses = await this.rows(
        `select class_name, unique_key, enable_sql, transfer_from_worker_id
           from plane_do_classes
          where worker_id=$1 order by class_name`,
        [r.id as string]
      )
      out.push({
        workerId: r.id as string,
        teamId: r.team_id as string,
        name: r.name as string,
        versionId: r.active_version_id as string,
        artifactDigest: version.bundleSha256,
        compatibilityDate: version.compatibilityDate,
        compatibilityFlags: version.compatibilityFlags,
        bindings: hydrateD1(version.bindings),
        hostnames: hostnames.map((h) => h.hostname as string),
        crons: version.crons,
        queueConsumers: version.queueConsumers ?? [],
        workflows: workflows.map((w) => ({
          name: String(w.name),
          binding: String(w.binding),
          className: String(w.class_name),
          uniqueKey: String(w.unique_key),
          limitsSteps: w.limits_steps == null ? null : Number(w.limits_steps),
          successRetentionMs:
            w.success_retention_ms == null ? null : Number(w.success_retention_ms),
          errorRetentionMs: w.error_retention_ms == null ? null : Number(w.error_retention_ms),
          concurrencyLimit: w.concurrency_limit == null ? null : Number(w.concurrency_limit),
          serviceWorkerId: (w.service_worker_id as string | null) ?? null,
        })),
        durableObjectClasses: doClasses.map((c) => ({
          className: String(c.class_name),
          uniqueKey: String(c.unique_key),
          enableSql: c.enable_sql === true,
          ...(c.transfer_from_worker_id
            ? { transferFromWorkerId: String(c.transfer_from_worker_id) }
            : {}),
        })),
        tailConsumers: version.tailConsumers ?? [],
        streamingTailConsumers: version.streamingTailConsumers ?? [],
        versionMetadata: version.versionMetadata ?? null,
        observability: version.observability ?? null,
        jsonVars: version.jsonVars ?? null,
        quotas: version.quotas,
        assetsRouting: version.assetsRouting ?? null,
        assetsRunWorkerFirst: version.assetsRunWorkerFirst ?? [],
        changedAt:
          version.createdAt instanceof Date ? version.createdAt : new Date(version.createdAt),
      } as VrtCellWorkerView)
    }
    return out
  }

  async createPublication(input: {
    cause: string
    workerId?: string | null
    versionId?: string
    publishedById: string | null
    publishedBySource?: 'USER' | 'SYSTEM_RENEWAL'
    revision: number
    envelope: Record<string, unknown>
    payloadDigest: string
    envelopeDigest: string
    issuedAt: Date
    expiresAt: Date
  }): Promise<VrtStorePublication> {
    const [r] = await this.rows(
      `insert into plane_publications
        (cell_id, revision, envelope, payload_digest, envelope_digest, cause, worker_id, version_id,
         published_by_id, published_by_source, issued_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        this.cellId,
        input.revision,
        JSON.stringify(input.envelope),
        input.payloadDigest,
        input.envelopeDigest,
        input.cause,
        input.workerId ?? null,
        input.versionId ?? null,
        input.publishedById,
        input.publishedBySource ?? 'USER',
        input.issuedAt,
        input.expiresAt,
      ]
    )
    const pub = mapPublication(r!)
    return {
      id: pub.id,
      cellId: pub.cellId,
      revision: pub.revision,
      payloadDigest: pub.payloadDigest,
      envelopeDigest: pub.envelopeDigest,
    }
  }
}

/** Wrap the reference store so unimplemented port methods fail loudly (501). */
export function createPlaneStore(pool: Pool): VrtControlStore {
  const impl = new PlaneStore(pool)
  return new Proxy(impl as unknown as VrtControlStore, {
    get(target, prop, receiver) {
      // Never fake promise/JSON protocol members: a thenable proxy would
      // change how callers (and `await`) treat the store itself.
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') {
        return Reflect.get(target, prop, receiver)
      }
      const value = Reflect.get(target, prop, receiver)
      if (value !== undefined) return value
      return async () => {
        throw new VrtControlError(
          501,
          `the reference plane does not implement store method ${String(prop)}`
        )
      }
    },
  })
}
