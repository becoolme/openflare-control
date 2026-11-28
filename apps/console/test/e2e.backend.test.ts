// @vitest-environment node
/**
 * Real-backend console e2e: boots the actual plane (real Postgres, real
 * signing, in-memory bundle store) on a loopback port, spawns the real
 * console server as a child process pointing at it, then drives the exact
 * HTTP operations the console UI performs — through the console's own
 * authenticated proxy. Nothing is mocked: every assertion reads plane
 * state through the same proxy.
 *
 * Requires DATABASE_URL (a scratch database — the schema is applied
 * idempotently). Skipped otherwise so unit-test-only environments pass.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
// plane is a workspace sibling; import its app factory directly.
// @ts-expect-error -- plane has no exported types entrypoint for its src
import { createApp } from '../../plane/src/routes.js'
// @ts-expect-error -- same
import { createPlaneStore } from '../../plane/src/store.js'
// @ts-expect-error -- same
import { resolvePlaneSigningKey } from '../../plane/src/signing.js'
// @ts-expect-error -- same
import { createSecretsCipher } from '../../plane/src/secretsCipher.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'console-e2e-admin-token'
const AUTH = 'Basic ' + Buffer.from(`admin:console-e2e-password`).toString('base64')

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

maybe('console backend e2e (real plane + real console server)', () => {
  let pool: Pool
  let planeServer: ReturnType<typeof createServer>
  let planePort = 0
  let consoleProc: ChildProcess
  let consolePort = 0
  const suffix = Math.random().toString(16).slice(2, 8)
  const cell = `ce2e-${suffix}`
  const team = `ce2e-team-${suffix}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(
      await readFile(join(process.cwd(), '../plane/src/schema.sql'), 'utf8')
    )
    const app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles() as never,
      adminToken: TOKEN,
      secrets: createSecretsCipher('console-e2e-cipher-key-00001'),
      signing: resolvePlaneSigningKey('console-e2e-signing-secret-0123456789'),
    })
    planeServer = createServer((req, res) => {
      app.fetch(new Request(`http://x${req.url}`, {
        method: req.method,
        headers: req.headers as never,
        ...(req.method !== 'GET' && req.method !== 'HEAD'
          ? { body: req, duplex: 'half' as const }
          : {}),
      })).then(async (r) => {
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()))
        if (r.body) {
          const buf = Buffer.from(await r.arrayBuffer())
          res.end(buf)
        } else res.end()
      }).catch(() => res.writeHead(500).end())
    })
    await new Promise<void>((r) => planeServer.listen(0, '127.0.0.1', r))
    planePort = (planeServer.address() as { port: number }).port

    consoleProc = spawn(process.execPath, [join(process.cwd(), 'server/main.mjs')], {
      env: {
        ...process.env,
        PORT: '0',
        PLANE_URL: `http://127.0.0.1:${planePort}`,
        PLANE_ADMIN_TOKEN: TOKEN,
        CONSOLE_AUTH_USER: 'admin',
        CONSOLE_AUTH_PASSWORD: 'console-e2e-password',
      },
      stdio: 'pipe',
    })
    consoleProc.stderr?.on('data', (d) => console.error('[console stderr]', String(d).slice(0, 300)))
    consolePort = await new Promise<number>((resolvePort, reject) => {
      let buf = ''
      consoleProc.stdout?.on('data', (d) => {
        buf += String(d)
        const m = buf.match(/listening on :(\d+)/)
        if (m) resolvePort(Number(m[1]))
      })
      consoleProc.on('exit', (code) => reject(new Error(`console exited early: ${code}`)))
      setTimeout(() => reject(new Error('console did not announce a port')), 8_000)
    })
    // wait for the console to accept connections
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
  }, 30_000)

  afterAll(async () => {
    consoleProc?.kill()
    planeServer?.close()
    await pool?.end()
  })

  async function api(method: string, path: string, body?: unknown) {
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
    return { status: res.status, body: parsed as { data?: never; error?: { message: string } } }
  }

  it('rejects unauthenticated requests (fail closed)', async () => {
    const res = await fetch(`http://127.0.0.1:${consolePort}/api/v1/cells`)
    expect(res.status).toBe(401)
  })

  it('drives the full worker lifecycle through the console proxy', async () => {
    expect((await api('POST', '/api/v1/cells', { cellId: cell })).status).toBe(201)
    expect((await api('POST', '/api/v1/teams', { teamId: team, name: 'E2E' })).status).toBe(201)

    // create worker — same helper path as the Create button
    const create = await api('POST', `/api/v1/cells/${cell}/workers`, { teamId: team, name: 'e2e-worker' })
    expect(create.status).toBe(201)

    // deploy real source — same path as the Deploy dialog
    const deploy = await api(
      'POST',
      `/api/v1/cells/${cell}/teams/${team}/workers/e2e-worker/deploy-source`,
      {
        modules: [
          { name: 'main.js', type: 'esModule', text: 'export default { fetch() { return new Response("ok") } }\n' },
        ],
      }
    )
    expect(deploy.status).toBe(201)
    expect((deploy.body.data as never as { activated: boolean }).activated).toBe(true)

    // list reflects it — same path as the index page table
    const list = await api('GET', `/api/v1/cells/${cell}/workers`)
    expect(
      (list.body.data as never as { workers: { name: string; activeVersionId: string | null }[] }).workers.some(
        (w) => w.name === 'e2e-worker' && w.activeVersionId !== null
      )
    ).toBe(true)

    // detail aggregate — same path as the detail shell
    const detail = await api('GET', `/api/v1/cells/${cell}/teams/${team}/workers/e2e-worker`)
    expect(detail.status).toBe(200)
    expect((detail.body.data as never as { versions: unknown[] }).versions.length).toBeGreaterThan(0)

    // delete — same path as the row menu
    const del = await api('DELETE', `/api/v1/cells/${cell}/teams/${team}/workers/e2e-worker`)
    expect(del.status).toBe(200)
    const after = await api('GET', `/api/v1/cells/${cell}/workers`)
    expect(
      (after.body.data as never as { workers: { name: string }[] }).workers.some((w) => w.name === 'e2e-worker')
    ).toBe(false)
  })

  it('drives d1 + kv + r2 + queue + hyperdrive creation through the proxy', async () => {
    const resources: [string, string, unknown][] = [
      [`/api/v1/cells/${cell}/d1/databases`, 'd1', { teamId: team, name: 'e2e-db' }],
      [`/api/v1/cells/${cell}/kv/namespaces`, 'kv', { teamId: team, title: 'e2e-ns' }],
      [`/api/v1/cells/${cell}/r2/buckets`, 'r2', { teamId: team, bucketName: 'e2e-bucket' }],
      [`/api/v1/cells/${cell}/queues`, 'queue', { teamId: team, name: 'e2e-queue' }],
      [`/api/v1/cells/${cell}/hyperdrive`, 'hyperdrive', { teamId: team, name: 'e2e-hd', origin: 'postgres://host/db' }],
    ]
    for (const [path, label, body] of resources) {
      const r = await api('POST', path, body)
      expect(r.status, `${label} create: ${JSON.stringify(r.body)}`).toBe(201)
    }
  })
})
