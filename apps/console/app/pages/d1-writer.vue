<script setup lang="ts">
import type { D1DatabaseInfo } from '../composables/useConsoleApi'
definePageMeta({
  nav: 'D1',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'd1', to: '/d1' }, { label: 'writer' }],
})

interface WriterState {
  epoch: number
  addr: string | null
  lsn: number | null
  updatedAt: string | null
}
interface PromotionRow {
  id: string
  seq: number
  status: string
  result: unknown
  error: string | null
  created_at?: string
}
interface WriterDetail {
  writer: WriterState
  promotions: PromotionRow[]
}

const { activeCell } = useCellSelection()
const selected = ref('')
const { data: databases } = await useAsyncData(
  () => `d1-writer:dbs:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ databases: D1DatabaseInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases`
        )
      : Promise.resolve({ databases: [] }),
  { watch: [activeCell] }
)
watch(
  [activeCell, databases],
  () => {
    if (!selected.value && databases.value?.databases[0]) {
      selected.value = databases.value.databases[0].database_id
    }
  },
  { immediate: true }
)
const { data: detail, pending, error, refresh } = await useAsyncData(
  () => `d1-writer:${activeCell.value}:${selected.value}`,
  () =>
    activeCell.value && selected.value
      ? consoleApi<WriterDetail>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases/${encodeURIComponent(selected.value)}/promotions`
        )
      : Promise.resolve(null),
  { watch: [activeCell, selected] }
)
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—')
</script>

<template>
  <div class="wrap pg-d1" style="display: flex; flex-direction: column; gap: 18px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">D1 writer</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Writer &amp; promotions</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Live writer epoch/address and the latest manual/automatic promotion attempts.</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center">
        <select v-model="selected" class="mono" style="padding: 7px 10px; border-radius: 8px; border: 1px solid var(--b1); background: var(--s1); color: var(--t1)">
          <option v-for="db in databases?.databases ?? []" :key="db.database_id" :value="db.database_id">{{ db.name || db.database_id }}</option>
        </select>
        <UiButton variant="secondary" size="sm" @click="refresh()">Refresh</UiButton>
      </div>
    </div>

    <UiError v-if="error" :message="String(error)" />
    <div v-else-if="!activeCell" class="card" style="padding: 18px">Select a cell.</div>
    <div v-else-if="!selected" class="card" style="padding: 18px">No D1 databases on this cell.</div>
    <template v-else-if="detail">
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
        <UiMetricCard label="Writer epoch"><template #value>{{ detail.writer.epoch }}</template><UiMetricFoot>{{ selected }}</UiMetricFoot></UiMetricCard>
        <UiMetricCard label="Writer address"><template #value><span class="mono" style="font-size: 13px">{{ detail.writer.addr || 'static [vrtSql].addr' }}</span></template></UiMetricCard>
        <UiMetricCard label="Writer lsn"><template #value>{{ detail.writer.lsn ?? '—' }}</template></UiMetricCard>
        <UiMetricCard label="Updated"><template #value><span style="font-size: 13px">{{ fmt(detail.writer.updatedAt) }}</span></template></UiMetricCard>
      </div>

      <section class="card" style="padding: 16px 18px">
        <div class="ch-h"><span class="t">Promotions</span><span class="v">{{ detail.promotions.length }} recent</span></div>
        <table class="tbl rg">
          <thead><tr><th>seq</th><th>status</th><th>epoch</th><th>lsn</th><th>created</th><th>error</th></tr></thead>
          <tbody>
            <tr v-if="pending"><td colspan="6" class="muted">Loading…</td></tr>
            <tr v-else-if="detail.promotions.length === 0"><td colspan="6" class="muted">No promotions yet.</td></tr>
            <tr v-for="p in detail.promotions" :key="p.id">
              <td class="dim">{{ p.seq }}</td>
              <td><UiBadge :tone="p.status === 'DONE' ? 'ok' : p.status === 'PENDING' ? 'warn' : 'err'">{{ p.status }}</UiBadge></td>
              <td>{{ (p.result as any)?.epoch ?? '—' }}</td>
              <td>{{ (p.result as any)?.lsn ?? '—' }}</td>
              <td class="mono dim">{{ fmt(p.created_at ?? null) }}</td>
              <td class="err">{{ p.error || '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
