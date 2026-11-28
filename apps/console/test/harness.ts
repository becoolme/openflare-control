/** Shared real-backend harness: boots the actual plane (real Postgres,
 *  real signing, in-memory bundle store) on a loopback port plus the real
 *  console server as a child process. Used by both the proxy-level backend
 *  e2e and the playwright browser e2e. Nothing is mocked. */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { Pool } from 'pg'
// @ts-expect-error -- plane has no exported types entrypoint for its src
import { createApp } from '../../plane/src/routes.js'
// @ts-expect-error -- same
import { createPlaneStore } from '../../plane/src/store.js'
// @ts-expect-error -- same
import { resolvePlaneSigningKey } from '../../plane/src/signing.js'
// @ts-expect-error -- same
import { createSecretsCipher } from '../../plane/src/secretsCipher.js'

export const TOKEN = 'console-e2e-admin-token'
export const PASSWORD = 'console-e2e-password'
export const AUTH = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64')

class MemoryBundles {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, body: Uint8Array) {
    this.objects.set(key.slice(key.lastIndexOf('/') + 1), body)
    return { key, sha256: '' }
  }
  async get(key: string) {
    const body = this.objects.get(key.slice(key.lastIndexOf('/') + 1))
    if (!body) return null
    return {
      stream: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(body)
          c.close()
        },
      }),
      bytes: body.byteLength,
    }
  }
}

export interface Harness {
  pool: Pool
  planeServer: Server
  consoleProc: ChildProcess
  consolePort: number
  close: () => Promise<void>
}

export async function bootHarness(): Promise<Harness> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL required')
  // hermetic database per harness: vitest runs test files in parallel, and
  // concurrent schema application against one shared database races on
  // catalog rows (pg_type_typname_nsp_index). each boot creates its own
  // scratch database and drops it on close.
  const base = new URL(url)
  const dbName = `e2e_${Math.random().toString(16).slice(2, 12)}`
  const maint = new Pool({ connectionString: url })
  await maint.query(`CREATE DATABASE "${dbName}"`)
  base.pathname = `/${dbName}`
  const pool = new Pool({ connectionString: base.toString() })
  await pool.query(await readFile(join(process.cwd(), '../plane/src/schema.sql'), 'utf8'))
  const app = createApp({
    store: createPlaneStore(pool),
    pool,
    bundleStore: new MemoryBundles() as never,
    adminToken: TOKEN,
    secrets: createSecretsCipher('console-e2e-cipher-key-00001'),
    signing: resolvePlaneSigningKey('console-e2e-signing-secret-0123456789'),
  })
  const planeServer = createServer((req, res) => {
    app
      .fetch(
        new Request(`http://x${req.url}`, {
          method: req.method,
          headers: req.headers as never,
          ...(req.method !== 'GET' && req.method !== 'HEAD'
            ? { body: req, duplex: 'half' as const }
            : {}),
        })
      )
      .then(async (r: Response) => {
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()))
        if (r.body) res.end(Buffer.from(await r.arrayBuffer()))
        else res.end()
      })
      .catch(() => res.writeHead(500).end())
  })
  await new Promise<void>((r) => planeServer.listen(0, '127.0.0.1', r))
  const planePort = (planeServer.address() as { port: number }).port

  const consoleProc = spawn(process.execPath, [join(process.cwd(), 'server/main.mjs')], {
    env: {
      ...process.env,
      PORT: '0',
      PLANE_URL: `http://127.0.0.1:${planePort}`,
      PLANE_ADMIN_TOKEN: TOKEN,
      CONSOLE_AUTH_PASSWORD: PASSWORD,
    },
    stdio: 'pipe',
  })
  consoleProc.stderr?.on('data', (d) => console.error('[console stderr]', String(d).slice(0, 300)))
  const consolePort = await new Promise<number>((resolvePort, reject) => {
    let buf = ''
    consoleProc.stdout?.on('data', (d) => {
      buf += String(d)
      const m = buf.match(/listening on :(\d+)/)
      if (m) resolvePort(Number(m[1]))
    })
    consoleProc.on('exit', (code) => reject(new Error(`console exited early: ${code}`)))
    setTimeout(() => reject(new Error('console did not announce a port')), 8_000)
  })
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${consolePort}/console-healthz`)
      break
    } catch {
      if (Date.now() > deadline) throw new Error('console server did not start')
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const close = async () => {
    consoleProc?.kill()
    planeServer?.close()
    await pool?.end()
    try {
      await maint.query(`DROP DATABASE IF EXISTS "${dbName}"`)
    } finally {
      await maint.end()
    }
  }
  return { pool, planeServer, consoleProc, consolePort, close }
}

/** Minimal api helper through the console proxy (basic auth). */
export async function api(
  consolePort: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: { data?: never; error?: { message: string } } }> {
  const res = await fetch(`http://127.0.0.1:${consolePort}${path}`, {
    method,
    headers: {
      authorization: AUTH,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* html or empty */
  }
  return { status: res.status, body: parsed as never }
}
