/**
 * Vars/secrets written through the config API are worker-level hot state:
 * every row must become a binding declaration in the next publication, or
 * the console settings page writes values no worker can ever read.
 */
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createApp } from './routes.js'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'

const url = process.env.DATABASE_URL
const maybe = url ? describe : describe.skip
const TOKEN = 'e2e-admin-token'

class MemoryBundles {
  readonly objects = new Map<string, Uint8Array>()
  async put(key: string, body: Uint8Array) {
    this.objects.set(key, body)
    return { key, sha256: 'x' }
  }
  async get() {
    return null
  }
}

maybe('env keys become bindings in desired state', () => {
  const suffix = Math.random().toString(16).slice(2, 10)
  const cell = `eb-cell-${suffix}`
  const team = `eb-team-${suffix}`
  const worker = `eb-worker-${suffix}`
  const base = `/api/v1/cells/${cell}`
  const json = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  let pool: Pool
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    pool = new Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    app = createApp({
      store: createPlaneStore(pool),
      pool,
      bundleStore: new MemoryBundles() as never,
      adminToken: TOKEN,
      secrets: createSecretsCipher('test-secrets-cipher-key-0001'),
      signing: resolvePlaneSigningKey('e2e-signing-secret-0123456789abcdef'),
    })
    await pool.query(
      'insert into plane_cells (cell_id, cluster_id) values ($1,$1) on conflict (cell_id) do nothing',
      [cell]
    )
    expect((await call('POST', '/api/v1/teams', { teamId: team, name: 'EB' })).status).toBe(201)
    expect((await call('POST', `${base}/workers`, { teamId: team, name: worker })).status).toBe(201)
    const deploy = await call('POST', `${base}/teams/${team}/workers/${worker}/deploy-source`, {
      modules: [
        {
          name: 'main.js',
          type: 'esModule',
          text: 'export default { fetch() { return new Response("x") } }\n',
        },
      ],
    })
    expect(deploy.status).toBe(201)
  })
  afterAll(async () => {
    await pool.end()
  })

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      headers: json,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  interface EnvBinding {
    type: string
    name: string
    varRef?: string
    secretRef?: string
  }

  async function workerBindings(): Promise<EnvBinding[]> {
    const [row] = (
      await pool.query(
        'select envelope from plane_publications where cell_id=$1 order by revision desc limit 1',
        [cell]
      )
    ).rows as {
      envelope: {
        payload: { tenants: { workers: { workerId: string; bindings: EnvBinding[] }[] }[] }
      }
    }[]
    const tenants = row?.envelope.payload.tenants ?? []
    for (const tenant of tenants) {
      for (const w of tenant.workers) {
        if (w.workerId === `${team}:${worker}`) return w.bindings
      }
    }
    return []
  }

  it('synthesizes VAR and SECRET bindings for every env key', async () => {
    expect(
      (await call('PUT', `${base}/teams/${team}/workers/${worker}/vars/MY_VAR`, { value: 'v1' }))
        .status
    ).toBe(200)
    expect(
      (
        await call('PUT', `${base}/teams/${team}/workers/${worker}/secrets/MY_SECRET`, {
          value: 's1',
        })
      ).status
    ).toBe(200)
    const bindings = await workerBindings()
    const varBinding = bindings.find((b) => b.name === 'MY_VAR')
    const secretBinding = bindings.find((b) => b.name === 'MY_SECRET')
    expect(varBinding).toMatchObject({ type: 'var', varRef: 'MY_VAR' })
    expect(secretBinding).toMatchObject({ type: 'secret', secretRef: 'MY_SECRET' })
  })

  it('drops the binding when the key is deleted', async () => {
    expect(
      (await call('DELETE', `${base}/teams/${team}/workers/${worker}/vars/MY_VAR`)).status
    ).toBe(200)
    const bindings = await workerBindings()
    expect(bindings.some((b) => b.name === 'MY_VAR')).toBe(false)
    expect(bindings.some((b) => b.name === 'MY_SECRET')).toBe(true)
  })

  it('does not leak keys across workers', async () => {
    const other = `eb-other-${suffix}`
    expect((await call('POST', `${base}/workers`, { teamId: team, name: other })).status).toBe(201)
    const deploy = await call('POST', `${base}/teams/${team}/workers/${other}/deploy-source`, {
      modules: [
        {
          name: 'main.js',
          type: 'esModule',
          text: 'export default { fetch() { return new Response("y") } }\n',
        },
      ],
    })
    expect(deploy.status).toBe(201)
    const [row] = (
      await pool.query(
        'select envelope from plane_publications where cell_id=$1 order by revision desc limit 1',
        [cell]
      )
    ).rows as {
      envelope: {
        payload: { tenants: { workers: { workerId: string; bindings: EnvBinding[] }[] }[] }
      }
    }[]
    const tenants = row?.envelope.payload.tenants ?? []
    for (const tenant of tenants) {
      for (const w of tenant.workers) {
        if (w.workerId === `${team}:${other}`) {
          expect(w.bindings.some((b) => b.name === 'MY_SECRET')).toBe(false)
        }
      }
    }
  })
})
