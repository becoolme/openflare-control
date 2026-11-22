<script setup lang="ts">
import type { QueueInfo, QueueStatsInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'Queues',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'queues' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error } = await useAsyncData(
  () => `queues:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ queues: QueueInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/queues`
        )
      : Promise.resolve({ queues: [] }),
  { watch: [activeCell] }
)
const queues = computed(() => data.value?.queues ?? [])
const statsById = ref<Record<string, QueueStatsInfo>>({})
let statsSeq = 0
const totalBacklog = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.backlog ?? 0), 0)
)
const totalInFlight = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.inFlight ?? 0), 0)
)
const totalDead = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.deadLetterDepth ?? 0), 0)
)
const oldest = computed(() => {
  const ages = Object.values(statsById.value)
    .map((s) => s.oldestMessageAgeMs)
    .filter((v): v is number => v !== null)
  return ages.length ? Math.max(...ages) : null
})
const fmtAge = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  return `${(ms / 3_600_000).toFixed(1)} h`
}
watch(
  [activeCell, queues],
  async () => {
    const seq = ++statsSeq
    if (!activeCell.value) {
      statsById.value = {}
      return
    }
    const entries = await Promise.all(
      queues.value.slice(0, 100).map(async (q) => {
        try {
          const stats = await consoleApi<QueueStatsInfo>(
            `/api/v1/cells/${encodeURIComponent(activeCell.value)}/queues/${q.queue_id}/stats`
          )
          return [q.queue_id, stats] as const
        } catch {
          return [q.queue_id, null] as const
        }
      })
    )
    if (seq !== statsSeq) return
    statsById.value = Object.fromEntries(entries.filter(([, v]) => v)) as Record<
      string,
      QueueStatsInfo
    >
  },
  { immediate: true }
)
</script>

<template><div class="wrap pg-queue-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="q" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Queues</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">At-least-once message queues. Producers bind with <span class="mono" style="color: var(--t2)">[[queues.producers]]</span>; one consumer worker per queue, with retries and a dead-letter queue.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt queues create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create queue</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Queues"><template #value>{{ queues.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Backlog"><template #value>{{ totalBacklog }}</template><UiMetricFoot>{{ totalInFlight }} in flight · oldest {{ fmtAge(oldest) }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Delivered" hint="24h"><template #value>—</template><UiMetricFoot>the runtime does not report delivered yet</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="In DLQ" value-style="color: var(--err)"><template #value>{{ totalDead }}</template><UiMetricFoot>dead-letter rows</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by queue or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All <span class="n">7</span></UiSegment><UiSegment>Lagging <span class="n">1</span></UiSegment><UiSegment>No consumer <span class="n">1</span></UiSegment><UiSegment>Dead-letter <span class="n">1</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Worker: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Backlog ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Queue</th><th>Status</th><th>Producers</th><th>Consumer</th><th style="text-align: right">Backlog</th><th>Delivered 24h</th><th style="text-align: right">Oldest</th><th style="text-align: right">DLQ</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="9" class="muted" style="padding: 18px">Loading queues…</td></tr>
          <tr v-else-if="error"><td colspan="9" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="queues.length === 0"><td colspan="9" class="muted" style="padding: 18px">No queues.</td></tr>
          <UiLinkRow v-for="q in queues" :key="q.queue_id" :to="`/queues/${encodeURIComponent(q.name)}`">
            <td><div class="nm"><NuxtLink :to="`/queues/${encodeURIComponent(q.name)}`">{{ q.name }}</NuxtLink></div><div class="sm">{{ q.queue_id }}</div></td>
            <td><UiBadge tone="ok" dot>ACTIVE</UiBadge></td>
            <td><span class="wk">{{ q.team_id }}</span></td>
            <td class="num dim">{{ statsById[q.queue_id]?.consumers ?? '—' }}</td>
            <td class="num dim" style="text-align: right">{{ statsById[q.queue_id]?.backlog ?? '—' }}</td>
            <td class="num dim">{{ statsById[q.queue_id]?.delivered ?? '—' }}</td>
            <td class="num dim" style="text-align: right">{{ fmtAge(statsById[q.queue_id]?.oldestMessageAgeMs) }}</td>
            <td class="num">{{ statsById[q.queue_id]?.deadLetterDepth ?? 0 }} dead · {{ q.delivery_delay_seconds ?? 0 }} s delay</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>7 of 7 · sorted by backlog</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Queues are listed from producer and consumer bindings across workers. <span class="miss"><UiIcon name="warn" :size="10" />account-level Queues list API</span> A queue with no binding is not shown.</div></UiBanner>

  </div></template>
