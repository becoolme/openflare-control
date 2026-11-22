<script setup lang="ts">
import { useRouter, type RouteLocationRaw } from 'vue-router'

/**
 * A table row that opens `to` when clicked anywhere outside its own controls.
 * The row's name keeps a real link, so keyboard focus and middle-click still go through it.
 */
const props = defineProps<{ to: RouteLocationRaw }>()
const router = useRouter()

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"]'

function open(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    window.open(router.resolve(props.to).href, '_blank', 'noopener')
    return
  }
  void router.push(props.to)
}
</script>

<template>
  <tr @click="open"><slot /></tr>
</template>

<style scoped>
tr {
  cursor: pointer;
}
</style>
