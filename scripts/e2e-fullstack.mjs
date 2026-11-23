#!/usr/bin/env node
/**
 * Full-stack e2e: management API → plane → real cell-controller → real
 * vrt-host → real workerd → ingress.
 *
 *   DATABASE_URL=... RUNTIME_DIR=../openflare \
 *   WORKERD_BIN=../openflare/.ci/workerd/workerd \
 *   PLANE_SIGNING_SECRET=... PLANE_TOKEN=... PLANE_ADMIN_TOKEN=... \
 *   node scripts/e2e-fullstack.mjs
 *
 * It uploads a runtime stored-document bundle via the management API,
 * deploys v1, waits for the cell ACK, requests the ingress and asserts the
 * worker code returns `v1`; then uploads a v2 bundle, redeploys, and polls
 * until the ingress serves `v2`.
 *
 * Local stub mode (no real workerd):
 *   FULLSTACK_STUB=1 VRT_HOST_BIN=... STUB_BIN=... node scripts/e2e-fullstack.mjs
 * The stub path proves the API/cell-controller/bundle/ACK wiring but not code
 * execution (the stub answers `stub ok`).
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildRuntimeBundle } from '../packages/control/dist/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_DIR = resolve(process.env.RUNTIME_DIR ?? join(ROOT, '..', 'openflare'))
const PLANE_PORT = Number(process.env.PLANE_PORT ?? 8787)
const PLANE_URL = `http://127.0.0.1:${PLANE_PORT}`
const STUB = process.env.FULLSTACK_STUB === '1'
const KEEP = process.env.FULLSTACK_KEEP === '1'
const TOKEN = process.env.PLANE_TOKEN ?? 'fullstack-cell-token'
const ADMIN_TOKEN = process.env.PLANE_ADMIN_TOKEN ?? TOKEN
const SIGNING_SECRET = process.env.PLANE_SIGNING_SECRET ?? 'fullstack-signing-secret-1234'
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const VRT_HOST_BIN = process.env.VRT_HOST_BIN ?? join(RUNTIME_DIR, 'target/debug/vrt-host')
const CELL_CONTROLLER_BIN =
  process.env.CELL_CONTROLLER_BIN ?? join(RUNTIME_DIR, 'target/debug/cell-controller')
const WORKERD_BIN = process.env.WORKERD_BIN ?? join(RUNTIME_DIR, '.ci/workerd/workerd')
const STUB_BIN = process.env.STUB_BIN ?? join(RUNTIME_DIR, 'target/debug/vrt-stub-workerd')
const FACADE_DIR = process.env.FACADE_DIR ?? join(RUNTIME_DIR, 'facade')
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const cell = `fullstack-${suffix}`
const team = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
const worker = 'edge'
const hostname = `app-${suffix}.fullstack.test`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const q = (value) => JSON.stringify(value)

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function waitFor(fn, label, timeoutMs = 60_000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`${label} timed out${last ? `: ${last.message ?? last}` : ''}`)
}

async function api(method, path, body, raw = false) {
  const headers = { authorization: `Bearer ${ADMIN_TOKEN}` }
  if (raw) headers['content-type'] = 'application/octet-stream'
  else if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${PLANE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await response.text()
  let parsed = text
  if (text && (response.headers.get('content-type') ?? '').includes('json')) {
    parsed = JSON.parse(text)
  }
  return { status: response.status, body: parsed }
}

function workerRequest(port, pathname = '/') {
  return new Promise((resolveRequest, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        headers: { host: hostname, connection: 'close' },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolveRequest({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          })
        )
      }
    )
    request.on('error', reject)
    request.end()
  })
}

const processes = []
const logs = new Map()

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ring = []
  logs.set(name, ring)
  const capture = (chunk) => {
    const text = chunk.toString()
    ring.push(text)
    if (ring.length > 200) ring.shift()
    if (process.env.FULLSTACK_VERBOSE === '1') process.stdout.write(`[${name}] ${text}`)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.on('exit', (code, signal) => {
    if (process.env.FULLSTACK_VERBOSE === '1' && code !== 0 && signal !== 'SIGTERM') {
      console.error(`[${name}] exited code=${code} signal=${signal}`)
    }
  })
  processes.push({ name, child })
  return child
}

function dumpLogs() {
  for (const [name, ring] of logs) {
    console.error(`\n===== ${name} (last ${ring.length} chunks) =====`)
    console.error(ring.join(''))
  }
}

async function stopAll() {
  await Promise.all(
    processes.map(async ({ name, child }) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGTERM')
      const done = await Promise.race([
        new Promise((r) => child.once('exit', () => r(true))),
        sleep(8_000).then(() => false),
      ])
      if (!done) {
        child.kill('SIGKILL')
        await sleep(500)
      }
      if (process.env.FULLSTACK_VERBOSE === '1') console.error(`stopped ${name}`)
    })
  )
}

async function waitHealth(url, label, timeoutMs = 30_000) {
  await waitFor(
    async () => {
      try {
        const response = await fetch(url)
        return response.status === 200
      } catch {
        return false
      }
    },
    label,
    timeoutMs,
    200
  )
}

async function waitPublication(revision, timeoutMs = 120_000) {
  return await waitFor(
    async () => {
      const result = await api('GET', `/api/v1/cells/${cell}/publications/${revision}`)
      if (result.status !== 200) return false
      const publication = result.body?.data?.publication
      if (publication?.ackStatus === 'APPLIED') return publication
      if (publication?.ackStatus === 'REJECTED') {
        throw new Error(`publication ${revision} REJECTED: ${JSON.stringify(publication)}`)
      }
      return false
    },
    `publication ${revision} APPLIED`,
    timeoutMs,
    500
  )
}

function bundle(code) {
  return buildRuntimeBundle({
    mainModule: 'main.js',
    modules: [
      {
        type: 'esModule',
        name: 'main.js',
        text: `export default { fetch() { return new Response(${q(code)}) } }\n`,
      },
    ],
    compatibilityDate: '2024-09-25',
  })
}

async function uploadBundle(bundleValue) {
  const result = await api(
    'PUT',
    `/api/v1/cells/${cell}/bundles/${bundleValue.digest}`,
    Buffer.from(bundleValue.bytes),
    true
  )
  assert.equal(result.status, 201, `bundle upload: ${JSON.stringify(result.body)}`)
}

async function deploy(bundleValue, versionId) {
  const result = await api('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/deploy`, {
    versionId,
    bundleSha256: bundleValue.digest,
    bundleBytes: bundleValue.bytes.byteLength,
    mainModule: 'main.js',
    modules: [],
    compatibilityFlags: [],
    compatibilityDate: '2024-09-25',
    crons: [],
    vars: {},
    bindings: [],
    queueConsumers: [],
    exportedClassNames: [],
    assetsRouting: null,
    assetsRunWorkerFirst: [],
    activate: true,
    publish: true,
  })
  assert.equal(result.status, 201, `deploy ${versionId}: ${JSON.stringify(result.body)}`)
  assert.ok(result.body?.data?.revision > 0, 'deploy must publish a revision')
  return result.body.data.revision
}

async function main() {
  assert.ok(existsSync(VRT_HOST_BIN), `vrt-host binary missing: ${VRT_HOST_BIN}`)
  assert.ok(
    existsSync(CELL_CONTROLLER_BIN),
    `cell-controller binary missing: ${CELL_CONTROLLER_BIN}`
  )
  if (STUB) assert.ok(existsSync(STUB_BIN), `stub binary missing: ${STUB_BIN}`)
  else assert.ok(existsSync(WORKERD_BIN), `workerd binary missing: ${WORKERD_BIN}`)
  assert.ok(existsSync(join(FACADE_DIR, 'manifest.json')), `facade manifest missing: ${FACADE_DIR}`)

  const root = await mkdtemp(join(tmpdir(), 'ofs-'))
  const podDir = join(root, 'pod')
  const delivery = join(podDir, 'delivery')
  const workDir = join(podDir, 'work')
  const cacheDir = join(podDir, 'cache')
  const doDir = join(podDir, 'do')
  const providerDir = join(podDir, 'provider')
  const stateDir = join(root, 'state')
  const bundleDir = join(root, 'bundles')
  for (const dir of [
    root,
    podDir,
    delivery,
    workDir,
    cacheDir,
    doDir,
    providerDir,
    stateDir,
    bundleDir,
  ]) {
    await mkdir(dir, { recursive: true })
    await chmod(dir, 0o700)
  }
  const cellTokenFile = join(root, 'cell-token')
  await writeFile(cellTokenFile, `${TOKEN}\n`, { mode: 0o600 })
  await chmod(cellTokenFile, 0o600)

  const ingressPort = await freePort()
  const controlPort = await freePort()
  const healthPort = await freePort()

  const planeEnv = {
    DATABASE_URL,
    PORT: String(PLANE_PORT),
    PLANE_TOKEN: TOKEN,
    PLANE_ADMIN_TOKEN: ADMIN_TOKEN,
    PLANE_SIGNING_SECRET: SIGNING_SECRET,
    PLANE_BUNDLE_DIR: bundleDir,
  }
  const migrate = spawnSync('node', ['apps/plane/dist/migrate.js'], {
    cwd: ROOT,
    env: { ...process.env, ...planeEnv },
    stdio: 'inherit',
  })
  assert.equal(migrate.status, 0, 'plane migrate failed')
  start('plane', 'node', ['apps/plane/dist/main.js'], { cwd: ROOT, env: planeEnv })
  await waitHealth(`${PLANE_URL}/healthz`, 'plane healthz')

  const { resolvePlaneSigningKey } = await import(
    pathToFileURL(join(ROOT, 'apps/plane/dist/signing.js')).href
  )
  const key = resolvePlaneSigningKey(SIGNING_SECRET)

  // Cell + worker + hostname.
  assert.equal((await api('POST', '/api/v1/cells', { cellId: cell })).status, 201)
  assert.equal(
    (await api('POST', `/api/v1/cells/${cell}/workers`, { teamId: team, name: worker })).status,
    201
  )
  assert.equal(
    (
      await api('POST', `/api/v1/cells/${cell}/teams/${team}/workers/${worker}/hostnames`, {
        hostname,
      })
    ).status,
    201
  )

  const vrtHostConfigPath = join(root, 'vrt-host.toml')
  const cellControllerConfigPath = join(root, 'cell-controller.toml')
  const render = STUB
    ? `[render]
mode = "stub"
quotas = true
`
    : `[render]
mode = "capnp"
facadeManifest = ${q(join(FACADE_DIR, 'manifest.json'))}
bindingBackendDir = ${q(providerDir)}
systemCompatDate = "2024-09-25"
systemCompatFlags = []
quotas = true
`
  await writeFile(
    vrtHostConfigPath,
    `cellId = ${q(cell)}
workerdBinary = ${q(STUB ? STUB_BIN : WORKERD_BIN)}
workDir = ${q(workDir)}
cacheDir = ${q(cacheDir)}
doStorageDir = ${q(doDir)}
allowLocalDurability = true
listenAddr = "127.0.0.1:${ingressPort}"
controlListen = "127.0.0.1:${controlPort}"

[desired]
path = ${q(join(delivery, 'envelope.json'))}
podId = "pod-0"
assignmentFile = ${q(join(delivery, 'assignment.json'))}
trustedKeys = [{ keyId = ${q(key.keyId)}, publicKey = ${q(key.publicKey)} }]
reloadMs = 200
graceVersions = 1

${render}
[bundles]
baseUrl = ${q(`${PLANE_URL}/api/internal/clusters/${cell}`)}
tokenFile = ${q(cellTokenFile)}
requestTimeoutMs = 5000
deadlineMs = 15000
maxAttempts = 3
maxBytes = 33554432

[supervisor]
readyTimeoutMs = 15000
probeTimeoutMs = 200
killGraceMs = 1000
backoffBaseMs = 200
backoffMaxMs = 3000
failWindowMs = 180000

[ingress]
requestTimeoutMs = 30000
connectTimeoutMs = 500
maxBodyBytes = 1048576

[geoip]
enabled = false
`,
    { mode: 0o600 }
  )
  await writeFile(
    cellControllerConfigPath,
    `cell_id = ${q(cell)}
control_plane_url = ${q(PLANE_URL)}
allow_insecure_http = true
token_file = ${q(cellTokenFile)}
health_listen = "127.0.0.1:${healthPort}"
poll_interval_secs = 1
cron_holder = "fullstack"
fence_file = ${q(join(stateDir, 'fence.json'))}
cron_state_dir = ${q(stateDir)}
replicas = 1
egress_required = false

[[trusted_keys]]
keyId = ${q(key.keyId)}
publicKey = ${q(key.publicKey)}

[[pods]]
id = "pod-0"
dir = ${q(delivery)}
readyz = ${q(`http://127.0.0.1:${controlPort}`)}

[report]
enabled = false
`,
    { mode: 0o600 }
  )

  // v1: upload + deploy/publish, then start the cell controller. The
  // controller writes the envelope/assignment; vrt-host starts once both exist.
  const v1 = bundle('v1')
  await uploadBundle(v1)
  const rev1 = await deploy(v1, `v1-${suffix}`)

  start('cell-controller', CELL_CONTROLLER_BIN, [cellControllerConfigPath], {
    env: { RUST_LOG: 'info' },
  })
  await waitFor(
    async () =>
      existsSync(join(delivery, 'envelope.json')) && existsSync(join(delivery, 'assignment.json')),
    'cell envelope + assignment',
    60_000,
    200
  )
  start('vrt-host', VRT_HOST_BIN, ['--config', vrtHostConfigPath], { env: { RUST_LOG: 'info' } })
  await waitHealth(`http://127.0.0.1:${controlPort}/readyz`, 'vrt-host readyz', 60_000)
  try {
    await waitPublication(rev1)
  } catch (error) {
    try {
      const ready = await fetch(`http://127.0.0.1:${controlPort}/readyz`)
      console.error(`readyz ${ready.status}: ${await ready.text()}`)
    } catch (readyError) {
      console.error(`readyz request failed: ${readyError}`)
    }
    throw error
  }

  const expectedV1 = STUB ? 'stub ok' : 'v1'
  const first = await waitFor(
    async () => {
      const response = await workerRequest(ingressPort)
      return response.status === 200 && response.body.includes(expectedV1) ? response : false
    },
    `ingress ${expectedV1}`,
    60_000,
    250
  )
  console.log(`v1 served: ${first.body.trim().slice(0, 80)}`)

  // v2: upload + redeploy/publish; the old generation may serve v1 during
  // the switch, so poll until the new code answers.
  const v2 = bundle('v2')
  await uploadBundle(v2)
  const rev2 = await deploy(v2, `v2-${suffix}`)
  await waitPublication(rev2)
  const expectedV2 = STUB ? 'stub ok' : 'v2'
  const second = await waitFor(
    async () => {
      const response = await workerRequest(ingressPort)
      return response.status === 200 && response.body.includes(expectedV2) ? response : false
    },
    `ingress ${expectedV2}`,
    90_000,
    250
  )
  console.log(`v2 served: ${second.body.trim().slice(0, 80)}`)
  console.log(
    `OK: full-stack e2e passed (cell ${cell}, revisions ${rev1}→${rev2}, ${
      STUB ? 'stub workerd' : 'real workerd'
    })`
  )

  await stopAll()
  if (!KEEP) await rm(root, { recursive: true, force: true })
}

main().catch(async (error) => {
  console.error(`FULL-STACK E2E FAILED: ${error.stack ?? error}`)
  dumpLogs()
  await stopAll()
  process.exit(1)
})
