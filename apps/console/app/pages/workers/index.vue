<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers' }],
})
const overlays = useOverlays(['create', 'row'] as const)
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `workers:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ workers: WorkerInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/workers`
        )
      : Promise.resolve({ workers: [] }),
  { watch: [activeCell] }
)
const workers = computed(() => data.value?.workers ?? [])
const { data: metrics } = await useAsyncData(
  () => `metrics:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<MetricsInfo>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/metrics`
        )
      : Promise.resolve(null),
  { watch: [activeCell] }
)
const errorRate = computed(() => {
  const r = metrics.value?.requests ?? 0
  return r === 0 ? null : ((metrics.value?.errors ?? 0) / r) * 100
})
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} ms`)
// One cell metrics response carries the per-worker breakdown; no N+1 calls.
const workerMetrics = computed<Record<string, WorkerMetricsInfo>>(() =>
  Object.fromEntries((metrics.value?.workers ?? []).map((w) => [w.workerId, w]))
)
const tone = (s: string) => (s === 'ACTIVE' ? 'ok' : s === 'FAILED' ? 'err' : 'neu')
</script>

<template><div class="wrap pg-workers" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workers</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Workers-compatible functions on real <span class="mono" style="color: var(--t2)">workerd</span>. Deploy a <span class="mono" style="color: var(--t2)">wrangler.toml</span> project unchanged; bindings resolve to resources in this team.</p>
      </div>
      <div style="display: flex; gap: 8px; position: relative">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt deploy</UiButton>
        <UiButton variant="primary" @click="overlays.toggle('create')" :aria-expanded="overlays.isOpen('create') ? 'true' : 'false'"><UiIcon name="plus" />Create<span style="opacity: .6; margin-left: 2px"><UiIcon name="chev" :size="13" /></span></UiButton>
        <UiMenu v-if="overlays.isOpen('create')" style="right: 0; top: 40px; width: 300px">
          <UiMenuLabel>New worker</UiMenuLabel>
          <UiMenuItem icon="layers" hint="12" highlighted>Start from a template</UiMenuItem>
          <UiMenuItem icon="github" hint="GitHub">Import a Git repository</UiMenuItem>
          <UiMenuItem icon="upload" hint="≤ 25 MB">Upload project (.zip / dist)</UiMenuItem>
          <UiMenuItem icon="term" hint="copy cmd">Deploy with vrt CLI</UiMenuItem>
          <UiMenuSeparator />
          <UiMenuLabel>Other</UiMenuLabel>
          <UiMenuItem to="/workflows" icon="redo" hint="needs a worker">Workflow</UiMenuItem>
          <UiMenuItem icon="clock" hint="on a worker">Cron trigger</UiMenuItem>
        </UiMenu>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Workers"><template #value>{{ workers.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Requests" hint="24h"><template #value>{{ metrics?.requests ?? 0 }}</template><UiMetricFoot>from the {{ metrics?.source ?? 'logs' }} source</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Error rate" hint="24h"><template #value>{{ errorRate === null ? '—' : errorRate.toFixed(2) + '%' }}</template><UiMetricFoot>{{ metrics?.errors ?? 0 }} errors</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Latency p50 / p99" hint="24h"><template #value>{{ fmtMs(metrics?.latency.p50) }} / {{ fmtMs(metrics?.latency.p99) }}</template><UiMetricFoot>worker wall time</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="CPU / wakes" hint="24h"><template #value>{{ metrics?.cpuMs === null || metrics?.cpuMs === undefined ? '—' : metrics.cpuMs + ' ms' }}</template><UiMetricFoot>{{ metrics?.launches?.ready ?? 0 }} launches · {{ metrics?.coldStarts ?? 0 }} wakes · {{ metrics?.hibernatedTenants === null || metrics?.hibernatedTenants === undefined ? '—' : metrics.hibernatedTenants }} hibernated</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0; position: relative">
      <UiTabs style="padding: 0 10px">
        <UiTab active>Workers <span class="mono dim">27</span></UiTab>
        <UiTab to="/workflows">Workflows <span class="mono dim">6</span></UiTab>
        <UiTab>Cron triggers <span class="mono dim">9</span></UiTab>
        <UiTab>Queue consumers <span class="mono dim">5</span></UiTab>
      </UiTabs>
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by name, route or binding…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All <span class="n">27</span></UiSegment><UiSegment>Live <span class="n">23</span></UiSegment><UiSegment>Errors <span class="n">1</span></UiSegment><UiSegment>Deploying <span class="n">1</span></UiSegment><UiSegment>Idle <span class="n">2</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Binding: any</UiButton>
        <UiButton variant="secondary" size="sm"><UiIcon name="layers" :size="12" />Project: all</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Requests ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Worker</th><th>Status</th><th>Deployment</th><th>Bindings</th><th>Requests 24h</th><th>Errors</th><th>p99 latency</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading workers…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="workers.length === 0"><td colspan="8" class="muted" style="padding: 18px">No workers on {{ activeCell || 'this cell' }}.</td></tr>
          <UiLinkRow v-for="w in workers" :key="w.workerId" :to="`/workers/${encodeURIComponent(w.name)}`" >
            <td><div class="nm"><NuxtLink :to="`/workers/${encodeURIComponent(w.name)}`">{{ w.name }}</NuxtLink></div><div class="sm">{{ w.workerId }}</div></td>
            <td><UiBadge :tone="tone(w.status)" dot>{{ w.status }}</UiBadge></td>
            <td><div class="num">{{ w.activeVersionId || '—' }}</div><div class="sm">{{ w.compatibilityDate }}</div></td>
            <td><span class="sm">entrypoint {{ w.entrypoint }}</span></td>
            <td class="num">{{ workerMetrics[w.workerId]?.requests ?? '—' }}</td>
            <td class="num" :style="workerMetrics[w.workerId]?.errors ? 'color: var(--err)' : ''">{{ workerMetrics[w.workerId]?.errors ?? '—' }}</td>
            <td class="num dim">{{ fmtMs(workerMetrics[w.workerId]?.latency.p99) }}</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>7 of 27 · sorted by requests</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm">Next</UiButton></div>
      </div>
    </section>

    <div style="display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 12px">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Start from a template</span><a href="#" class="muted" style="font-size: 12.5px">All 12 →</a></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">Hello World</div><div class="muted" style="font-size: 12px; margin-top: 3px">fetch handler · TS</div></a>
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">D1 REST API <ResourceBindingChip kind="d1" /></div><div class="muted" style="font-size: 12px; margin-top: 3px">Hono + migrations</div></a>
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">Queue consumer <ResourceBindingChip kind="q" /></div><div class="muted" style="font-size: 12px; margin-top: 3px">batch + DLQ</div></a>
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">Static site <ResourceBindingChip kind="as" /></div><div class="muted" style="font-size: 12px; margin-top: 3px">SPA fallback</div></a>
        </div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Deploy from your terminal</span><UiIconButton icon="copy" :size="13" label="Copy" /></div>
        <div class="code" style="font-size: 12px; padding: 12px 14px"><span class="c"># existing Cloudflare project — no changes</span>{{ "\n" }}<span class="p">$</span> vrt login
<span class="p">$</span> vrt deploy <span class="c">--config wrangler.toml</span>{{ "\n" }}<span class="ok">✓</span> uploaded 3 modules · 41.2 KiB
<span class="ok">✓</span> v43 live on <span class="s">w-checkumi-edge.example.dev</span></div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Usage this month</span><span class="v">Pro · resets Dec 1</span></div>
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px">
          <div><div style="display: flex; justify-content: space-between"><span class="muted">Requests</span><span class="num">61.2M / 100M</span></div><div class="bar"><span style="width: 61%; background: var(--accent)"></span></div></div>
          <div><div style="display: flex; justify-content: space-between"><span class="muted">CPU time</span><span class="num">412 / 1,000 core·h</span></div><div class="bar"><span style="width: 41%; background: var(--t2)"></span></div></div>
          <div><div style="display: flex; justify-content: space-between"><span class="muted">Workers</span><span class="num">27 / 100</span></div><div class="bar"><span style="width: 27%; background: var(--t2)"></span></div></div>
          <div class="muted" style="font-size: 12px">Quota from team plan · <span class="miss"><UiIcon name="warn" :size="10" />no per-worker cap API</span></div>
        </div>
      </section>
    </div>

  </div></template>
