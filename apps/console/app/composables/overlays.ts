import { reactive } from 'vue'
import { useRoute } from 'vue-router'

/**
 * Open/closed state for a page's menus, drawers and dialogs.
 * Everything starts closed; `?states=open` opens all of them, which reproduces the design boards.
 */
export function useOverlays<K extends string>(keys: readonly K[]) {
  const route = useRoute()
  const initial = route.query.states === 'open'
  const open = reactive(Object.fromEntries(keys.map((key) => [key, initial]))) as Record<K, boolean>
  return {
    isOpen: (key: K) => open[key],
    toggle: (key: K) => {
      open[key] = !open[key]
    },
    close: (key: K) => {
      open[key] = false
    },
  }
}
