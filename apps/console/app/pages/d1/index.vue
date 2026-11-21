<script setup lang="ts">
import type { D1DatabaseInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'D1',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'd1' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `d1:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ databases: D1DatabaseInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases`
        )
      : Promise.resolve({ databases: [] }),
  { watch: [activeCell] }
)
const databases = computed(() => data.value?.databases ?? [])
</script>

<template><div class="wrap pg-d1-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="d1" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">D1 SQL databases</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">SQLite databases bound with <span class="mono" style="color: var(--t2)">[[d1_databases]]</span>. Each database lives on one node; migrations run from <span class="mono" style="color: var(--t2)">migrations/</span>.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt d1 create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create database</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Databases"><template #value>{{ databases.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>—</template><UiMetricFoot>no D1 stats API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Rows read / written" hint="24h"><template #value>—</template><UiMetricFoot>no D1 metrics API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Migrations"><template #value>{{ databases.length ? 'API' : '—' }}</template><UiMetricFoot>POST /d1/databases/{id}/migrations</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by name, ID or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Migrations"><UiSegment pressed>All <span class="n">9</span></UiSegment><UiSegment>Pending migrations <span class="n">1</span></UiSegment><UiSegment>Unbound <span class="n">1</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Node: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Size ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Database</th><th>Bound by</th><th style="text-align: right">Size</th><th style="text-align: right">Tables</th><th>Migrations</th><th>Node</th><th>Rows read 24h</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading databases…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="databases.length === 0"><td colspan="8" class="muted" style="padding: 18px">No D1 databases.</td></tr>
          <UiLinkRow v-for="db in databases" :key="db.database_id" :to="`/d1/${encodeURIComponent(db.name)}`">
            <td><div class="nm"><NuxtLink :to="`/d1/${encodeURIComponent(db.name)}`">{{ db.name }}</NuxtLink></div><div class="sm">{{ db.database_id }}</div></td>
            <td><span class="wk">{{ db.team_id }}</span></td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td><UiBadge tone="neu" dot>API</UiBadge></td>
            <td class="num muted">{{ db.cluster_id }}</td>
            <td class="num dim">—</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>7 of 9 · sorted by size</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm">Next</UiButton></div>
      </div>
    </section>

  </div></template>
