<script setup lang="ts">
import type { DoStatsInfo, WorkerInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'DurableObjects',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'durable-objects' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `do:${activeCell.value}`,
  async () => {
    if (!activeCell.value) return { classes: [] as { className: string; workerId: string; versionId: string }[] }
    const { workers } = await consoleApi<{ workers: WorkerInfo[] }>(
      `/api/v1/cells/${encodeURIComponent(activeCell.value)}/workers`
    )
    const rows: { className: string; workerId: string; versionId: string }[] = []
    for (const worker of workers) {
      const detail = await consoleApi<{ classes: string[]; versionId?: string }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(worker.teamId)}/workers/${encodeURIComponent(worker.name)}/durable-objects`
      )
      for (const className of detail.classes)
        rows.push({ className, workerId: worker.workerId, versionId: detail.versionId ?? '' })
    }
    return { classes: rows }
  },
  { watch: [activeCell] }
)
const classes = computed(() => data.value?.classes ?? [])
const statsByClass = ref<Record<string, DoStatsInfo>>({})
let statsSeq = 0
const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}
const totalInstances = computed(() =>
  Object.values(statsByClass.value).reduce((n, s) => n + (s.instances ?? 0), 0)
)
const totalStorage = computed(() =>
  Object.values(statsByClass.value).reduce((n, s) => n + (s.storageBytes ?? 0), 0)
)
watch(
  [activeCell, classes],
  async () => {
    const seq = ++statsSeq
    if (!activeCell.value) {
      statsByClass.value = {}
      return
    }
    const names = [...new Set(classes.value.slice(0, 100).map((c) => c.className))]
    const entries = await Promise.all(
      names.map(async (className) => {
        try {
          const stats = await consoleApi<DoStatsInfo>(
            `/api/v1/cells/${encodeURIComponent(activeCell.value)}/durable-objects/${encodeURIComponent(className)}/stats`
          )
          return [className, stats] as const
        } catch {
          return [className, null] as const
        }
      })
    )
    if (seq !== statsSeq) return
    statsByClass.value = Object.fromEntries(entries.filter(([, v]) => v)) as Record<
      string,
      DoStatsInfo
    >
  },
  { immediate: true }
)

/* real search */
const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return classes.value
  return classes.value.filter(
    (c) => c.className.toLowerCase().includes(q) || c.workerId.toLowerCase().includes(q)
  )
})
</script>

<template><div class="wrap pg-do-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="do" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Durable Objects</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Classes exported by workers and declared in <span class="mono" style="color: var(--t2)">[[durable_objects.bindings]]</span>. Classes come from code; add one by deploying a worker with a new migration.</p>
      </div>
      <NuxtLink to="/workers"><UiButton variant="primary"><UiIcon name="plus" />Deploy via a worker</UiButton></NuxtLink>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Classes"><template #value>{{ classes.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Instances"><template #value>{{ totalInstances }}</template><UiMetricFoot>{{ formatBytes(totalStorage) }} on disk</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Active now"><template #value>—</template><UiMetricFoot>the runtime has no liveness index</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>{{ formatBytes(totalStorage) }}</template><UiMetricFoot>all declared class dirs</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="width: 280px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input v-model="query" type="search" placeholder="Filter by class or worker…" aria-label="Filter classes" style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0" />
        </div>
        <div style="flex: 1"></div>
        <span class="muted" style="font-size: 12.5px">{{ filtered.length }} of {{ classes.length }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Class</th><th>Worker</th><th>Bindings</th><th>Storage backend</th><th style="text-align: right">Instances</th><th style="text-align: right">Active</th><th style="text-align: right">Storage</th><th>Sampled</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="9" class="muted" style="padding: 18px">Loading classes…</td></tr>
          <tr v-else-if="error"><td colspan="9" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="classes.length === 0"><td colspan="9" class="muted" style="padding: 18px">No exported DO classes.</td></tr>
          <tr v-for="c in filtered" :key="c.workerId + ':' + c.className">
            <td><div class="nm"><NuxtLink :to="`/durable-objects/${encodeURIComponent(c.className)}`">{{ c.className }}</NuxtLink></div><div class="sm">{{ c.workerId }}</div></td>
            <td><span class="wk">{{ c.workerId }}</span></td>
            <td class="num dim">{{ statsByClass[c.className]?.bindings ?? '—' }}</td>
            <td><UiBadge tone="neu" dot>{{ c.versionId || 'default' }}</UiBadge></td>
            <td class="num" style="text-align: right">{{ statsByClass[c.className]?.instances ?? '—' }}</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">{{ formatBytes(statsByClass[c.className]?.storageBytes) }}</td>
            <td class="num muted">{{ statsByClass[c.className]?.sampledAt ? new Date(statsByClass[c.className]!.sampledAt!).toLocaleTimeString() : 'waiting' }}</td>
            <td style="text-align: right"><NuxtLink :to="`/durable-objects/${encodeURIComponent(c.className)}`"><UiIcon name="chevr" /></NuxtLink></td>
          </tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>{{ filtered.length }} class{{ filtered.length === 1 ? '' : 'es' }}</span>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Classes are listed from each worker's Durable Object bindings. <span class="miss"><UiIcon name="warn" :size="10" />account-level DO namespace list API</span> Instance counts come from the per-class detail API.</div></UiBanner>

  </div></template>
