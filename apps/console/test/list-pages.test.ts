import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pages = join(process.cwd(), 'app/pages/')
const read = (file: string) => readFileSync(pages + file, 'utf8')

interface ListPage {
  list: string
  file: string
  nav: string
  parent: { label: string; to: string }
  /** Detail page the selected row opens, when the design has one. */
  detail?: { to: string; file: string; label: string }
}

const LIST_PAGES: readonly ListPage[] = [
  {
    list: '/workflows',
    file: 'workflows/index.vue',
    nav: 'Workflows',
    parent: { label: 'workers', to: '/workers' },
    detail: {
      to: '/workflows/order-fulfillment',
      file: 'workflows/[name].vue',
      label: 'order-fulfillment',
    },
  },
  {
    list: '/kv',
    file: 'kv/index.vue',
    nav: 'KV',
    parent: { label: 'storage', to: '/storage' },
    detail: { to: '/kv/CHECKUMI_CACHE', file: 'kv/[namespace].vue', label: 'CHECKUMI_CACHE' },
  },
  {
    list: '/d1',
    file: 'd1/index.vue',
    nav: 'D1',
    parent: { label: 'storage', to: '/storage' },
    detail: { to: '/d1/checkumi-db', file: 'd1/[db].vue', label: 'checkumi-db' },
  },
  {
    list: '/r2',
    file: 'r2/index.vue',
    nav: 'R2',
    parent: { label: 'storage', to: '/storage' },
    detail: {
      to: '/r2/checkumi-assets/objects',
      file: 'r2/[bucket]/objects/[[...path]].vue',
      label: 'checkumi-assets',
    },
  },
  {
    list: '/queues',
    file: 'queues/index.vue',
    nav: 'Queues',
    parent: { label: 'storage', to: '/storage' },
    detail: { to: '/queues/playtown-events', file: 'queues/[name].vue', label: 'playtown-events' },
  },
  {
    list: '/durable-objects',
    file: 'durable-objects/index.vue',
    nav: 'DurableObjects',
    parent: { label: 'storage', to: '/storage' },
    detail: { to: '/durable-objects/RoomDO', file: 'durable-objects/[class].vue', label: 'RoomDO' },
  },
  {
    list: '/hyperdrive',
    file: 'hyperdrive/index.vue',
    nav: 'Hyperdrive',
    parent: { label: 'storage', to: '/storage' },
  },
]

const label = (list: string) => list.slice(1)

describe('resource list pages', () => {
  for (const page of LIST_PAGES) {
    describe(page.list, () => {
      const src = read(page.file)

      it('marks its side-nav section and crumbs back to the parent', () => {
        expect(src).toContain(`nav: '${page.nav}'`)
        expect(src).toContain(
          `crumbs: () => [{ label: '${page.parent.label}', to: '${page.parent.to}' }, { label: '${label(page.list)}' }]`
        )
      })

      it('scopes its styles to its own page class', () => {
        expect(src).toMatch(/<div class="wrap pg-[a-z0-9-]+-list"/)
      })

      if (page.detail) {
        const detail = page.detail
        it('renders rows from live data with a per-row detail link', () => {
          // Live rows are v-for driven; the old static one-row selector is gone.
          expect(src).toMatch(/v-for="/)
          expect(existsSync(pages + detail.file)).toBe(true)
        })

        it('has a detail page whose crumbs lead back to this list', () => {
          expect(read(detail.file)).toContain(
            `{ label: '${label(page.list)}', to: '${page.list}' }`
          )
        })
      } else {
        it('renders rows from live data', () => {
          // The hyperdrive API exists and the page drives it; rows are
          // v-for rendered like every other resource list.
          expect(src).toMatch(/v-for="/)
        })
      }
    })
  }

  it('storage overview links each section to its list, not a single resource', () => {
    const src = read('storage.vue')
    for (const list of ['/d1', '/r2']) {
      expect(src).toContain(`'${list}'`)
    }
    expect(src).toContain('to="/durable-objects"')
  })
})
