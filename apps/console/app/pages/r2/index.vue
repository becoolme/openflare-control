<script setup lang="ts">
import type { R2BucketInfo, R2StatsInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'R2',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'r2' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `r2:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ buckets: R2BucketInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/r2/buckets`
        )
      : Promise.resolve({ buckets: [] }),
  { watch: [activeCell] }
)
const buckets = computed(() => data.value?.buckets ?? [])
const statsById = ref<Record<string, R2StatsInfo>>({})
const refreshing = ref(false)
const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}
const totalObjects = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.objects ?? 0), 0)
)
const totalBytes = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.sizeBytes ?? 0), 0)
)
const totalClassA = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + s.classAOps, 0)
)
const totalClassB = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + s.classBOps, 0)
)
async function loadStats(waitMs: number) {
  if (!activeCell.value || buckets.value.length === 0) {
    statsById.value = {}
    return
  }
  refreshing.value = waitMs > 0
  try {
    const entries = await Promise.all(
      buckets.value.map(async (b) => {
        try {
          const stats = await consoleApi<R2StatsInfo>(
            `/api/v1/cells/${encodeURIComponent(activeCell.value)}/r2/buckets/${encodeURIComponent(b.bucket_name)}/stats?waitMs=${waitMs}`
          )
          return [b.bucket_id, stats] as const
        } catch {
          return [b.bucket_id, null] as const
        }
      })
    )
    statsById.value = Object.fromEntries(entries.filter(([, v]) => v)) as Record<string, R2StatsInfo>
  } finally {
    refreshing.value = false
  }
}
watch([activeCell, buckets], () => loadStats(0), { immediate: true })
</script>

<template><div class="wrap pg-r2-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="r2" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">R2 buckets</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">S3-compatible object storage bound with <span class="mono" style="color: var(--t2)">[[r2_buckets]]</span>. Buckets are served by the cluster's MinIO; no egress fees between workers and buckets.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt r2 bucket create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create bucket</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Buckets"><template #value>{{ buckets.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Objects"><template #value>{{ totalObjects }}</template><UiMetricFoot>{{ formatBytes(totalBytes) }} · bounded list scan</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Class A / B ops" hint="24h"><template #value>{{ totalClassA }} / {{ totalClassB }}</template><UiMetricFoot>from the control-plane op ledger</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Public buckets"><template #value>—</template><UiMetricFoot><span class="miss"><UiIcon name="warn" :size="10" />no public URL API</span></UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by bucket or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Binding"><UiSegment pressed>All <span class="n">5</span></UiSegment><UiSegment>Bound <span class="n">4</span></UiSegment><UiSegment>Unbound <span class="n">1</span></UiSegment></UiSegmented>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm" :disabled="refreshing" @click="loadStats(8000)"><UiIcon name="updown" :size="12" />{{ refreshing ? 'Refreshing…' : 'Refresh stats' }}</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Bucket</th><th>Bound by</th><th style="text-align: right">Objects</th><th style="text-align: right">Size</th><th>Public access</th><th style="text-align: right">Class A / B 24h</th><th>Node</th><th>Created</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="9" class="muted" style="padding: 18px">Loading buckets…</td></tr>
          <tr v-else-if="error"><td colspan="9" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="buckets.length === 0"><td colspan="9" class="muted" style="padding: 18px">No R2 buckets.</td></tr>
          <UiLinkRow v-for="b in buckets" :key="b.bucket_name" :to="`/r2/${encodeURIComponent(b.bucket_name)}/objects`">
            <td><div class="nm"><NuxtLink :to="`/r2/${encodeURIComponent(b.bucket_name)}/objects`">{{ b.bucket_name }}</NuxtLink></div><div class="sm">{{ b.bucket_id }}</div></td>
            <td><span class="wk">{{ b.team_id }}</span></td>
            <td class="num dim" style="text-align: right">{{ statsById[b.bucket_id]?.objects ?? '—' }}</td>
            <td class="num dim" style="text-align: right">{{ formatBytes(statsById[b.bucket_id]?.sizeBytes) }}</td>
            <td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td>
            <td class="num dim" style="text-align: right">{{ statsById[b.bucket_id]?.classAOps ?? '—' }} / {{ statsById[b.bucket_id]?.classBOps ?? '—' }}</td>
            <td class="num muted">{{ b.cluster_id }}</td>
            <td class="num muted">{{ new Date(b.created_at).toLocaleDateString() }}</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>5 of 5 · sorted by size</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

  </div></template>
