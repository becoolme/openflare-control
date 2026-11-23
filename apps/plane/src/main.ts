import { serve } from '@hono/node-server'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createPlaneStore } from './store.js'
import { createApp } from './routes.js'
import { DirBundleStore } from './bundleStore.js'
import { resolvePlaneSigningKey } from './signing.js'
import { pruneRetention, retentionFromEnv } from './retention.js'

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
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(sql)
  console.log('openflare-plane schema applied at boot')
}
const signing = resolvePlaneSigningKey()
const store = createPlaneStore(pool)
const retention = retentionFromEnv()
const app = createApp({
  store,
  pool,
  bundleStore: new DirBundleStore(env('PLANE_BUNDLE_DIR', './data/bundles')),
  token: env('PLANE_TOKEN'),
  adminToken: process.env.PLANE_ADMIN_TOKEN?.trim() || env('PLANE_TOKEN'),
  signing,
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

const shutdown = async (signal: string): Promise<void> => {
  console.log(`openflare-plane received ${signal}, draining`)
  server.close()
  await pool.end()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
