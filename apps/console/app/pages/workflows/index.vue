<script setup lang="ts">
import type { ServiceCatalog, WorkflowStatsInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'Workflows',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'workflows' }],
})
const { activeCell } = useCellSelection()
const { data, pending, error, refresh } = await useAsyncData(
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
const statsById = ref<Record<string, WorkflowStatsInfo>>({})
let statsSeq = 0
const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}
const totalInstances = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.instances ?? 0), 0)
)
const totalStorage = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.storageBytes ?? 0), 0)
)
const totalOps = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + s.ops, 0)
)
const totalPending = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + s.pendingOps, 0)
)
watch(
  [activeCell, workflows],
  async () => {
    const seq = ++statsSeq
    if (!activeCell.value) {
      statsById.value = {}
      return
    }
    const entries = await Promise.all(
      workflows.value.slice(0, 100).map(async (w) => {
        const [teamId, ...nameParts] = w.workerId.split(':')
        const name = nameParts.join(':')
        try {
          const stats = await consoleApi<WorkflowStatsInfo>(
            `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(teamId ?? '')}/workers/${encodeURIComponent(name)}/workflows/${encodeURIComponent(w.name)}/stats`
          )
          return [w.workflowId, stats] as const
        } catch {
          return [w.workflowId, null] as const
        }
      })
    )
    if (seq !== statsSeq) return
    statsById.value = Object.fromEntries(entries.filter(([, v]) => v)) as Record<
      string,
      WorkflowStatsInfo
    >
  },
  { immediate: true }
)

/* real search */
const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return workflows.value
  return workflows.value.filter(
    (w) =>
      w.name.toLowerCase().includes(q) ||
      w.className.toLowerCase().includes(q) ||
      w.workerId.toLowerCase().includes(q)
  )
})

/* create workflow on a real worker */
const { activeTeam, teams, refresh: refreshTeams } = useTeamSelection()
const action = useAction()
const workersList = ref<WorkerInfo[]>([])
onMounted(async () => {
  if (teams.value.length === 0) void refreshTeams()
  if (activeCell.value) {
    try {
      const data = await consoleApi<{ workers: WorkerInfo[] }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/workers`
      )
      workersList.value = data.workers
    } catch { /* picker stays empty */ }
  }
})
const createOpen = ref(false)
const createName = ref('')
const createClass = ref('')
const createWorker = ref('')
const createError = ref<string | null>(null)
const nameRe = /^[a-z0-9][a-z0-9-]{0,62}$/
async function submitCreate() {
  createError.value = null
  const wfName = createName.value.trim()
  const className = createClass.value.trim()
  const workerName = createWorker.value
  if (!nameRe.test(wfName)) {
    createError.value = 'Workflow name: lowercase letters, digits and dashes.'
    return
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(className)) {
    createError.value = 'Class name must be a valid JS identifier exported by the worker.'
    return
  }
  const worker = workersList.value.find((w) => w.name === workerName)
  if (!worker) {
    createError.value = 'Pick the worker that exports this workflow class.'
    return
  }
  const done = await action.run(
    () =>
      consoleApi(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(worker.teamId)}/workers/${encodeURIComponent(worker.name)}/workflows`,
        { method: 'POST', body: { name: wfName, className } }
      ),
    { success: `workflow ${wfName} created` }
  )
  if (done !== undefined) {
    createOpen.value = false
    createName.value = ''
    createClass.value = ''
    await refresh()
  } else createError.value = 'Create failed.'
}

/* delete via row menu */
const rowMenu = reactive<{ open: boolean; x: number; y: number; item: ServiceCatalog['workflows'][number] | null }>({ open: false, x: 0, y: 0, item: null })
function openRowMenu(event: MouseEvent, it: ServiceCatalog['workflows'][number]) {
  event.preventDefault()
  event.stopPropagation()
  rowMenu.x = Math.min(event.clientX, window.innerWidth - 200)
  rowMenu.y = Math.min(event.clientY, window.innerHeight - 150)
  rowMenu.item = it
  rowMenu.open = true
}
const rowActions = [
  { key: 'open', label: 'Open workflow', icon: 'chev' },
  { key: 'delete', label: 'Delete workflow', icon: 'trash', danger: true },
]
const router = useRouter()
const confirmDelete = ref(false)
function pickRowAction(key: string) {
  const it = rowMenu.item
  rowMenu.open = false
  if (!it) return
  if (key === 'open') void router.push(`/workflows/${encodeURIComponent(it.name)}`)
  if (key === 'delete') confirmDelete.value = true
}
async function submitDelete() {
  const it = rowMenu.item
  if (!it) return
  const [teamId, ...nameParts] = it.workerId.split(':')
  const workerName = nameParts.join(':')
  const done = await action.run(
    () =>
      consoleApi(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(teamId ?? '')}/workers/${encodeURIComponent(workerName)}/workflows/${encodeURIComponent(it.name)}`,
        { method: 'DELETE' }
      ),
    { success: `workflow ${it.name} deleted` }
  )
  if (done !== undefined) {
    confirmDelete.value = false
    await refresh()
  }
}
</script>

<template><div class="wrap pg-workflows-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workflows</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Durable multi-step runs declared with <span class="mono" style="color: var(--t2)">[[workflows]]</span>. Each step is checkpointed; failed steps retry with backoff.</p>
      </div>
      <UiButton variant="primary" @click="createOpen = true"><UiIcon name="plus" />Create workflow</UiButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Workflows"><template #value>{{ workflows.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Instances"><template #value>{{ totalInstances }}</template><UiMetricFoot>{{ formatBytes(totalStorage) }} on disk</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Ops" hint="all time"><template #value>{{ totalOps }}</template><UiMetricFoot>{{ totalPending }} pending</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Per-state counters"><template #value>—</template><UiMetricFoot>the engine has no status index yet</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <UiTabs style="padding: 0 10px">
        <UiTab to="/workers">Workers</UiTab>
        <UiTab active>Workflows <span class="mono dim">{{ workflows.length }}</span></UiTab>
      </UiTabs>
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="width: 280px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input v-model="query" type="search" placeholder="Filter by workflow, class or worker…" aria-label="Filter workflows" style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0" />
        </div>
        <div style="flex: 1"></div>
        <span class="muted" style="font-size: 12.5px">{{ filtered.length }} of {{ workflows.length }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Workflow</th><th>Worker</th><th>Class</th><th style="text-align: right">Instances</th><th style="text-align: right">Storage</th><th style="text-align: right">Ops</th><th style="text-align: right">Pending</th><th>Sampled</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="9" class="muted" style="padding: 18px">Loading workflows…</td></tr>
          <tr v-else-if="error"><td colspan="9" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="workflows.length === 0"><td colspan="9" class="muted" style="padding: 18px">No workflows.</td></tr>
          <tr v-for="w in filtered" :key="w.workflowId" @contextmenu="openRowMenu($event, w)">
            <td><div class="nm"><NuxtLink :to="`/workflows/${encodeURIComponent(w.name)}`">{{ w.name }}</NuxtLink></div><div class="sm">{{ w.workflowId }}</div></td>
            <td><span class="wk">{{ w.workerId }}</span></td>
            <td class="num muted">{{ w.className }}</td>
            <td class="num" style="text-align: right">{{ statsById[w.workflowId]?.instances ?? '—' }}</td>
            <td class="num dim" style="text-align: right">{{ formatBytes(statsById[w.workflowId]?.storageBytes) }}</td>
            <td class="num dim" style="text-align: right">{{ statsById[w.workflowId]?.ops ?? '—' }}</td>
            <td class="num dim" style="text-align: right">{{ statsById[w.workflowId]?.pendingOps ?? '—' }}</td>
            <td class="num muted">{{ statsById[w.workflowId]?.sampledAt ? new Date(statsById[w.workflowId]!.sampledAt!).toLocaleTimeString() : 'waiting' }}</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" @click.stop="openRowMenu($event, w)" /></td>
          </tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>{{ filtered.length }} workflow{{ filtered.length === 1 ? '' : 's' }}</span>
      </div>
    </section>


    <Teleport to="body">
      <div v-if="createOpen" class="dlg-backdrop" @click.self="createOpen = false">
        <div class="dlg" role="dialog" style="width: 440px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Create workflow</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Workflow name</span>
              <input v-model="createName" placeholder="order-pipeline" autofocus style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
            </label>
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Class name (exported by the worker)</span>
              <input v-model="createClass" placeholder="OrderPipeline" class="mono" style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
            </label>
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Worker</span>
              <select v-model="createWorker" style="padding: 8px 10px; background: var(--s1); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none">
                <option value="" disabled>pick a worker…</option>
                <option v-for="w in workersList" :key="w.workerId" :value="w.name">{{ w.name }}</option>
              </select>
            </label>
            <p v-if="createError" style="color: var(--err); font-size: 12.5px; margin: 0">{{ createError }}</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" type="button" @click="createOpen = false">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="action.pending.value">Create</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="confirmDelete" class="dlg-backdrop" @click.self="confirmDelete = false">
        <div class="dlg" role="alertdialog" style="width: 400px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ rowMenu.item?.name }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">Running instances stop. This cannot be undone.</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" @click="confirmDelete = false">Cancel</UiButton>
              <UiButton variant="primary" style="background: var(--err)" :disabled="action.pending.value" @click="submitDelete">Delete</UiButton>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
    <RowMenu v-if="rowMenu.open" :actions="rowActions" :x="rowMenu.x" :y="rowMenu.y" @pick="pickRowAction" @close="rowMenu.open = false" />

  </div></template>
