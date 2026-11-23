// e2e for docker-compose.all-in-one.yml — asserts the WHOLE platform
// path on one host: plane API → signed desired → cell-controller pull →
// vrt-host/workerd ingress → response, plus the console auth gate.
// The workflow brings the stack up; this script only talks HTTP.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { buildRuntimeBundle } from '../packages/control/dist/index.js'

const PLANE = 'http://127.0.0.1:8787'
const CONSOLE = 'http://127.0.0.1:8788'
const INGRESS = 'http://127.0.0.1:8080'
const ADMIN = process.env.PLANE_ADMIN_TOKEN
const CONSOLE_PW = process.env.CONSOLE_AUTH_PASSWORD
const CELL = process.env.VRT_CELL_ID ?? 'local'
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const team = `team-${suffix}`
const worker = 'aio-e2e'
const hostname = `aio-${suffix}.test`

const api = async (method, path, body, raw = false) => {
  const headers = { authorization: `Bearer ${ADMIN}` }
  if (raw) headers['content-type'] = 'application/octet-stream'
  else if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${PLANE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  return {
    status: res.status,
    body: (res.headers.get('content-type') ?? '').includes('json')
      ? JSON.parse(text || 'null')
      : text,
  }
}

async function waitFor(fn, label, timeoutMs = 120_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`)
}

await waitFor(async () => (await fetch(`${PLANE}/healthz`)).ok, 'plane healthz', 60_000)

// cell-init must have finished cleanly — the whole cell wiring depends
// on the token/config/secrets it seeds.
const ps = execFileSync(
  'docker',
  ['compose', '-f', 'docker-compose.all-in-one.yml', 'ps', '-a', '--format', 'json'],
  { encoding: 'utf8' }
)
// `--format json` is NDJSON on older compose, a JSON array on newer.
const trimmed = ps.trim()
const states = trimmed.startsWith('[')
  ? JSON.parse(trimmed)
  : trimmed
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
const init = states.find((s) => s.Service === 'cell-init')
assert.ok(init, 'cell-init container missing')
assert.equal(init.State + '|' + init.ExitCode, 'exited|0', `cell-init: ${init.Status}`)

// Console gate: anonymous → 401, Basic admin:pw → proxy through.
let r = await fetch(`${CONSOLE}/api/v1/cells`)
assert.equal(r.status, 401, 'console must require auth')
r = await fetch(`${CONSOLE}/api/v1/cells`, {
  headers: { authorization: `Basic ${Buffer.from(`admin:${CONSOLE_PW}`).toString('base64')}` },
})
assert.equal(r.status, 200, 'console Basic auth must proxy to the admin API')

// The bootstrapped cell is registered.
r = await api('GET', `/api/v1/cells/${CELL}`)
assert.equal(r.status, 200, `cell ${CELL} missing`)
assert.equal(r.body.data.cellId, CELL)

// Worker + hostname + bundle + deploy → cell ack → ingress serve.
r = await api('POST', `/api/v1/cells/${CELL}/workers`, { teamId: team, name: worker })
assert.equal(r.status, 201, JSON.stringify(r.body))
r = await api('POST', `/api/v1/cells/${CELL}/teams/${team}/workers/${worker}/hostnames`, {
  hostname,
})
assert.equal(r.status, 201, JSON.stringify(r.body))

const bundleValue = buildRuntimeBundle({
  mainModule: 'main.js',
  modules: [
    {
      type: 'esModule',
      name: 'main.js',
      text:
        'export default { fetch(req, env) {' + ' return new Response(`aio:${env.E2E_VAR}`) } }\n',
    },
  ],
  compatibilityDate: '2024-09-25',
})
r = await api(
  'PUT',
  `/api/v1/cells/${CELL}/bundles/${bundleValue.digest}`,
  Buffer.from(bundleValue.bytes),
  true
)
assert.equal(r.status, 201, `bundle upload: ${JSON.stringify(r.body)}`)

r = await api('POST', `/api/v1/cells/${CELL}/teams/${team}/workers/${worker}/deploy`, {
  versionId: `v-${suffix}`,
  bundleSha256: bundleValue.digest,
  bundleBytes: bundleValue.bytes.byteLength,
  mainModule: 'main.js',
  modules: [],
  compatibilityFlags: [],
  compatibilityDate: '2024-09-25',
  crons: [],
  vars: { E2E_VAR: 'all-in-one-var' },
  bindings: [],
  queueConsumers: [],
  exportedClassNames: [],
  assetsRouting: null,
  assetsRunWorkerFirst: [],
  activate: true,
  publish: true,
})
assert.equal(r.status, 201, `deploy: ${JSON.stringify(r.body)}`)
const revision = r.body.data.revision

await waitFor(
  async () => {
    const p = await api('GET', `/api/v1/cells/${CELL}/publications/${revision}`)
    const pub = p.body?.data?.publication
    if (pub?.ackStatus === 'REJECTED') throw new Error(`REJECTED: ${JSON.stringify(pub)}`)
    return pub?.ackStatus === 'APPLIED' && pub
  },
  `publication ${revision} APPLIED`,
  180_000
)

// Ingress: Host header routes to the worker; the var travels through
// the cell's render-inputs into the worker env. Raw http.request —
// fetch treats Host as forbidden.
const ingress = () =>
  new Promise((resolve, reject) => {
    const req = request(INGRESS, { headers: { host: hostname, connection: 'close' } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })

await waitFor(
  async () => {
    const res = await ingress()
    return res.status === 200 && res.body === 'aio:all-in-one-var'
  },
  `ingress ${hostname}`,
  120_000
)

console.log('all-in-one e2e: plane + console auth + cell pull + ingress OK')
