/**
 * Minimal deploy path: create/ensure a worker + version and publish a
 * signed desired snapshot. Usage:
 *   tsx src/seed.ts --cluster <cell> --team <team> --name <worker> \
 *       --version <ver> --digest <sha256> [--var KEY=VALUE]... [--secret KEY]...
 *       [--hostname h]
 * Secret values are read from SEED_SECRET_<KEY> so they never touch argv,
 * `ps` output or shell history.
 */
import { Pool } from 'pg'
import { createPlaneStore } from './store.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'
import { publishCell } from './publish.js'
import { envSecret } from './envSecret.js'

const args = process.argv.slice(2)
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const all = (name: string): string[] => {
  const out: string[] = []
  args.forEach((a, i) => a === `--${name}` && args[i + 1] && out.push(args[i + 1]!))
  return out
}

const cluster = opt('cluster')!
const team = opt('team')!
const name = opt('name')!
const versionId = opt('version')!
const digest = opt('digest')!
if (!cluster || !team || !name || !versionId || !digest) {
  throw new Error('--cluster --team --name --version --digest are required')
}
if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('--digest must be a 64-hex sha256')
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(cluster))
  throw new Error('--cluster must be a DNS-safe cell id')

const pool = new Pool({ connectionString: process.env.DATABASE_URL! })
const store = createPlaneStore(pool)
try {
  const workerId = `${team}:${name}`
  await pool.query(
    `insert into plane_workers (id, team_id, cluster_id, name)
     values ($1,$2,$3,$4) on conflict (team_id, cluster_id, name) do nothing`,
    [workerId, team, cluster, name]
  )
  const [worker] = (
    await pool.query(
      'select id from plane_workers where team_id=$1 and cluster_id=$2 and name=$3',
      [team, cluster, name]
    )
  ).rows as { id: string }[]
  await store.registerBundleObject({ digest, bytes: 0 })
  const { version } = await store.createVersionWithBindings({
    workerId: worker!.id,
    versionId,
    bundleSha256: digest,
    bundleKey: `workers/v1/bundles/${digest}`,
    bundleBytes: 0,
    mainModule: 'index.js',
    modules: [],
    compatibilityDate: '2024-01-01',
    compatibilityFlags: [],
    crons: [],
    quotas: { cpuMs: 50, memoryMb: 128, subrequests: 50, outboundConnections: 16 },
    varValues: {},
    bindingsFingerprint: digest.slice(0, 32),
    runtimeConfigDigest: digest,
    bindings: [],
    createdById: 'plane',
  })
  for (const kv of all('var')) {
    const [key, ...rest] = kv.split('=')
    await pool.query(
      `insert into plane_vars (worker_id, key, value) values ($1,$2,$3)
       on conflict (worker_id, key) do update set value=excluded.value`,
      [worker!.id, key, rest.join('=')]
    )
  }
  const secretKeys = all('secret')
  if (secretKeys.length > 0) {
    const secretsKey = envSecret('PLANE_SECRETS_KEY')
    if (!secretsKey || secretsKey.length < 32) {
      throw new Error('PLANE_SECRETS_KEY must be at least 32 characters when --secret is used')
    }
    const secretsCipher = createSecretsCipher(secretsKey)
    for (const key of secretKeys) {
      // KEY=VALUE on argv would leak the value into `ps` and shell history —
      // the value comes from the environment only.
      if (key.includes('=')) {
        throw new Error('--secret takes a KEY only; export SEED_SECRET_<KEY>=<value> instead')
      }
      const value = process.env[`SEED_SECRET_${key}`]
      if (value === undefined) {
        throw new Error(`SEED_SECRET_${key} is required for --secret ${key}`)
      }
      await pool.query(
        `insert into plane_secrets (worker_id, key, value) values ($1,$2,$3)
         on conflict (worker_id, key) do update set value=excluded.value`,
        [worker!.id, key, secretsCipher.encrypt(value)]
      )
    }
  }
  for (const hostname of all('hostname')) {
    await pool.query(
      `insert into plane_hostnames (id, hostname, worker_id) values ($1,$2,$3)
       on conflict (hostname, worker_id) do nothing`,
      [`${worker!.id}:${hostname}`, hostname, worker!.id]
    )
  }
  await store.runCellTransaction(cluster, (tx) => tx.activateVersion(worker!.id, version.versionId))
  const published = await publishCell(store, {
    cellId: cluster,
    signing: resolvePlaneSigningKey(),
    workerId: worker!.id,
    versionId: version.versionId,
  })
  console.log(`published revision ${published} for ${cluster}`)
} finally {
  await pool.end()
}
