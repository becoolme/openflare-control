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
  assetStore?: import('../assetStore.js').AssetStore
}

export const MAX_JSON = 1024 * 1024

export const cellId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const teamId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const workerName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
export const key = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/)
export const digest = z.string().regex(/^[0-9a-f]{64}$/)
export const databaseId = z.string().regex(/^[a-z0-9]{26}$/)
/** Every server-minted resource id — generatedId() emits 26 lowercase hex. */
export const resourceId = z.string().regex(/^[a-z0-9]{26}$/)
/** Service-resource names share the DNS-safe shape (r2 buckets, queues, …). */
export const serviceName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
// Op expiry as epoch seconds. `to_timestamp()` throws out of range on
// absurd integers — bound at the boundary so bad input is a 400, not a 500.
export const opExpiresAt = z.number().int().min(0).max(4_102_444_800).optional()
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

/**
 * Read the request body with the byte cap enforced WHILE streaming — a
 * chunked body without an honest content-length cannot force the whole
 * payload into memory before the size check runs.
 */
export async function readBody(c: Context, max: number): Promise<Buffer> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max) {
    throw new VrtControlError(413, 'Payload too large')
  }
  const body = c.req.raw.body
  if (!body) return Buffer.alloc(0)
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => {})
        throw new VrtControlError(413, 'Payload too large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

export async function readJson(c: Context, max = MAX_JSON): Promise<unknown> {
  const raw = await readBody(c, max)
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new VrtControlError(400, 'Invalid JSON')
  }
}

/** Capped body read for endpoints where an empty body is valid input. */
export async function readJsonOrEmpty(c: Context, max = MAX_JSON): Promise<unknown> {
  const raw = (await readBody(c, max)).toString('utf8').trim()
  if (!raw) return {}
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

/** Resource creates must not accept a team that doesn't exist — orphan rows
 * would outlive the typo. */
export async function requireTeam(deps: AdminDeps, id: string): Promise<void> {
  const [row] = await rows(deps, 'select 1 from plane_teams where team_id=$1 limit 1', [id])
  if (!row) throw new VrtControlError(404, 'Team not found', 'VRT_TEAM_NOT_FOUND')
}

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

export const mapTeam = (r: Row) => ({
  teamId: s(r.team_id),
  name: s(r.name),
  plan: nullableString(r.plan),
  createdAt: iso(r.created_at),
  ...(r.workers === undefined ? {} : { workers: n(r.workers) }),
  ...(r.requests_month === undefined && r.cpu_ms_month === undefined && r.workers_max === undefined
    ? {}
    : {
        quotas: {
          requestsMonth: r.requests_month == null ? null : n(r.requests_month),
          cpuMsMonth: r.cpu_ms_month == null ? null : n(r.cpu_ms_month),
          workersMax: r.workers_max == null ? null : n(r.workers_max),
        },
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

/**
 * Cell op results cross the JSON channel with binary values base64-encoded
 * (`valueBase64`). The plane API speaks text: decode KV results back into a
 * utf8 `value` at the boundary so browser clients never handle the wire
 * encoding. The base64 form stays in the result for lossless consumers.
 */
function decodeKvResult(kind: string, result: unknown): unknown {
  if (result === null || typeof result !== 'object') return result ?? null
  const out = { ...(result as Record<string, unknown>) }
  const decode = (entry: Record<string, unknown>) => {
    if (typeof entry.valueBase64 === 'string' && entry.value === undefined) {
      entry.value = Buffer.from(entry.valueBase64, 'base64').toString('utf8')
    }
  }
  if (kind === 'KV_GET') decode(out)
  if (kind === 'R2_GET' && typeof out.bodyBase64 === 'string' && out.body === undefined) {
    out.body = Buffer.from(out.bodyBase64 as string, 'base64').toString('utf8')
  }
  return out
}

export const mapOp = (r: Row) => ({
  id: s(r.id),
  seq: n(r.seq),
  databaseId: nullableString(r.database_id),
  workerId: nullableString(r.worker_id),
  resourceKey: nullableString(r.resource_key),
  kind: s(r.kind),
  status: s(r.status),
  result: decodeKvResult(s(r.kind), r.result),
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

// Origins are `host:port/db` or `scheme://host/db` — credentials live with
// the provider, never in the plane. Writes reject an embedded userinfo and
// reads mask it, so a legacy row can't echo a password back through GETs.
const ORIGIN_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

// Index of the last `@` inside the authority (text before the first `/`
// after any scheme), or -1 when there is no userinfo. Passwords may
// themselves contain `@`, so the userinfo ends at the LAST `@`.
function userinfoEnd(origin: string): number {
  const o = origin.trim()
  const scheme = o.match(ORIGIN_SCHEME_RE)?.[0].length ?? 0
  const rest = o.slice(scheme)
  const at = rest.split('/')[0]!.lastIndexOf('@')
  return at < 0 ? -1 : scheme + at
}

export function assertOriginNoCredentials(origin: string): void {
  if (/\s/.test(origin)) {
    throw new VrtControlError(400, 'origin must be a host:port/db or scheme://host/db URL')
  }
  if (userinfoEnd(origin) >= 0) {
    throw new VrtControlError(
      400,
      'origin must not embed credentials — store them with the provider, not the plane'
    )
  }
}

export function maskOrigin<T extends { origin: string }>(row: T): T {
  const o = row.origin.trim()
  // Anything carrying whitespace isn't the documented URL shape at all
  // (e.g. a libpq keyword/value DSN) — don't echo it back at all.
  if (/\s/.test(o)) return { ...row, origin: '***' }
  const end = userinfoEnd(o)
  if (end < 0) return { ...row, origin: o }
  const scheme = o.match(ORIGIN_SCHEME_RE)?.[0] ?? ''
  return { ...row, origin: `${scheme}***${o.slice(end)}` }
}
