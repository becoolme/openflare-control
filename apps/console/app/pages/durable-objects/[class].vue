<script setup lang="ts">
import type { DoStatsInfo, InstanceListInfo } from '../../composables/useConsoleApi'

definePageMeta({
  nav: 'DurableObjects',
  crumbs: () => [
    { label: 'storage', to: '/storage' },
    { label: 'durable-objects', to: '/durable-objects' },
  ],
})

const route = useRoute()
const { activeCell } = useCellSelection()
const className = computed(() => decodeURIComponent(String(route.params.class ?? '')))
const { data, pending, error } = await useAsyncData(
  () => `do-class:${activeCell.value}:${className.value}`,
  async () => {
    if (!activeCell.value) return { stats: null, instances: null }
    const cell = encodeURIComponent(activeCell.value)
    const name = encodeURIComponent(className.value)
    const [stats, instances] = await Promise.all([
      consoleApi<DoStatsInfo>(`/api/v1/cells/${cell}/durable-objects/${name}/stats`),
      consoleApi<InstanceListInfo>(`/api/v1/cells/${cell}/durable-objects/${name}/instances`),
    ])
    return { stats, instances }
  },
  { watch: [activeCell, className] }
)
const stats = computed(() => data.value?.stats ?? null)
const instances = computed(() => data.value?.instances ?? null)
const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}
const sampled = computed(() =>
  instances.value?.sampledAt ? new Date(instances.value.sampledAt).toLocaleString() : 'waiting'
)
</script>

<template>
  <div class="wrap pg-durable-object" style="display: flex; flex-direction: column; gap: 20px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center">
          <ResourceBindingChip kind="do" />Storage &amp; Databases · Durable Objects
        </div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em" class="mono">{{ className }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">
          One sqlite file per object id under the declaring worker's <span class="mono">localDisk</span> class dir.
          <span v-if="stats">{{ stats.workers }} worker(s) · {{ stats.bindings }} binding(s).</span>
        </p>
      </div>
      <UiButton to="/durable-objects" variant="secondary"><UiIcon name="chev" :size="13" />All classes</UiButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Instances"><template #value>{{ stats?.instances ?? instances?.total ?? '—' }}</template><UiMetricFoot>{{ instances?.truncated ? 'truncated list' : 'reported objects' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>{{ formatBytes(stats?.storageBytes ?? instances?.storageBytes) }}</template><UiMetricFoot>main files + wal sidecars</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Active now"><template #value>—</template><UiMetricFoot>no liveness index in the runtime</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Sampled"><template #value style="font-size: 15px">{{ sampled }}</template><UiMetricFoot>runtime collection interval</UiMetricFoot></UiMetricCard>
    </div>

    <UiBanner v-if="instances?.waiting" tone="info" icon="info">
      <div>No instance report yet. The cell controller pushes one every collection interval (30 s by default).</div>
    </UiBanner>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <span class="gl">Instances</span>
        <span class="mono dim">{{ instances?.instances.length ?? 0 }} of {{ instances?.total ?? 0 }}</span>
        <div style="flex: 1"></div>
        <span class="hint">{{ stats?.note }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Instance id</th><th>Worker</th><th style="text-align: right">Bytes</th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="3" class="muted" style="padding: 18px">Loading instances…</td></tr>
          <tr v-else-if="error"><td colspan="3" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="!instances?.instances.length"><td colspan="3" class="muted" style="padding: 18px">No instances reported.</td></tr>
          <tr v-for="i in instances?.instances ?? []" :key="i.id">
            <td><div class="mono" style="font-size: 12.5px">{{ i.id }}</div></td>
            <td><span class="wk">{{ i.workerId }}</span></td>
            <td class="num" style="text-align: right">{{ formatBytes(i.bytes) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
