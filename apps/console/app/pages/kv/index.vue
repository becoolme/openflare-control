<script setup lang="ts">
import type { KvNamespaceInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'KV',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'kv' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `kv:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ namespaces: KvNamespaceInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/kv/namespaces`
        )
      : Promise.resolve({ namespaces: [] }),
  { watch: [activeCell] }
)
const namespaces = computed(() => data.value?.namespaces ?? [])
</script>

<template><div class="wrap pg-kv-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="kv" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">KV namespaces</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Eventually consistent key-value storage. Bind a namespace with <span class="mono" style="color: var(--t2)">[[kv_namespaces]]</span>; the binding name resolves to a namespace in this team.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt kv namespace create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create namespace</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Namespaces"><template #value>{{ namespaces.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Keys"><template #value>—</template><UiMetricFoot>no KV stats API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Reads" hint="24h"><template #value>—</template><UiMetricFoot>no KV metrics API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Writes" hint="24h"><template #value>—</template><UiMetricFoot>no KV metrics API</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by name, ID or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Binding"><UiSegment pressed>All <span class="n">14</span></UiSegment><UiSegment>Bound <span class="n">12</span></UiSegment><UiSegment>Unbound <span class="n">2</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Worker: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Reads ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Namespace</th><th>Bound by</th><th style="text-align: right">Keys</th><th style="text-align: right">Size</th><th>Reads 24h</th><th style="text-align: right">Writes 24h</th><th>Updated</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading namespaces…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="namespaces.length === 0"><td colspan="8" class="muted" style="padding: 18px">No KV namespaces.</td></tr>
          <UiLinkRow v-for="n in namespaces" :key="n.namespace_id" :to="`/kv/${encodeURIComponent(n.namespace_id)}`">
            <td><div class="nm"><NuxtLink :to="`/kv/${encodeURIComponent(n.namespace_id)}`">{{ n.title }}</NuxtLink></div><div class="sm">{{ n.namespace_id }}</div></td>
            <td><span class="wk">{{ n.team_id }}</span></td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num muted">{{ new Date(n.created_at).toLocaleDateString() }}</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>8 of 14 · sorted by reads</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Namespaces are listed from each worker's bindings and merged client-side. <span class="miss"><UiIcon name="warn" :size="10" />account-level KV list API</span> Unbound namespaces appear only after the list API ships.</div></UiBanner>

  </div></template>
