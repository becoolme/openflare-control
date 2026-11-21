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
