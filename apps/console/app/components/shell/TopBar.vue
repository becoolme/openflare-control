<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Crumb } from '../../utils/nav'
import ShellLogo from './Logo.vue'

defineProps<{ crumbs: Crumb[] }>()
const { cells, cellId, refresh } = useCellSelection()
const { teams, teamId, refresh: refreshTeams } = useTeamSelection()
onMounted(() => {
  refresh()
  refreshTeams()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const router = useRouter()
const { activeCell } = useCellSelection()
const paletteOpen = ref(false)
const paletteQuery = ref('')
const paletteInput = ref<HTMLInputElement | null>(null)
const paletteWorkers = ref<string[]>([])

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}
watch(paletteOpen, async (openNow) => {
  if (!openNow) return
  paletteQuery.value = ''
  await nextTick()
  paletteInput.value?.focus()
  if (activeCell.value) {
    try {
      const data = await consoleApi<{ workers: { name: string }[] }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/workers`
      )
      paletteWorkers.value = data.workers.map((w) => w.name)
    } catch {
      paletteWorkers.value = []
    }
  }
})

const PAGES = [
  { kind: 'page', label: 'Workers', to: '/workers' },
  { kind: 'page', label: 'D1 databases', to: '/d1' },
  { kind: 'page', label: 'KV namespaces', to: '/kv' },
  { kind: 'page', label: 'R2 buckets', to: '/r2' },
  { kind: 'page', label: 'Queues', to: '/queues' },
  { kind: 'page', label: 'Durable Objects', to: '/durable-objects' },
  { kind: 'page', label: 'Workflows', to: '/workflows' },
  { kind: 'page', label: 'Hyperdrive', to: '/hyperdrive' },
  { kind: 'page', label: 'Storage overview', to: '/storage' },
]
const paletteItems = computed(() => {
  const q = paletteQuery.value.trim().toLowerCase()
  const workerEntries = paletteWorkers.value.map((w) => ({
    kind: 'worker',
    label: w,
    to: `/workers/${encodeURIComponent(w)}`,
  }))
  const all = [...PAGES, ...workerEntries]
  if (!q) return all.slice(0, 12)
  return all.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 12)
})
function go(to: string) {
  paletteOpen.value = false
  void router.push(to)
}
function goFirst() {
  const first = paletteItems.value[0]
  if (first) go(first.to)
}
</script>

<template>
  <header class="top">
    <slot name="logo"><ShellLogo /></slot>
    <span class="sep" aria-hidden="true">/</span>
    <label class="crumb" title="Team">
      <span class="av" style="background: #e8e8ec">{{ (teamId ?? '?')[0]?.toUpperCase() }}</span>
      <select
        v-model="teamId"
        aria-label="Team"
        style="border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer"
      >
        <option v-if="teams.length === 0" :value="null">no team</option>
        <option v-for="t in teams" :key="t.teamId" :value="t.teamId">{{
          t.name ?? t.teamId
        }}</option>
      </select>
    </label>
    <span class="sep" aria-hidden="true">/</span>
    <label class="crumb" title="Cell">
      <span class="st ok" style="font-size: 13.5px"><i></i></span>
      <select
        v-model="cellId"
        aria-label="Cell"
        style="border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer"
      >
        <option v-if="cells.length === 0" :value="null">no cell</option>
        <option v-for="cell in cells" :key="cell.cellId" :value="cell.cellId">
          {{ cell.cellId }}
        </option>
      </select>
    </label>
    <template v-for="(crumb, index) in crumbs" :key="index">
      <span class="sep" aria-hidden="true">/</span>
      <span v-if="index === crumbs.length - 1" class="crumb" style="color: var(--t1)">{{
        crumb.label
      }}</span>
      <NuxtLink v-else-if="crumb.to" :to="crumb.to" class="crumb">{{ crumb.label }}</NuxtLink>
      <span v-else class="crumb">{{ crumb.label }}</span>
    </template>
    <div style="flex: 1; min-width: 12px"></div>
    <button type="button" class="search" @click="paletteOpen = true">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span style="flex: 1">Search or run a command…</span><kbd>⌘K</kbd>
    </button>
    <a
      href="https://github.com/becoolme/openflare-control/tree/main/docs"
      target="_blank"
      rel="noopener"
      class="btn btn-sm"
      style="color: var(--t3)"
      >Docs</a
    >
    <Teleport to="body">
      <div
        v-if="paletteOpen"
        class="dlg-backdrop"
        style="align-items: flex-start; padding-top: 14vh"
        @click.self="paletteOpen = false"
      >
        <div
          class="dlg"
          role="dialog"
          aria-label="Command palette"
          style="width: 520px; overflow: hidden"
        >
          <input
            ref="paletteInput"
            v-model="paletteQuery"
            type="text"
            placeholder="Jump to a page or worker…"
            aria-label="Search"
            style="
              width: 100%;
              padding: 14px 16px;
              background: none;
              border: none;
              border-bottom: 1px solid var(--b1);
              outline: none;
              color: inherit;
              font: inherit;
              font-size: 14px;
              box-sizing: border-box;
            "
            @keydown.escape="paletteOpen = false"
            @keydown.enter="goFirst"
          />
          <div style="max-height: 300px; overflow-y: auto; padding: 6px">
            <a
              v-for="item in paletteItems"
              :key="item.to"
              href="#"
              style="
                display: flex;
                gap: 10px;
                align-items: center;
                padding: 9px 10px;
                border-radius: 6px;
              "
              @click.prevent="go(item.to)"
            >
              <span class="kind mono" style="font-size: 11px; min-width: 64px">{{
                item.kind
              }}</span>{{ item.label }}
            </a>
            <div
              v-if="paletteItems.length === 0"
              class="muted"
              style="padding: 14px 10px; font-size: 13px"
              >No matches.</div
            >
          </div>
        </div>
      </div>
    </Teleport>
  </header>
</template>
