import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WORKER_TABS } from '~/fixtures/workers'
import { NAV_FOOTER, NAV_GROUPS } from '~/utils/nav'

// vitest runs from the package root (pnpm -r and the package script both cd there)
const pages = join(process.cwd(), 'app/pages/')

/** Static routes the navigation links to, resolved against the page files. */
const PAGE_FOR: Record<string, string> = {
  '/workers': 'workers/index.vue',
  '/workflows/order-fulfillment': 'workflows/[name].vue',
  '/kv/CHECKUMI_CACHE': 'kv/[namespace].vue',
  '/d1/checkumi-db': 'd1/[db].vue',
  '/r2/checkumi-assets/objects': 'r2/[bucket]/objects/[[...path]].vue',
  '/queues/playtown-events': 'queues/[name].vue',
  '/durable-objects/RoomDO': 'durable-objects/[class].vue',
  '/storage': 'storage.vue',
  '/workers/checkumi-edge/logs': 'workers/[name]/logs.vue',
  '/workers/checkumi-edge/settings': 'workers/[name]/settings.vue',
}

describe('navigation targets', () => {
  it('only links to pages that exist', () => {
    const targets = [...NAV_GROUPS.flatMap((group) => group.items), ...NAV_FOOTER]
      .map((item) => item.to)
      .filter((to): to is string => typeof to === 'string')
    expect(targets.length).toBeGreaterThan(0)
    for (const to of targets) {
      expect(PAGE_FOR[to], to).toBeDefined()
      expect(existsSync(pages + PAGE_FOR[to]), to).toBe(true)
    }
  })

  it('has a page for every worker tab that declares a route', () => {
    for (const tab of WORKER_TABS.filter((item) => item.path !== undefined)) {
      const file = tab.path === '' ? 'index.vue' : `${tab.path!.slice(1)}.vue`
      expect(existsSync(`${pages}workers/[name]/${file}`), tab.label).toBe(true)
    }
  })
})
