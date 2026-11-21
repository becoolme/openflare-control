import type { RouteLocationRaw } from 'vue-router'
import type { NavIconName } from './icons'

export type NavKey = NavIconName

export interface NavItem {
  key: NavKey
  label: string
  count?: number
  /** Undefined when the design has no page for this section yet. */
  to?: RouteLocationRaw
}

export interface NavGroup {
  heading?: string
  items: NavItem[]
}

export interface Crumb {
  label: string
  to?: RouteLocationRaw
}

/** Side navigation of the v3 design, top section (above the CLI card). */
export const NAV_GROUPS: readonly NavGroup[] = [
  { items: [{ key: 'Overview', label: 'Overview' }] },
  {
    heading: 'Compute',
    items: [
      { key: 'Workers', label: 'Workers', count: 27, to: '/workers' },
      { key: 'Workflows', label: 'Workflows', count: 6, to: '/workflows/order-fulfillment' },
    ],
  },
  {
    heading: 'Storage & Databases',
    items: [
      { key: 'KV', label: 'KV', count: 14, to: '/kv/CHECKUMI_CACHE' },
      { key: 'D1', label: 'D1 SQL', count: 9, to: '/d1/checkumi-db' },
      { key: 'R2', label: 'R2 Object Storage', count: 5, to: '/r2/checkumi-assets/objects' },
      { key: 'Queues', label: 'Queues', count: 7, to: '/queues/playtown-events' },
      { key: 'DurableObjects', label: 'Durable Objects', count: 4, to: '/durable-objects/RoomDO' },
      { key: 'Hyperdrive', label: 'Hyperdrive', count: 2, to: '/storage' },
    ],
  },
  {
    heading: 'Observability',
    items: [
      { key: 'Logs', label: 'Logs', to: '/workers/checkumi-edge/logs' },
      { key: 'Metrics', label: 'Metrics' },
    ],
  },
  {
    heading: 'Network',
    items: [
      {
        key: 'Domains',
        label: 'Domains & Routes',
        count: 31,
        to: '/workers/checkumi-edge/settings',
      },
    ],
  },
]

/** Side navigation below the CLI card. */
export const NAV_FOOTER: readonly NavItem[] = [
  { key: 'Tokens', label: 'API Tokens' },
  { key: 'Settings', label: 'Settings' },
]
