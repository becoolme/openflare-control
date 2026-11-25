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
</script>

<template>
  <D1WriterView
    v-model:selected="selected"
    :active-cell="activeCell"
    :databases="databases?.databases"
    :detail="detail ?? null"
    :pending="pending"
    :error="error ? String(error) : null"
    @refresh="refresh()"
  />
</template>
