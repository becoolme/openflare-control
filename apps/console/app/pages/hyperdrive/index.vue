<script setup lang="ts">
definePageMeta({
  nav: 'Hyperdrive',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'hyperdrive' }],
})
const { activeCell } = useCellSelection()
interface HyperdriveRow {
  hyperdrive_id: string
  team_id: string
  cluster_id: string
  name: string
  origin: string
  caching: boolean
  created_at: string
}
const { data, pending, error } = await useAsyncData(
  () => `hyperdrive:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ hyperdrives: HyperdriveRow[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/hyperdrive`
        )
      : Promise.resolve({ hyperdrives: [] }),
  { watch: [activeCell] }
)
const hyperdrives = computed(() => data.value?.hyperdrives ?? [])
</script>

<template><div class="wrap pg-hyperdrive-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="hd" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Hyperdrive</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Pooled, cached Postgres connections from workers, bound with <span class="mono" style="color: var(--t2)">[[hyperdrive]]</span>. Point a config at a managed database or an external origin.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt hyperdrive create</UiButton>
        <UiButton variant="primary" disabled style="opacity: .5"><UiIcon name="plus" />Create config</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Configs"><template #value>—</template><UiMetricFoot>no Hyperdrive API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Cache hit" hint="24h"><template #value>—</template><UiMetricFoot>no Hyperdrive metrics API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Query p50"><template #value>—</template><UiMetricFoot>no Hyperdrive metrics API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Pooled connections"><template #value>—</template><UiMetricFoot>no Hyperdrive stats API</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by config, origin or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Origin"><UiSegment pressed>All <span class="n">2</span></UiSegment><UiSegment>Managed Postgres <span class="n">1</span></UiSegment><UiSegment>External <span class="n">1</span></UiSegment></UiSegmented>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Name ↑</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Config</th><th>Origin</th><th>Bound by</th><th>Caching</th><th style="text-align: right">Pool</th><th style="text-align: right">Cache hit</th><th style="text-align: right">Query p50</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading Hyperdrive configs…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="hyperdrives.length === 0"><td colspan="8" class="muted" style="padding: 18px">No Hyperdrive configs.</td></tr>
          <tr v-for="h in hyperdrives" :key="h.hyperdrive_id">
            <td><div class="nm">{{ h.name }}</div><div class="sm">{{ h.hyperdrive_id }}</div></td>
            <td><div class="num">{{ h.origin }}</div><div class="sm">{{ h.team_id }}</div></td>
            <td><span class="wk">{{ h.team_id }}</span></td>
            <td><UiBadge :tone="h.caching ? 'ok' : 'neu'" dot>{{ h.caching ? 'ON' : 'OFF' }}</UiBadge></td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td>
          </tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>2 of 2</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Configs are read from worker bindings. <span class="miss"><UiIcon name="warn" :size="10" />config CRUD API</span> <span class="miss"><UiIcon name="warn" :size="10" />config detail page</span> Until they ship, edit configs in <span class="mono">wrangler.toml</span> and redeploy.</div></UiBanner>

  </div></template>
