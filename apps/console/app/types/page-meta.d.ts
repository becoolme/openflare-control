import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { Crumb, NavKey } from '../utils/nav'

declare module '#app' {
  interface PageMeta {
    /** Side navigation entry highlighted for this page. */
    nav?: NavKey
    /** Top bar crumbs after the team and environment switchers. */
    crumbs?: (route: RouteLocationNormalizedLoaded) => Crumb[]
  }
}

export {}
