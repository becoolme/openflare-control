import { serve } from '@hono/node-server'
import { Pool } from 'pg'
import { createPlaneStore } from './store.js'
import { createApp } from './routes.js'
import { DirBundleStore } from './bundleStore.js'
import { resolvePlaneSigningKey } from './signing.js'
import { createSecretsCipher } from './secretsCipher.js'
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
  // The signing secret is already a required high-entropy value, so it also
  // roots the at-rest cipher (HKDF under a distinct domain salt — the two
  // keys never collide).
  secrets: createSecretsCipher(env('PLANE_SIGNING_SECRET')),
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
