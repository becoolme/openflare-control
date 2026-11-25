<script setup lang="ts">
import { computed } from 'vue'

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
interface AlarmData {
  updatedAt: string
  snapshot: AlarmSnapshot
}

const props = defineProps<{
  activeCell: string
  data: AlarmData | null
  pending: boolean
  error: string | null
}>()
const emit = defineEmits<{ refresh: [] }>()

const entries = computed(() =>
  [...(props.data?.snapshot.entries ?? [])].sort((a, b) => a.atMs - b.atMs)
)
const fmt = (v: number | string) => new Date(v).toLocaleString()
</script>

<template>
  <div class="wrap" style="display: flex; flex-direction: column; gap: 18px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Durable Objects</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">
          Alarm index
        </h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">
          Cell-reported earliest alarms and classes whose scan could not be trusted.
        </p>
      </div>
      <UiButton variant="secondary" size="sm" @click="emit('refresh')">Refresh</UiButton>
    </div>

    <UiError v-if="props.error" :message="props.error" />
    <div v-else-if="!props.activeCell" class="card" style="padding: 18px">Select a cell.</div>
    <div v-else-if="props.pending" class="card" style="padding: 18px">Loading…</div>
    <div v-else-if="!props.data" class="card" style="padding: 18px">
      No alarm snapshot reported by this cell yet.
    </div>
    <template v-else>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
        <UiMetricCard label="Known alarms">
          <template #value>{{ props.data.snapshot.entries.length }}</template>
        </UiMetricCard>
        <UiMetricCard label="Observed classes">
          <template #value>{{ props.data.snapshot.observed.length }}</template>
        </UiMetricCard>
        <UiMetricCard label="Unknown classes">
          <template #value>{{ props.data.snapshot.unknown.length }}</template>
        </UiMetricCard>
        <UiMetricCard label="Truncated classes">
          <template #value>{{ props.data.snapshot.truncated.length }}</template>
        </UiMetricCard>
      </div>
      <div class="muted" style="font-size: 12.5px">
        Snapshot updated {{ fmt(props.data.updatedAt) }}
      </div>

      <section class="card" style="padding: 16px 18px">
        <div class="ch-h">
          <span class="t">Earliest alarms</span>
          <span class="v">{{ entries.length }}</span>
        </div>
        <table class="tbl rg">
          <thead>
            <tr>
              <th>at</th>
              <th>tenant</th>
              <th>worker</th>
              <th>class</th>
              <th>object</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="entries.length === 0">
              <td colspan="5" class="muted">No pending alarms.</td>
            </tr>
            <tr v-for="e in entries" :key="`${e.tenantId}:${e.classKey}:${e.objectId}`">
              <td class="mono">{{ fmt(e.atMs) }}</td>
              <td>{{ e.tenantId }}</td>
              <td class="mono">{{ e.workerId }}</td>
              <td class="mono dim">{{ e.classKey.slice(0, 12) }}…</td>
              <td class="mono dim">{{ e.objectId.slice(0, 12) }}…</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section
        v-if="props.data.snapshot.unknown.length || props.data.snapshot.truncated.length"
        class="card"
        style="padding: 16px 18px"
      >
        <div class="ch-h"><span class="t">Unsafe classes</span></div>
        <div
          v-for="c in props.data.snapshot.unknown"
          :key="`u:${c.tenantId}:${c.classKey}`"
          class="mig"
        >
          <UiBadge tone="err">unknown</UiBadge>
          <span class="mono">
            {{ c.tenantId }} / {{ c.workerId }} / {{ c.classKey.slice(0, 12) }}…
          </span>
        </div>
        <div
          v-for="c in props.data.snapshot.truncated"
          :key="`t:${c.tenantId}:${c.classKey}`"
          class="mig"
        >
          <UiBadge tone="warn">truncated</UiBadge>
          <span class="mono">
            {{ c.tenantId }} / {{ c.workerId }} / {{ c.classKey.slice(0, 12) }}…
          </span>
        </div>
      </section>
    </template>
  </div>
</template>
