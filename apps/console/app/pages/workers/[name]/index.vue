<script setup lang="ts">
/** Real overview: live worker facts (versions, bindings, vars, hostnames)
 *  plus the worker's slice of the cell metrics. No demo charts — where a
 *  series backend does not exist yet, the console says so instead of
 *  drawing fake data. */
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'overview' }],
})
const route = useRoute()
const name = computed(() => String((route.params as { name?: string }).name))
const { detail, pending, refresh } = useWorkerDetail(name)
const { activeCell } = useCellSelection()
onMounted(() => void refresh())

const worker = computed(() => detail.value?.worker ?? null)

const { data: metrics } = await useAsyncData(
  () => `metrics:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<MetricsInfo>(`/api/v1/cells/${encodeURIComponent(activeCell.value)}/metrics`)
      : Promise.resolve(null),
  { watch: [activeCell] }
)
const workerMetrics = computed(() =>
  (metrics.value?.workers ?? []).find((w) => w.workerId === worker.value?.workerId) ?? null
)
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} ms`)
const errRate = computed(() => {
  const m = workerMetrics.value
  if (!m || !m.requests) return null
  return ((m.errors / m.requests) * 100).toFixed(2) + '%'
})
</script>

<template>
  <div v-if="pending && !detail" class="muted" style="padding: 20px 0">Loading…</div>
  <div v-else-if="worker" style="display: flex; flex-direction: column; gap: 16px">

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Requests" hint="24h"><template #value>{{ workerMetrics?.requests ?? 0 }}</template><UiMetricFoot>this worker</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Errors" hint="24h"><template #value>{{ workerMetrics?.errors ?? 0 }}</template><UiMetricFoot>{{ errRate ?? 'no traffic yet' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="p50 / p99" hint="24h"><template #value>{{ fmtMs(workerMetrics?.latency.p50) }} / {{ fmtMs(workerMetrics?.latency.p99) }}</template><UiMetricFoot>worker wall time</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Versions"><template #value>{{ detail?.versions.length ?? 0 }}</template><UiMetricFoot>{{ worker.activeVersionId ? `live ${worker.activeVersionId.slice(0, 24)}` : 'none active' }}</UiMetricFoot></UiMetricCard>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Configuration</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px">
          <div style="display: flex; justify-content: space-between"><span class="muted">Entrypoint</span><span class="mono">{{ worker.entrypoint }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">Compatibility date</span><span class="mono">{{ worker.compatibilityDate }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">Vars</span><span class="num">{{ detail?.vars.length ?? 0 }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">Secrets</span><span class="num">{{ detail?.secretKeys.length ?? 0 }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">Cache</span><span>{{ detail?.cache?.enabled ? 'enabled' : 'off' }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">Team</span><span class="mono">{{ worker.teamId }}</span></div>
        </div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Hostnames</span><NuxtLink :to="`/workers/${encodeURIComponent(worker.name)}/settings`" class="muted" style="font-size: 12.5px">manage →</NuxtLink></div>
        <div v-if="(detail?.hostnames.length ?? 0) === 0" class="muted" style="font-size: 13px">No hostnames — the worker is unreachable from the ingress.</div>
        <div v-for="h in detail?.hostnames ?? []" :key="h.hostname" style="display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0">
          <span class="mono">{{ h.hostname }}</span>
          <UiBadge :tone="h.status === 'ACTIVE' ? 'ok' : 'neu'" dot>{{ h.status }}</UiBadge>
        </div>
      </section>
    </div>

    <section class="card" style="padding: 16px">
      <div class="ch-h"><span class="t">Traffic series</span></div>
      <p class="muted" style="font-size: 13px; margin: 6px 0 0">
        Time-series storage is not wired into the plane yet — counters above are live aggregates from the cell's metrics feed. When the series API lands this panel graphs them; until then this console does not draw invented data.
      </p>
    </section>

  </div>
</template>
