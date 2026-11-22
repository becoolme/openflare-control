/**
 * Console data access. All requests are same-origin and go through the console
 * server, which injects the management token (the browser never holds it).
 */
export interface CellInfo {
  cellId: string
  clusterId: string
  revision: number
  capabilities?: Record<string, boolean> | null
  workerCount?: number
  publicationCount?: number
}

export interface WorkerInfo {
  workerId: string
  teamId: string
  name: string
  status: string
  activeVersionId: string | null
  entrypoint: string
  compatibilityDate: string
  statusReason: string | null
}

export interface VersionInfo {
  versionId: string
  status: string
  createdAt: string
  bundleSha256?: string
}

export interface D1DatabaseInfo {
  database_id: string
  team_id: string
  cluster_id: string
  name: string
  created_at: string
}

export interface R2BucketInfo {
  bucket_name: string
  bucket_id: string
  team_id: string
  cluster_id: string
  created_at: string
}

export interface KvNamespaceInfo {
  namespace_id: string
  physical_id: string
  team_id: string
  cluster_id: string
  title: string
  created_at: string
}

export interface QueueInfo {
  queue_id: string
  team_id: string
  cluster_id: string
  name: string
  delivery_delay_seconds: number | null
  created_at: string
}

export interface WorkflowInfo {
  workflow_id: string
  worker_id: string
  team_id: string
  cluster_id: string
  name: string
  class_name: string
  created_at: string
}

export interface ServiceCatalog {
  d1: { databaseId: string; teamId: string; name: string; binding: Record<string, unknown> }[]
  r2: { bucketName: string; bucketId: string; teamId: string; binding: Record<string, unknown> }[]
  kv: {
    namespaceId: string
    title: string
    teamId: string
    binding: Record<string, unknown>
  }[]
  queues: {
    queueId: string
    name: string
    teamId: string
    deliveryDelaySeconds: number | null
    binding: Record<string, unknown>
  }[]
  workflows: {
    workflowId: string
    workerId: string
    name: string
    className: string
    teamId: string
  }[]
  hyperdrive: {
    hyperdriveId: string
    teamId: string
    name: string
    origin: string
    caching: boolean
    binding: Record<string, unknown>
  }[]
}

export interface WorkerMetricsInfo {
  workerId: string
  requests: number
  errors: number
  serverErrors: number
  exceptions: number
  requestBytes: number
  responseBytes: number
  inflight: number
  latency: { p50: number | null; p99: number | null }
}

export interface MetricsInfo {
  windowMs: number
  requests: number
  errors: number
  serverErrors: number
  exceptions: number
  requestBytes: number
  responseBytes: number
  inflight: number
  cpuMs: number | null
  coldStarts: number | null
  latency: { p50: number | null; p99: number | null }
  durationCount: number
  durationSumSeconds: number
  lastEventAt: string | null
  source: 'runtime' | 'logs'
  note: string
  workers: WorkerMetricsInfo[]
}

export interface D1StatsInfo {
  databaseId: string
  ops: number
  pendingOps: number
  failedOps: number
  pendingMigrations: number
  sizeBytes: number | null
  pageCount: number | null
  tableCount: number | null
  tables: string[] | null
  indexCount: number | null
  sampledAt: string | null
  note: string
}

export interface R2StatsInfo {
  bucketName: string
  ops: number
  pendingOps: number
  failedOps: number
  classAOps: number
  classBOps: number
  objects: number | null
  sizeBytes: number | null
  truncated: boolean | null
  sampledAt: string | null
  stale: boolean | null
  pending: boolean
  error: string | null
  note: string
}

export interface QueueStatsInfo {
  queueId: string
  consumers: number
  producers: number
  backlog: number | null
  backlogBytes: number | null
  visible: number | null
  inFlight: number | null
  delayed: number | null
  oldestMessageAgeMs: number | null
  deadLetterDepth: number | null
  delivered: number | null
  sampledAt: string | null
  note: string
}

export interface WorkflowStatsInfo {
  workflow: string
  className: string
  ops: number
  pendingOps: number
  failedOps: number
  instances: number | null
  storageBytes: number | null
  truncated: boolean | null
  sampledAt: string | null
  note: string
}

export interface DoStatsInfo {
  className: string
  workers: number
  bindings: number
  instances: number | null
  activeInstances: number | null
  storageBytes: number | null
  truncated: boolean
  sampledAt: string | null
  note: string
}

export interface InstanceInfo {
  id: string
  bytes: number
  workerId: string
}

export interface InstanceListInfo {
  instances: InstanceInfo[]
  total: number
  storageBytes: number
  truncated: boolean
  sampledAt: string | null
  waiting: boolean
  note: string
}

export interface OpInfo {
  id: string
  seq: number
  kind: string
  status: string
  result?: unknown
  error?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  databaseId?: string | null
  workerId?: string | null
  resourceKey?: string | null
}

export class ConsoleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message)
  }
}

/** Unwrap `{data}` and turn the plane's typed envelope into an Error. */
export async function consoleApi<T>(
  path: string,
  options: Record<string, unknown> = {}
): Promise<T> {
  try {
    const response = await $fetch<{ data: T }>(path, options)
    return response.data
  } catch (error) {
    const e = error as {
      statusCode?: number
      data?: { error?: { message?: string; code?: string } }
    }
    throw new ConsoleApiError(
      e.statusCode ?? 0,
      e.data?.error?.message ?? 'request failed',
      e.data?.error?.code
    )
  }
}

export function useCellSelection() {
  const cellId = useCookie<string | null>('openflare-cell', {
    sameSite: 'lax',
    default: () => null,
  })
  const cells = useState<CellInfo[]>('openflare-cells', () => [])
  const pending = useState('openflare-cells-pending', () => false)
  const error = useState<string | null>('openflare-cells-error', () => null)

  async function refresh() {
    pending.value = true
    error.value = null
    try {
      const data = await consoleApi<{ cells: CellInfo[] }>('/api/v1/cells')
      cells.value = data.cells
      if (!cellId.value || !data.cells.some((c) => c.cellId === cellId.value)) {
        cellId.value = data.cells[0]?.cellId ?? null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      pending.value = false
    }
  }

  const activeCell = computed(() => cellId.value ?? cells.value[0]?.cellId ?? '')
  return { cellId, activeCell, cells, pending, error, refresh }
}

/** Poll a management op to a terminal state (for D1/R2/KV/workflow data ops). */
export async function waitForOp(cellId: string, opId: string, timeoutMs = 15_000): Promise<OpInfo> {
  const started = Date.now()
  for (;;) {
    const found = await consoleApi<{ channel: string; op: OpInfo }>(
      `/api/v1/cells/${cellId}/ops/${opId}?waitMs=500`
    )
    if (found.op.status !== 'PENDING') return found.op
    if (Date.now() - started > timeoutMs) return found.op
    await new Promise((r) => setTimeout(r, 250))
  }
}
