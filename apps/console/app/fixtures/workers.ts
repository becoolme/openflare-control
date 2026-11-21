/** Static worker fixtures until the control-plane API is wired in. */
export const WORKER_NAMES: readonly string[] = ['checkumi-edge']

export interface WorkerTab {
  label: string
  /** Route name of the tab page; undefined while the tab has no design. */
  name?: string
  /** Path below `/workers/:name`; undefined renders a placeholder link. */
  path?: string
  /** Page CSS scope applied to the shared wrap. */
  slug?: string
}

export const WORKER_TABS: readonly WorkerTab[] = [
  { label: 'Overview', name: 'workers-name', path: '', slug: 'worker' },
  { label: 'Metrics' },
  {
    label: 'Deployments',
    name: 'workers-name-deployments',
    path: '/deployments',
    slug: 'worker-deploys',
  },
  { label: 'Logs', name: 'workers-name-logs', path: '/logs', slug: 'worker-logs' },
  { label: 'Bindings' },
  { label: 'Triggers' },
  { label: 'Settings', name: 'workers-name-settings', path: '/settings', slug: 'worker-settings' },
]
