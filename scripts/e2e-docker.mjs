#!/usr/bin/env node
/**
 * Real deployment e2e: talks to the built `openflare-plane` container over
 * HTTP (not `app.request`) with a real Postgres behind it.
 *
 *   PLANE_TOKEN=... docker compose up -d --build
 *   docker compose exec -T plane node dist/migrate.js
 *   PLANE_TOKEN=... node scripts/e2e-docker.mjs
 *
 * CI runs the same sequence; the script is also the local smoke command.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

const base = (process.env.PLANE_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const token = process.env.PLANE_TOKEN
if (!token) throw new Error('PLANE_TOKEN is required')

const auth = { authorization: `Bearer ${token}` }
const json = { ...auth, 'content-type': 'application/json' }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`
const cell = `docker-${suffix}`
const team = `team-${suffix}`

async function request(method, path, body, headers = json, raw = false) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  const parsed = text && !raw ? JSON.parse(text) : text
  return { status: res.status, body: parsed }
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/healthz`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`plane did not become healthy at ${base}`)
}

async function main() {
  await waitReady()
  let r = await request('POST', '/api/v1/cells', { cellId: cell })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  r = await request('POST', `/api/v1/cells/${cell}/workers`, { teamId: team, name: 'hello' })
  assert.equal(r.status, 201, JSON.stringify(r.body))

  const bundle = Buffer.from(`export default { fetch: () => new Response('${suffix}') }`)
  const digest = sha256(bundle)
  const put = await fetch(`${base}/api/v1/cells/${cell}/bundles/${digest}`, {
    method: 'PUT',
    headers: auth,
    body: bundle,
  })
  assert.equal(put.status, 201)

  r = await request('PUT', `/api/v1/cells/${cell}/teams/${team}/workers/hello/vars/GREETING`, {
    value: 'hi',
  })
  assert.equal(r.status, 200)
  r = await request('PUT', `/api/v1/cells/${cell}/teams/${team}/workers/hello/secrets/API_KEY`, {
    value: 'secret',
  })
  assert.equal(r.status, 200)
  r = await request('POST', `/api/v1/cells/${cell}/teams/${team}/workers/hello/hostnames`, {
    hostname: `hello-${suffix}.example.test`,
  })
  assert.equal(r.status, 201)

  r = await request('POST', `/api/v1/cells/${cell}/teams/${team}/workers/hello/versions`, {
    versionId: `v-${suffix}`,
    bundleSha256: digest,
    bundleBytes: bundle.byteLength,
    vars: { GREETING: 'hi' },
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  r = await request(
    'POST',
    `/api/v1/cells/${cell}/teams/${team}/workers/hello/versions/v-${suffix}/activate`,
    {}
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  r = await request('POST', `/api/v1/cells/${cell}/publish`, { cause: 'DOCKER_E2E' })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const revision = r.body.data.revision

  r = await request('GET', `/api/internal/clusters/${cell}/vrt/desired`, undefined, auth)
  assert.equal(r.status, 200)
  const envelope = r.body
  assert.equal(envelope.payload.tenants[0].tenantId, team)

  r = await request('GET', `/api/v1/cells/${cell}/publications/${revision}`)
  assert.equal(r.status, 200)
  const pub = r.body.data.publication
  r = await request(
    'POST',
    `/api/internal/clusters/${cell}/vrt/desired/ack`,
    {
      revision,
      payloadDigest: pub.payloadDigest,
      envelopeDigest: pub.envelopeDigest,
      fenceRevision: revision,
      status: 'APPLIED',
      capabilities: { cron: true, assets: true },
      podsApplied: true,
    },
    json
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.data.ackStatus, 'APPLIED')

  r = await request('POST', `/api/v1/cells/${cell}/d1-ops`, {
    databaseId: 'a'.repeat(26),
    kind: 'EXECUTE',
    payload: { sql: 'select 1' },
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const d1OpId = r.body.data.id
  r = await request('GET', `/api/internal/clusters/${cell}/vrt/d1-ops`, undefined, auth)
  const d1Op = r.body.data.ops[0]
  r = await request(
    'POST',
    `/api/internal/clusters/${cell}/vrt/d1-ops/ack`,
    { acks: [{ seq: d1Op.seq, status: 'DONE', result: { ok: true } }] },
    json
  )
  assert.equal(r.body.data.acked, 1)
  r = await request('GET', `/api/v1/cells/${cell}/ops/${d1OpId}?waitMs=1000`)
  assert.equal(r.body.data.op.status, 'DONE')

  r = await request(
    'POST',
    `/api/internal/clusters/${cell}/vrt/logs`,
    {
      podId: 'pod-1',
      bootId: 'boot-1',
      records: [
        {
          seq: 1,
          workerId: `${team}:hello`,
          tsMs: Date.now(),
          level: 'info',
          kind: 'request',
          message: 'hello from docker',
        },
      ],
    },
    json
  )
  assert.equal(r.body.data.accepted, 1)
  r = await request('GET', `/api/v1/cells/${cell}/logs`)
  assert.equal(r.body.data.logs[0].message, 'hello from docker')

  // Service resource path through the real container.
  r = await request('POST', `/api/v1/cells/${cell}/queues`, {
    teamId: team,
    name: 'jobs',
    deliveryDelaySeconds: 5,
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  r = await request('GET', `/api/v1/cells/${cell}/services`)
  assert.equal(r.status, 200)
  assert.equal(r.body.data.queues[0].binding.type, 'queue')

  r = await request('DELETE', `/api/v1/cells/${cell}`)
  assert.equal(r.status, 200)
  console.log(`OK: docker e2e passed (cell ${cell}, revision ${revision})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
