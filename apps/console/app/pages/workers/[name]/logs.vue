<script setup lang="ts">
/** Real logs: plane_logs rows for this worker, polled. Levels and outcomes
 *  come straight from the runtime's invocation records. */
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'logs' }],
})
const route = useRoute()
const name = computed(() => String((route.params as { name?: string }).name))
const { detail, refresh } = useWorkerDetail(name)
const { activeCell } = useCellSelection()

interface LogRow {
  workerId: string
  tsMs: number
  level: string
  kind: string
  message: string | null
  outcome: string | null
  status: number | null
}
const logs = ref<LogRow[]>([])
const loading = ref(true)
const fetchError = ref<string | null>(null)

async function load() {
  if (!activeCell.value || !detail.value?.worker) return
  try {
    const data = await consoleApi<{ logs: LogRow[] }>(
      `/api/v1/cells/${encodeURIComponent(activeCell.value)}/logs?workerId=${encodeURIComponent(detail.value.worker.workerId)}&limit=200`
    )
    logs.value = data.logs
    fetchError.value = null
  } catch (e) {
    fetchError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  await refresh()
  await load()
  timer = setInterval(load, 5000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const fmtTs = (ms: number) => new Date(ms).toLocaleTimeString()
const levelTone = (l: string) => (l === 'error' ? 'err' : l === 'warn' ? 'neu' : undefined)
</script>

<template>
  <section class="card" style="padding: 0">
    <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
      <span class="sec-t" style="font-size: 14px">Logs</span>
      <span class="mono dim" style="font-size: 12px">{{ logs.length }} rows · refreshes every 5s</span>
      <div style="flex: 1"></div>
      <UiButton variant="secondary" size="sm" @click="load"><UiIcon name="redo" :size="12" />Refresh</UiButton>
    </div>
    <div v-if="loading" class="muted" style="padding: 16px">Loading logs…</div>
    <div v-else-if="fetchError" style="padding: 16px; color: var(--err)">{{ fetchError }}</div>
    <div v-else-if="logs.length === 0" class="muted" style="padding: 16px">No invocations recorded yet — hit the worker through its ingress hostname and logs appear here.</div>
    <table v-else class="tbl">
      <thead><tr><th style="width: 100px">Time</th><th style="width: 80px">Level</th><th style="width: 110px">Kind</th><th>Message</th><th style="width: 90px">Outcome</th><th style="width: 70px">Status</th></tr></thead>
      <tbody>
        <tr v-for="(l, i) in logs" :key="i">
          <td class="mono sm">{{ fmtTs(l.tsMs) }}</td>
          <td><UiBadge :tone="levelTone(l.level) ?? 'neu'">{{ l.level }}</UiBadge></td>
          <td class="sm">{{ l.kind }}</td>
          <td class="mono sm" style="word-break: break-all">{{ l.message ?? '—' }}</td>
          <td class="sm">{{ l.outcome ?? '—' }}</td>
          <td class="num">{{ l.status ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
