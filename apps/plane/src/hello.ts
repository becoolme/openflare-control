/**
 * Hello-world proof for a running all-in-one deployment: creates a team,
 * worker and hostname, uploads a real bundle, deploys + publishes it,
 * waits for the cell to APPLY the publication, then invokes the worker
 * through the tenant ingress and prints the response.
 *
 * Runs inside the plane container so a fresh evaluation needs nothing on
 * the host beyond Docker:
 *
 *   docker compose -f docker-compose.all-in-one.yml exec plane node dist/hello.js
 *
 * Reads the admin token from the same secrets file the plane service uses;
 * PLANE_API / INGRESS / VRT_CELL_ID / HELLO_HOSTNAME override the defaults.
 */
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { buildRuntimeBundle } from 'openflare-control'

const PLANE = process.env.PLANE_API ?? 'http://127.0.0.1:8787'
const INGRESS = process.env.INGRESS ?? 'http://vrt-host:8080'
const CELL = process.env.VRT_CELL_ID ?? 'local'
const suffix = Math.random().toString(16).slice(2, 8)
const team = `hello-team-${suffix}`
const worker = `hello-${suffix}`
const hostname = process.env.HELLO_HOSTNAME ?? `${worker}.workers.local`

const token =
  process.env.PLANE_ADMIN_TOKEN ??
  readFileSync(
    process.env.PLANE_ADMIN_TOKEN_FILE ?? '/run/secrets/plane_admin_token',
    'utf8'
  ).trim()

const api = async (method: string, path: string, body?: unknown, raw = false) => {
  const res = await fetch(`${PLANE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
      ...(raw ? { 'content-type': 'application/octet-stream' } : {}),
    },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: parsed }
}

const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

console.log(`cell=${CELL} team=${team} worker=${worker} hostname=${hostname}`)

// 1. team + worker + hostname
let r = await api('POST', '/api/v1/teams', { teamId: team, name: 'Hello' })
must(r.status === 201 || r.status === 409, `create team: ${r.status} ${JSON.stringify(r.body)}`)
r = await api('POST', `/api/v1/cells/${CELL}/workers`, { teamId: team, name: worker })
must(r.status === 201 || r.status === 409, `create worker: ${r.status} ${JSON.stringify(r.body)}`)
r = await api('POST', `/api/v1/cells/${CELL}/teams/${team}/workers/${worker}/hostnames`, {
  hostname,
})
must(r.status === 201 || r.status === 409, `hostname: ${r.status} ${JSON.stringify(r.body)}`)

// 2. bundle: a real worker that echoes one of its vars
const bundle = buildRuntimeBundle({
  mainModule: 'main.js',
  modules: [
    {
      type: 'esModule',
      name: 'main.js',
      text:
        'export default { fetch(req, env) {' +
        ' return new Response(`hello from openflare: ${env.GREETING}\\n`) } }\n',
    },
  ],
  compatibilityDate: '2024-09-25',
})
r = await api('PUT', `/api/v1/cells/${CELL}/bundles/${bundle.digest}`, bundle.bytes, true)
must(r.status === 201 || r.status === 200, `bundle upload: ${r.status} ${JSON.stringify(r.body)}`)
console.log(`bundle uploaded: ${bundle.digest.slice(0, 16)}… (${bundle.bytes.byteLength} bytes)`)

// 3. deploy + publish
r = await api('POST', `/api/v1/cells/${CELL}/teams/${team}/workers/${worker}/deploy`, {
  versionId: `v1-${suffix}`,
  bundleSha256: bundle.digest,
  bundleBytes: bundle.bytes.byteLength,
  mainModule: 'main.js',
  modules: [],
  compatibilityFlags: [],
  compatibilityDate: '2024-09-25',
  crons: [],
  // The deploy boundary claims ONE env-name namespace across vars keys
  // (varRefs) and binding names, so the store key must differ from the
  // env name the worker actually reads.
  vars: { greetingValue: 'one click works' },
  bindings: [
    {
      name: 'GREETING',
      type: 'VAR',
      resourceId: 'greetingValue',
      permissionRead: true,
      permissionWrite: true,
    },
  ],
  queueConsumers: [],
  exportedClassNames: [],
  assetsRouting: null,
  assetsRunWorkerFirst: [],
  activate: true,
  publish: true,
})
must(r.status === 201, `deploy: ${r.status} ${JSON.stringify(r.body)}`)
const revision = (r.body as { data: { revision: string } }).data.revision
console.log(`deployed, publication revision ${revision} — waiting for the cell to apply…`)

// 4. wait for APPLIED
const deadline = Date.now() + 120_000
for (;;) {
  const p = await api('GET', `/api/v1/cells/${CELL}/publications/${revision}`)
  const pub = (p.body as { data?: { publication?: { ackStatus?: string } } })?.data?.publication
  if (pub?.ackStatus === 'APPLIED') break
  if (pub?.ackStatus === 'REJECTED') throw new Error(`publication REJECTED: ${JSON.stringify(pub)}`)
  if (Date.now() > deadline) throw new Error('timed out waiting for publication APPLIED')
  await sleep(1500)
}
console.log('cell applied the publication')

// 5. invoke through the tenant ingress. fetch() forbids the Host header,
// so use http.request — Host is how the ingress routes to the worker.
const body = await new Promise<string>((resolve, reject) => {
  const req = request(INGRESS, { headers: { host: hostname, connection: 'close' } }, (res) => {
    let data = ''
    res.on('data', (c) => (data += c))
    res.on('end', () =>
      res.statusCode === 200
        ? resolve(data)
        : reject(new Error(`ingress status ${res.statusCode}: ${data.slice(0, 200)}`))
    )
  })
  req.on('error', reject)
  req.end()
})

console.log('')
console.log(`worker response: ${body.trim()}`)
console.log('')
console.log('hello world complete. Invoke it yourself:')
console.log(`  curl -H "Host: ${hostname}" http://127.0.0.1:${process.env.VRT_PORT ?? '8080'}/`)
