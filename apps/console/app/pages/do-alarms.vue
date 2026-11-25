<script setup lang="ts">
definePageMeta({
  nav: 'DurableObjects',
  crumbs: () => [{ label: 'durable objects', to: '/durable-objects' }, { label: 'alarms' }],
})

interface AlarmClassRef {
  tenantId: string
  workerId: string
  classKey: string
}
interface AlarmEntry extends AlarmClassRef {
  objectId: string
  atMs: number
  observedAtMs: number
}
interface AlarmSnapshot {
  entries: AlarmEntry[]
  unknown: AlarmClassRef[]
  truncated: AlarmClassRef[]
  observed: AlarmClassRef[]
}

const { activeCell } = useCellSelection()
const { data, pending, error, refresh } = await useAsyncData(
  () => `do-alarms:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ updatedAt: string; snapshot: AlarmSnapshot }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/do-alarms`
        )
      : Promise.resolve(null),
  { watch: [activeCell] }
)
</script>

<template>
  <DoAlarmsView
    :active-cell="activeCell"
    :data="data ?? null"
    :pending="pending"
    :error="error ? String(error) : null"
    @refresh="refresh()"
  />
</template>
