import { Hono } from 'hono'
import { type AdminDeps, requireAdmin } from './context.js'
import { registerAssets } from './assets.js'
import { registerBundles } from './bundles.js'
import { registerDoClasses } from './doClasses.js'
import { registerFlagship } from './flagship.js'
import { registerSecretsStore } from './secretsStore.js'
import { registerCells } from './cells.js'
import { registerConfig } from './config.js'
import { registerLogs } from './logs.js'
import { registerOps } from './ops.js'
import { registerPublications } from './publications.js'
import { registerServices } from './services/index.js'
import { registerDoAlarmService } from './doAlarms.js'
import { registerStats } from './stats.js'
import { registerTeams } from './teams.js'
import { registerWorkers } from './workers.js'

export type { AdminDeps } from './context.js'

/**
 * Management API router. Each resource module registers its own routes on the
 * shared `/api/v1` app; auth/parsing/mappers live in `context.ts`.
 */
export function createAdminApp(deps: AdminDeps): Hono {
  const app = new Hono()
  // No cell-token fallback: main.ts refuses to boot without a distinct
  // PLANE_ADMIN_TOKEN, so an absent adminToken means a test wired the app
  // directly — fail closed rather than widen the management surface.
  const expected = deps.adminToken ?? ''
  app.use('/api/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    requireAdmin(c, expected)
    await next()
  })

  registerCells(app, deps)
  registerTeams(app, deps)
  registerWorkers(app, deps)
  registerConfig(app, deps)
  registerAssets(app, deps)
  registerBundles(app, deps)
  registerDoClasses(app, deps)
  registerFlagship(app, deps)
  registerSecretsStore(app, deps)
  registerPublications(app, deps)
  registerServices(app, deps)
  registerDoAlarmService(app, deps)
  registerStats(app, deps)
  registerOps(app, deps)
  registerLogs(app, deps)
  return app
}
