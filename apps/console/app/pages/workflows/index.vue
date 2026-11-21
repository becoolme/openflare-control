<script setup lang="ts">
import type { ServiceCatalog } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'Workflows',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'workflows' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `workflows:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<ServiceCatalog>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/services`
        )
      : Promise.resolve({ workflows: [] } as unknown as ServiceCatalog),
  { watch: [activeCell] }
)
const workflows = computed(() => data.value?.workflows ?? [])
</script>

<template><div class="wrap pg-workflows-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workflows</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Durable multi-step runs declared with <span class="mono" style="color: var(--t2)">[[workflows]]</span>. Each step is checkpointed; failed steps retry with backoff.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt workflows list</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Workflows"><template #value>{{ workflows.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Running / waiting"><template #value>—</template><UiMetricFoot>no workflow metrics API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Complete" hint="24h"><template #value>—</template><UiMetricFoot>no workflow metrics API</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Errored" hint="24h" value-style="color: var(--err)"><template #value>—</template><UiMetricFoot>no workflow metrics API</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <UiTabs style="padding: 0 10px">
        <UiTab to="/workers">Workers <span class="mono dim">27</span></UiTab>
        <UiTab active>Workflows <span class="mono dim">6</span></UiTab>
        <UiTab>Cron triggers <span class="mono dim">9</span></UiTab>
        <UiTab>Queue consumers <span class="mono dim">5</span></UiTab>
      </UiTabs>
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by workflow, class or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All <span class="n">6</span></UiSegment><UiSegment>Running <span class="n">3</span></UiSegment><UiSegment>Errored 24h <span class="n">2</span></UiSegment><UiSegment>Idle <span class="n">1</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Worker: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Last run ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Workflow</th><th>Worker</th><th>Class</th><th style="text-align: right">Running</th><th style="text-align: right">Waiting</th><th style="text-align: right">Complete 24h</th><th style="text-align: right">Errored 24h</th><th>Last run</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="9" class="muted" style="padding: 18px">Loading workflows…</td></tr>
          <tr v-else-if="error"><td colspan="9" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="workflows.length === 0"><td colspan="9" class="muted" style="padding: 18px">No workflows.</td></tr>
          <tr v-for="w in workflows" :key="w.workflowId">
            <td><div class="nm">{{ w.name }}</div><div class="sm">{{ w.workflowId }}</div></td>
            <td><span class="wk">{{ w.workerId }}</span></td>
            <td class="num muted">{{ w.className }}</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num dim" style="text-align: right">—</td>
            <td class="num muted">{{ w.teamId }}</td>
            <td style="text-align: right"><UiIcon name="chevr" /></td>
          </tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>6 of 6 · sorted by last run</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

  </div></template>
