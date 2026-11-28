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

/** Side navigation. Every entry links to a real page — an entry whose
 *  page does not exist yet does not exist here either. Counts are loaded
 *  live by the SideNav component, not hardcoded here. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { items: [{ key: 'Overview', label: 'Overview', to: '/' }] },
  {
    heading: 'Compute',
    items: [
      { key: 'Workers', label: 'Workers', to: '/workers' },
      { key: 'Workflows', label: 'Workflows', to: '/workflows' },
    ],
  },
  {
    heading: 'Storage & Databases',
    items: [
      { key: 'KV', label: 'KV', to: '/kv' },
      { key: 'D1', label: 'D1 SQL', to: '/d1' },
      { key: 'R2', label: 'R2 Object Storage', to: '/r2' },
      { key: 'Queues', label: 'Queues', to: '/queues' },
      { key: 'DurableObjects', label: 'Durable Objects', to: '/durable-objects' },
      { key: 'Hyperdrive', label: 'Hyperdrive', to: '/hyperdrive' },
    ],
  },
]

/** Side navigation below the CLI card. */
export const NAV_FOOTER: readonly NavItem[] = []
