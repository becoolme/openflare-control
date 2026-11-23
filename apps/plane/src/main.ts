import { serve } from '@hono/node-server'
import { Pool } from 'pg'
import { createPlaneStore } from './store.js'
import { createApp } from './routes.js'
import { DirBundleStore } from './bundleStore.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'
import { DirAssetStore } from './assetStore.js'
import { pruneRetention, retentionFromEnv } from './retention.js'
import { applySchema } from './applySchema.js'

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`${name} is required`)
  return value
}

const port = Number(process.env.PORT ?? 8787)
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be 1..65535')
const maxBundleBytes = Number(process.env.PLANE_MAX_BUNDLE_BYTES ?? 128 * 1024 * 1024)
if (!Number.isSafeInteger(maxBundleBytes) || maxBundleBytes < 1) {
  throw new Error('PLANE_MAX_BUNDLE_BYTES must be a positive integer')
}

const pool = new Pool({ connectionString: env('DATABASE_URL') })
// Schema is fully idempotent (`create table if not exists`), so the plane
// applies it at boot instead of dying with relation errors on first
// request. Operators running a least-privilege DB role opt out with
// PLANE_MIGRATE_ON_BOOT=0 and apply `dist/migrate.js` out-of-band.
if ((process.env.PLANE_MIGRATE_ON_BOOT ?? '1') !== '0') {
  await applySchema(pool)
  console.log('openflare-plane schema applied at boot')
}
const signing = resolvePlaneSigningKey()
const store = createPlaneStore(pool)
const retention = retentionFromEnv()
// The admin API can publish arbitrary code to every cell, so its credential
// must exist and carry real entropy. Cell-channel auth is per-cell
// (plane_cell_tokens) — there is no shared cell token to compromise.
const adminToken = env('PLANE_ADMIN_TOKEN')
if (adminToken.length < 32) {
  throw new Error('PLANE_ADMIN_TOKEN must be at least 32 characters')
}
const secretsKey = env('PLANE_SECRETS_KEY')
if (secretsKey.length < 32) {
  throw new Error('PLANE_SECRETS_KEY must be at least 32 characters')
}
const app = createApp({
  store,
  pool,
  bundleStore: new DirBundleStore(env('PLANE_BUNDLE_DIR', './data/bundles')),
  adminToken,
  signing,
  // Worker secrets get an independent at-rest key: rotating
  // PLANE_SIGNING_SECRET must never make stored secrets unreadable.
  secrets: createSecretsCipher(secretsKey),
  assetStore: new DirAssetStore(env('PLANE_ASSET_DIR', './data/assets')),
  maxBundleBytes,
  retention,
})

console.log(`openflare-plane listening on :${port}`)
console.log(`trustedKeys: keyId=${signing.keyId} publicKey=${signing.publicKey}`)
console.log(
  `retention: logs=${retention.logRetentionDays}d ops=${retention.opsRetentionDays}d ` +
    `publications=${retention.keepPerCell}/cell sweep=${retention.sweepMs}ms`
)
const server = serve({ fetch: app.fetch, port })

if (retention.sweepMs > 0) {
  const timer = setInterval(() => {
    void pruneRetention(pool, store, retention).catch((error) => {
      console.error('[openflare-plane] retention sweep failed:', error)
    })
  }, retention.sweepMs)
  timer.unref()
}

let shuttingDown = false
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`openflare-plane received ${signal}, draining`)
  // server.close() only *starts* the drain. Wait for it to finish before
  // ending the pool: ending the pool first turns in-flight queries into
  // opaque 500s. A bounded force-exit covers a wedged connection instead of
  // hanging the rollout.
  const force = setTimeout(() => process.exit(1), 10_000)
  force.unref()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    // Release keep-alive idles immediately or they pin the drain open.
    // Present on the plain HTTP server; absent on the HTTP/2 variant.
    if ('closeIdleConnections' in server && typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections()
    }
  })
  await pool.end()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
