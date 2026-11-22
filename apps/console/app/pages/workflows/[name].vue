<script setup lang="ts">
import type {
  InstanceListInfo,
  ServiceCatalog,
  WorkflowStatsInfo,
} from '../../composables/useConsoleApi'

definePageMeta({
  nav: 'Workflows',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'workflows', to: '/workflows' }],
})

const route = useRoute()
const { activeCell } = useCellSelection()
const name = computed(() => decodeURIComponent(String(route.params.name ?? '')))
const { data, pending, error } = await useAsyncData(
  () => `workflow:${activeCell.value}:${name.value}`,
  async () => {
    if (!activeCell.value) return null
    const cell = encodeURIComponent(activeCell.value)
    const catalog = await consoleApi<ServiceCatalog>(`/api/v1/cells/${cell}/services`)
    const workflow = catalog.workflows?.find((w) => w.name === name.value)
    if (!workflow) return { workflow: null, stats: null, instances: null }
    const [teamId, ...parts] = workflow.workerId.split(':')
    const worker = parts.join(':')
    const base = `/api/v1/cells/${cell}/teams/${encodeURIComponent(teamId ?? '')}/workers/${encodeURIComponent(worker)}/workflows/${encodeURIComponent(name.value)}`
    const [stats, instances] = await Promise.all([
      consoleApi<WorkflowStatsInfo>(`${base}/stats`),
      consoleApi<InstanceListInfo>(`/api/v1/cells/${cell}/workflows/${encodeURIComponent(name.value)}/instances`),
    ])
    return { workflow, stats, instances }
  },
  { watch: [activeCell, name] }
)
const workflow = computed(() => data.value?.workflow ?? null)
const stats = computed(() => data.value?.stats ?? null)
const instances = computed(() => data.value?.instances ?? null)
const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}
const sampled = computed(() =>
  instances.value?.sampledAt ? new Date(instances.value.sampledAt).toLocaleString() : 'waiting'
)
</script>

<template>
  <div class="wrap pg-workflow" style="display: flex; flex-direction: column; gap: 20px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute · Workflow</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em" class="mono">{{ name }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">
          <span v-if="workflow">Class <span class="mono">{{ workflow.className }}</span> · worker <span class="mono">{{ workflow.workerId }}</span> · </span>
          instances are the engine class-dir sqlite files.
        </p>
      </div>
      <UiButton to="/workflows" variant="secondary"><UiIcon name="chev" :size="13" />All workflows</UiButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Instances"><template #value>{{ stats?.instances ?? instances?.total ?? '—' }}</template><UiMetricFoot>{{ instances?.truncated ? 'truncated list' : 'on this cell' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>{{ formatBytes(stats?.storageBytes ?? instances?.storageBytes) }}</template><UiMetricFoot>all instance files</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Ops"><template #value>{{ stats?.ops ?? '—' }}</template><UiMetricFoot>{{ stats?.pendingOps ?? 0 }} pending · {{ stats?.failedOps ?? 0 }} failed</UiMetricFoot></UiMetricCard>
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
