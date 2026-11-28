<script setup lang="ts">
/** Real queue detail: live stats from the queue data plane, editable
 *  delivery delay (PATCH), delete. No fake message peeking — the ops
 *  channel does not expose one, and the page says so. */
definePageMeta({
  nav: 'Queues',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'queues', to: '/queues' }, { label: 'queue' }],
})
const route = useRoute()
const qname = computed(() => String((route.params as { name?: string }).name))
const { activeCell } = useCellSelection()
const action = useAction()

const queue = ref<QueueInfo | null>(null)
const stats = ref<QueueStatsInfo | null>(null)
const notFound = ref(false)

async function load() {
  if (!activeCell.value) return
  const data = await consoleApi<{ queues: QueueInfo[] }>(
    `/api/v1/cells/${encodeURIComponent(activeCell.value)}/queues`
  )
  queue.value = data.queues.find((q) => q.name === qname.value) ?? null
  notFound.value = !queue.value
  if (queue.value) {
    try {
      stats.value = await consoleApi<QueueStatsInfo>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/queues/${encodeURIComponent(queue.value.queue_id)}/stats`
      )
    } catch {
      stats.value = null
    }
  }
}
watch(activeCell, (c) => { if (c) void load() }, { immediate: true })

/* delivery delay edit — real PATCH */
const editing = ref(false)
const delayInput = ref(0)
function startEdit() {
  delayInput.value = queue.value?.delivery_delay_seconds ?? 0
  editing.value = true
}
async function saveDelay() {
  if (!queue.value) return
  const done = await action.run(
    () =>
      consoleApi(`/api/v1/cells/${encodeURIComponent(activeCell.value)}/queues/${encodeURIComponent(queue.value!.queue_id)}`, {
        method: 'PATCH',
        body: { deliveryDelaySeconds: delayInput.value },
      }),
    { success: `delivery delay set to ${delayInput.value}s` }
  )
  if (done !== undefined) {
    editing.value = false
    await load()
  }
}

/* delete */
const confirmDelete = ref(false)
const router = useRouter()
async function submitDelete() {
  if (!queue.value) return
  const done = await action.run(() => apiDeleteQueue(activeCell.value, queue.value!.queue_id), {
    success: `queue ${queue.value!.name} deleted`,
  })
  if (done !== undefined) void router.push('/queues')
}

const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n))
const fmtBytes = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`
const fmtAge = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`
</script>

<template><div class="wrap pg-queue" style="display: flex; flex-direction: column; gap: 18px">
    <div v-if="notFound" style="padding: 30px 0">
      <h1 style="font-size: 20px; margin: 0 0 8px">Queue not found</h1>
      <p class="muted" style="font-size: 13.5px">No queue named <span class="mono">{{ qname }}</span> on this cell.</p>
      <NuxtLink to="/queues" style="color: var(--accent); font-size: 13.5px">← Back to queues</NuxtLink>
    </div>
    <template v-else-if="queue">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="q" />Queue</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">{{ queue.name }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px"><span class="mono">{{ queue.queue_id }}</span> · team <span class="mono" style="color: var(--t2)">{{ queue.team_id }}</span></p>
      </div>
      <UiButton variant="secondary" style="color: var(--err)" @click="confirmDelete = true"><UiIcon name="trash" :size="13" />Delete queue</UiButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Backlog"><template #value>{{ fmtNum(stats?.backlog) }}</template><UiMetricFoot>{{ fmtBytes(stats?.backlogBytes) }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="In flight"><template #value>{{ fmtNum(stats?.inFlight) }}</template><UiMetricFoot>{{ fmtNum(stats?.visible) }} visible · {{ fmtNum(stats?.delayed) }} delayed</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Oldest message"><template #value>{{ fmtAge(stats?.oldestMessageAgeMs) }}</template><UiMetricFoot>age of the backlog head</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Dead letter"><template #value>{{ fmtNum(stats?.deadLetterDepth) }}</template><UiMetricFoot>{{ stats?.note ?? 'live from the cell' }}</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 16px">
      <div class="ch-h"><span class="t">Settings</span></div>
      <div style="display: flex; gap: 12px; align-items: center; font-size: 13px">
        <span class="muted">Delivery delay</span>
        <template v-if="editing">
          <input v-model.number="delayInput" type="number" min="0" max="86400" style="width: 90px; padding: 6px 8px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
          <span class="muted">seconds</span>
          <UiButton variant="primary" size="sm" :disabled="action.pending.value" @click="saveDelay">Save</UiButton>
          <UiButton variant="secondary" size="sm" @click="editing = false">Cancel</UiButton>
        </template>
        <template v-else>
          <span class="num">{{ queue.delivery_delay_seconds ?? 0 }}s</span>
          <UiButton variant="secondary" size="sm" @click="startEdit">Edit</UiButton>
        </template>
      </div>
    </section>

    <section class="card" style="padding: 16px">
      <div class="ch-h"><span class="t">Messages</span></div>
      <p class="muted" style="font-size: 13px; margin: 6px 0 0">
        The data plane does not expose message peeking or manual redrive — messages are only visible to consumer workers. Backlog depth and dead-letter counts above are the truthful operational surface.
      </p>
    </section>

    <Teleport to="body">
      <div v-if="confirmDelete" class="dlg-backdrop" @click.self="confirmDelete = false">
        <div class="dlg" role="alertdialog" style="width: 400px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ queue.name }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">Undelivered messages are lost. Producer and consumer bindings break. This cannot be undone.</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" @click="confirmDelete = false">Cancel</UiButton>
              <UiButton variant="primary" style="background: var(--err)" :disabled="action.pending.value" @click="submitDelete">Delete queue</UiButton>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
    </template>
  </div></template>
