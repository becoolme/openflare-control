/**
 * Shared management-API context: deps, auth, body parsing, SQL helpers and
 * wire mappers. Route modules under `admin/` stay small and focused.
 */
import type { Context } from 'hono'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'
import { z } from 'zod'
import {
  VrtControlError,
  type BundleStore,
  type SnapshotSigningContext,
  type VrtControlStore,
} from 'openflare-control'

export interface AdminDeps {
  pool: Pool
  store: VrtControlStore
  bundleStore: BundleStore
  adminToken?: string
  signing?: SnapshotSigningContext
  maxBundleBytes?: number
  retention?: import('../retention.js').RetentionConfig
  /** At-rest cipher for `plane_secrets.value` — required, no plaintext fallback. */
  secrets: import('../secretsCipher.js').SecretsCipher
}

export const MAX_JSON = 1024 * 1024

export const cellId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const teamId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const workerName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const key = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/)
export const digest = z.string().regex(/^[0-9a-f]{64}$/)
export const databaseId = z.string().regex(/^[a-z0-9]{26}$/)
export const hostname = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
export const quotas = z
  .object({
    cpuMs: z.number().int().min(1).max(300_000),
    memoryMb: z.number().int().min(1).max(4096),
    subrequests: z.number().int().min(0).max(10_000),
    outboundConnections: z.number().int().min(0).max(1024),
  })
  .strict()

export function requireAdmin(c: Context, expected: string): void {
  const header = c.req.header('authorization') ?? ''
  const got = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!got || !timingSafeEqual(a, b)) {
    throw new VrtControlError(401, 'Invalid management token')
  }
}

export async function readJson(c: Context, max = MAX_JSON): Promise<unknown> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max) {
    throw new VrtControlError(413, 'Payload too large')
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw, 'utf8') > max) throw new VrtControlError(413, 'Payload too large')
  try {
    return JSON.parse(raw)
  } catch {
    throw new VrtControlError(400, 'Invalid JSON')
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new VrtControlError(
      400,
      `Invalid request: ${result.error.issues[0]?.path.join('.') ?? 'body'}`
    )
  }
  return result.data
}

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

export const workerId = (team: string, name: string): string => `${team}:${name}`

export const rows = async (deps: AdminDeps, sql: string, params: unknown[] = []): Promise<Row[]> =>
  (await deps.pool.query(sql, params)).rows as Row[]

export type Row = Record<string, unknown>

export const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const n = (v: unknown): number => Number(v)
export const nullableString = (v: unknown): string | null => (v == null ? null : String(v))
export const iso = (v: unknown): string | null =>
  v == null ? null : new Date(String(v)).toISOString()

export const mapCell = (r: Row) => ({
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

export const mapWorker = (r: Row) => ({
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

export const mapOp = (r: Row) => ({
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

export const mapLog = (r: Row) => ({
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

export function generatedId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 26)
}
