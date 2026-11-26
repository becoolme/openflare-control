// All-in-one cell bootstrap — runs once inside the plane image (as root)
// before the cell stack starts. It provisions the cell + its pull token,
// renders the four service configs with the signing key/cell id, and
// seeds the shared secrets and directories on the cell-run volume.
// Idempotent: existing files are never overwritten (no silent rotation).

import { readFile, writeFile, mkdir, chown, access } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const PLANE_URL = process.env.PLANE_URL ?? 'http://plane:8787'
// M9: compose secrets arrive as `<NAME>_FILE`; fall back to the env name.
const secret = (name) => {
  const file = process.env[`${name}_FILE`]
  if (file) {
    const value = readFileSync(file, 'utf8').trim()
    if (!value) throw new Error(`${name}_FILE is empty`)
    return value
  }
  return process.env[name]
}
const ADMIN = secret('PLANE_ADMIN_TOKEN')
const CELL = process.env.VRT_CELL_ID ?? 'local'
const R2_BUCKET = process.env.VRT_R2_BUCKET ?? 'vrt-r2'
const CIDR = process.env.VRT_TRUSTED_CIDR ?? '172.31.42.250/32'
const VRT_UID = 10001
const VRT_GID = 10001
const RUN = '/run/vrt'
const CONF_IN = '/init/config'
const CONF_OUT = '/etc/vrt'
if (!ADMIN) throw new Error('PLANE_ADMIN_TOKEN is required')

const api = async (method, path, body) => {
  const res = await fetch(`${PLANE_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// Plane boot runs the schema first; poll until it answers.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${PLANE_URL}/healthz`)).ok) break
  } catch {
    // plane still booting — retry below
  }
  if (i > 120) throw new Error('plane healthz timed out')
  await new Promise((r) => setTimeout(r, 1000))
}

let r = await api('POST', '/api/v1/cells', { cellId: CELL })
if (r.status !== 201 && r.status !== 200) {
  throw new Error(`create cell ${CELL}: HTTP ${r.status}`)
}

// The signing public key derives from PLANE_SIGNING_SECRET via the same
// module the plane uses — no separate trust source to keep in sync.
const { resolvePlaneSigningKey } = await import('/app/dist/signing.js')
const key = resolvePlaneSigningKey(secret('PLANE_SIGNING_SECRET'))

const writeOnce = async (path, content, mode, uid = VRT_UID) => {
  try {
    await access(path)
    return // never rotate silently
  } catch {
    // absent — write it
  }
  await writeFile(path, content, { mode })
  await chown(path, uid, VRT_GID)
}

// Render the four configs: cell id + signing key + trusted proxy CIDR.
for (const name of ['vrt-host', 'vrt-provider', 'vrt-sql', 'cell-controller']) {
  let t = await readFile(`${CONF_IN}/${name}.toml`, 'utf8')
  t = t
    .replaceAll('__CELL_ID__', CELL)
    .replaceAll('__KEY_ID__', key.keyId)
    .replaceAll('__PUBKEY__', key.publicKey)
    .replaceAll('__TRUSTED_CIDR__', CIDR)
    .replaceAll('__R2_BUCKET__', R2_BUCKET)
  await writeFile(`${CONF_OUT}/${name}.toml`, t, { mode: 0o644 })
}

// Shared dirs + 0600 secrets + empty render-inputs seeds (honest
// "nothing yet" — the controller's first pull overwrites them).
for (const d of ['secrets', 'pod-delivery', 'render-inputs', 'listeners']) {
  await mkdir(`${RUN}/${d}`, { recursive: true, mode: 0o700 })
  await chown(`${RUN}/${d}`, VRT_UID, VRT_GID)
}
if (
  !(await access(`${RUN}/secrets/cell-token`).then(
    () => true,
    () => false
  ))
) {
  r = await api('POST', `/api/v1/cells/${CELL}/token`)
  if (r.status !== 201 || !r.body?.data?.token) {
    throw new Error(`issue cell token: HTTP ${r.status}`)
  }
  await writeOnce(`${RUN}/secrets/cell-token`, `${r.body.data.token}\n`, 0o600)
}
for (const s of ['vrt-sql-auth-secret', 'vrt-sql-bookmark-secret', 'cursor-secret']) {
  await writeOnce(`${RUN}/secrets/${s}`, `${randomBytes(32).toString('hex')}\n`, 0o600)
}
for (const f of ['render-inputs.json', 'pg-credentials.json']) {
  await writeOnce(`${RUN}/render-inputs/${f}`, '{"vars":{},"secrets":{}}', 0o600)
}
console.log(`all-in-one init: cell ${CELL} ready (key ${key.keyId})`)
