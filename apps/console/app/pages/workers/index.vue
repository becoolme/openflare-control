<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers' }],
})

const overlays = useOverlays(['create', 'confirmDelete'] as const)
const { activeCell } = useCellSelection()
const { activeTeam, teams, refresh: refreshTeams } = useTeamSelection()
const action = useAction()

const { data, pending, error, refresh } = await useAsyncData(
  () => `workers:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ workers: WorkerInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/workers`
        )
      : Promise.resolve({ workers: [] }),
  { watch: [activeCell] }
)
const workers = computed(() => data.value?.workers ?? [])

const { data: metrics } = await useAsyncData(
  () => `metrics:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<MetricsInfo>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/metrics`
        )
      : Promise.resolve(null),
  { watch: [activeCell] }
)
const errorRate = computed(() => {
  const r = metrics.value?.requests ?? 0
  return r === 0 ? null : ((metrics.value?.errors ?? 0) / r) * 100
})
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} ms`)
const workerMetrics = computed<Record<string, WorkerMetricsInfo>>(() =>
  Object.fromEntries((metrics.value?.workers ?? []).map((w) => [w.workerId, w]))
)
const tone = (s: string) => (s === 'ACTIVE' ? 'ok' : s === 'FAILED' ? 'err' : 'neu')

/* ---------- real search / status filter / sort / pagination ---------- */
const query = ref('')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'FAILED' | 'OTHER'>('ALL')
const sortKey = ref<'name' | 'requests' | 'errors' | 'p99'>('name')
const page = ref(0)
const pageSize = 20

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  let list = workers.value
  if (statusFilter.value !== 'ALL') {
    list = list.filter((w) =>
      statusFilter.value === 'OTHER'
        ? w.status !== 'ACTIVE' && w.status !== 'FAILED'
        : w.status === statusFilter.value
    )
  }
  if (q) {
    list = list.filter(
      (w) => w.name.toLowerCase().includes(q) || w.workerId.toLowerCase().includes(q)
    )
  }
  const sorted = [...list]
  const metric = (w: WorkerInfo) => workerMetrics.value[w.workerId]
  if (sortKey.value === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  if (sortKey.value === 'requests')
    sorted.sort((a, b) => (metric(b)?.requests ?? -1) - (metric(a)?.requests ?? -1))
  if (sortKey.value === 'errors')
    sorted.sort((a, b) => (metric(b)?.errors ?? -1) - (metric(a)?.errors ?? -1))
  if (sortKey.value === 'p99')
    sorted.sort(
      (a, b) => (metric(b)?.latency.p99 ?? -1) - (metric(a)?.latency.p99 ?? -1)
    )
  return sorted
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const pageRows = computed(() =>
  filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize)
)
watch([query, statusFilter, sortKey], () => {
  page.value = 0
})
const statusCounts = computed(() => {
  const c = { ALL: workers.value.length, ACTIVE: 0, FAILED: 0, OTHER: 0 }
  for (const w of workers.value) {
    if (w.status === 'ACTIVE') c.ACTIVE++
    else if (w.status === 'FAILED') c.FAILED++
    else c.OTHER++
  }
  return c
})
const sortLabels: Record<typeof sortKey.value, string> = {
  name: 'Name',
  requests: 'Requests',
  errors: 'Errors',
  p99: 'p99 latency',
}
function cycleSort() {
  const order: (typeof sortKey.value)[] = ['name', 'requests', 'errors', 'p99']
  sortKey.value = order[(order.indexOf(sortKey.value) + 1) % order.length]!
}

/* ---------- templates: real, working worker sources ---------- */
interface WorkerTemplate {
  key: string
  title: string
  blurb: string
  source: string
}
const templates: WorkerTemplate[] = [
  {
    key: 'hello',
    title: 'Hello World',
    blurb: 'fetch handler · plain text',
    source:
      'export default {\n  fetch(req) {\n    return new Response(`hello from ${req.headers.get("host")}\\n`)\n  },\n}\n',
  },
  {
    key: 'json-api',
    title: 'JSON API',
    blurb: 'routing · /health + /echo',
    source:
      'export default {\n  async fetch(req) {\n    const url = new URL(req.url)\n    if (url.pathname === "/health") {\n      return Response.json({ ok: true })\n    }\n    if (url.pathname === "/echo" && req.method === "POST") {\n      return Response.json({ echo: await req.text() })\n    }\n    return Response.json({ error: "not found", routes: ["/health", "POST /echo"] }, { status: 404 })\n  },\n}\n',
  },
  {
    key: 'redirect',
    title: 'Edge redirect',
    blurb: '302 by path map',
    source:
      'const MAP = {\n  "/docs": "https://example.com/docs",\n  "/home": "/",\n}\nexport default {\n  fetch(req) {\n    const url = new URL(req.url)\n    const target = MAP[url.pathname]\n    if (target) return Response.redirect(target, 302)\n    return new Response(`no redirect for ${url.pathname}\\n`, { status: 404 })\n  },\n}\n',
  },
]

/* ---------- create worker (real) ---------- */
const createName = ref('')
const createTemplate = ref<string>('hello')
const createError = ref<string | null>(null)
const workerNameRe = /^[a-z0-9][a-z0-9-]{0,62}$/

function openCreate(templateKey?: string) {
  createName.value = ''
  createTemplate.value = templateKey ?? 'hello'
  createError.value = null
  overlays.toggle('create')
}

async function submitCreate() {
  createError.value = null
  const name = createName.value.trim()
  if (!workerNameRe.test(name)) {
    createError.value = 'Lowercase letters, digits and dashes; must start with a letter or digit.'
    return
  }
  if (!activeCell.value || !activeTeam.value) {
    createError.value = 'No cell or team selected.'
    return
  }
  const tpl = templates.find((t) => t.key === createTemplate.value) ?? templates[0]!
  const created = await action.run(
    () => apiCreateWorker(activeCell.value, activeTeam.value, name),
    { silent: true }
  )
  if (!created) {
    createError.value = 'Could not create the worker (name may already exist).'
    return
  }
  const deployed = await action.run(
    () =>
      apiDeploySource(activeCell.value, activeTeam.value, name, {
        modules: [{ name: 'main.js', type: 'esModule', text: tpl!.source }],
      }),
    { success: `worker ${name} created and deployed` }
  )
  if (deployed !== undefined) {
    overlays.close('create')
    createName.value = ''
    await refresh()
  }
}

/* ---------- row menu: click on "more" AND right-click anywhere on the row ---------- */
const rowMenu = reactive<{ open: boolean; x: number; y: number; worker: WorkerInfo | null }>({
  open: false,
  x: 0,
  y: 0,
  worker: null,
})
function openRowMenu(event: MouseEvent, worker: WorkerInfo) {
  event.preventDefault()
  event.stopPropagation()
  rowMenu.x = Math.min(event.clientX, window.innerWidth - 200)
  rowMenu.y = Math.min(event.clientY, window.innerHeight - 160)
  rowMenu.worker = worker
  rowMenu.open = true
}
const rowActions = [
  { key: 'open', label: 'Open details', icon: 'chev' },
  { key: 'copy-url', label: 'Copy ingress hostname', icon: 'copy' },
  { key: 'delete', label: 'Delete worker', icon: 'trash', danger: true },
]
const router = useRouter()
async function pickRowAction(key: string) {
  const w = rowMenu.worker
  rowMenu.open = false
  if (!w) return
  if (key === 'open') {
    void router.push(`/workers/${encodeURIComponent(w.name)}`)
  } else if (key === 'copy-url') {
    await copyIngress(w)
  } else if (key === 'delete') {
    deleteTarget.value = w
    overlays.toggle('confirmDelete')
  }
}

/* ingress hostname lookup for copy: hostnames live on the worker detail API */
async function copyIngress(w: WorkerInfo) {
  const detail = await action.run(
    () =>
      consoleApi<{ hostnames: { hostname: string }[] }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(w.teamId)}/workers/${encodeURIComponent(w.name)}/hostnames`
      ),
    { silent: true }
  )
  const host = detail?.hostnames?.[0]?.hostname
  if (!host) {
    useToasts().err(`${w.name} has no ingress hostname yet`)
    return
  }
  await navigator.clipboard.writeText(host)
  useToasts().ok(`copied ${host}`)
}

/* ---------- delete (real, confirmed) ---------- */
const deleteTarget = ref<WorkerInfo | null>(null)
async function submitDelete() {
  const w = deleteTarget.value
  if (!w) return
  const done = await action.run(
    () => apiDeleteWorker(activeCell.value, w.teamId, w.name),
    { success: `worker ${w.name} deleted` }
  )
  if (done !== undefined) {
    overlays.close('confirmDelete')
    deleteTarget.value = null
    await refresh()
  }
}

onMounted(() => {
  if (teams.value.length === 0) void refreshTeams()
})
</script>

<template><div class="wrap pg-workers" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workers</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Workers-compatible functions on real <span class="mono" style="color: var(--t2)">workerd</span>. Every worker below is live on this cell.</p>
      </div>
      <UiButton variant="primary" @click="openCreate()"><UiIcon name="plus" />Create worker</UiButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Workers"><template #value>{{ workers.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Requests" hint="24h"><template #value>{{ metrics?.requests ?? 0 }}</template><UiMetricFoot>from the {{ metrics?.source ?? 'logs' }} source</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Error rate" hint="24h"><template #value>{{ errorRate === null ? '—' : errorRate.toFixed(2) + '%' }}</template><UiMetricFoot>{{ metrics?.errors ?? 0 }} errors</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Latency p50 / p99" hint="24h"><template #value>{{ fmtMs(metrics?.latency.p50) }} / {{ fmtMs(metrics?.latency.p99) }}</template><UiMetricFoot>worker wall time</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="CPU / wakes" hint="24h"><template #value>{{ metrics?.cpuMs === null || metrics?.cpuMs === undefined ? '—' : metrics.cpuMs + ' ms' }}</template><UiMetricFoot>{{ metrics?.launches?.ready ?? 0 }} launches · {{ metrics?.coldStarts ?? 0 }} wakes</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0; position: relative">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="width: 280px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input
            v-model="query"
            type="search"
            placeholder="Filter by name or id…"
            aria-label="Filter workers"
            style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0"
          />
        </div>
        <UiSegmented role="group" aria-label="Status">
          <UiSegment :pressed="statusFilter === 'ALL'" @click="statusFilter = 'ALL'">All <span class="n">{{ statusCounts.ALL }}</span></UiSegment>
          <UiSegment :pressed="statusFilter === 'ACTIVE'" @click="statusFilter = 'ACTIVE'">Active <span class="n">{{ statusCounts.ACTIVE }}</span></UiSegment>
          <UiSegment :pressed="statusFilter === 'FAILED'" @click="statusFilter = 'FAILED'">Errors <span class="n">{{ statusCounts.FAILED }}</span></UiSegment>
          <UiSegment :pressed="statusFilter === 'OTHER'" @click="statusFilter = 'OTHER'">Other <span class="n">{{ statusCounts.OTHER }}</span></UiSegment>
        </UiSegmented>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm" @click="cycleSort"><UiIcon name="updown" :size="12" />{{ sortLabels[sortKey] }} ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Worker</th><th>Status</th><th>Deployment</th><th>Bindings</th><th>Requests 24h</th><th>Errors</th><th>p99 latency</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading workers…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="pageRows.length === 0"><td colspan="8" class="muted" style="padding: 18px">{{ workers.length === 0 ? `No workers on ${activeCell || 'this cell'} — create one above.` : 'No workers match this filter.' }}</td></tr>
          <UiLinkRow
            v-for="w in pageRows"
            :key="w.workerId"
            v-else
            :to="`/workers/${encodeURIComponent(w.name)}`"
            @contextmenu="openRowMenu($event, w)"
          >
            <td><div class="nm"><NuxtLink :to="`/workers/${encodeURIComponent(w.name)}`">{{ w.name }}</NuxtLink></div><div class="sm">{{ w.workerId }}</div></td>
            <td><UiBadge :tone="tone(w.status)" dot>{{ w.status }}</UiBadge></td>
            <td><div class="num">{{ w.activeVersionId || '—' }}</div><div class="sm">{{ w.compatibilityDate }}</div></td>
            <td><span class="sm">entrypoint {{ w.entrypoint }}</span></td>
            <td class="num">{{ workerMetrics[w.workerId]?.requests ?? '—' }}</td>
            <td class="num" :style="workerMetrics[w.workerId]?.errors ? 'color: var(--err)' : ''">{{ workerMetrics[w.workerId]?.errors ?? '—' }}</td>
            <td class="num dim">{{ fmtMs(workerMetrics[w.workerId]?.latency.p99) }}</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" @click.stop="openRowMenu($event, w)" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>{{ filtered.length }} worker{{ filtered.length === 1 ? '' : 's' }} · page {{ page + 1 }} of {{ pageCount }} · sorted by {{ sortLabels[sortKey].toLowerCase() }}</span>
        <div style="display: flex; gap: 6px">
          <UiButton variant="secondary" size="sm" :disabled="page === 0" :style="page === 0 ? 'opacity:.5' : ''" @click="page--">Previous</UiButton>
          <UiButton variant="secondary" size="sm" :disabled="page + 1 >= pageCount" :style="page + 1 >= pageCount ? 'opacity:.5' : ''" @click="page++">Next</UiButton>
        </div>
      </div>
    </section>

    <section class="card" style="padding: 16px">
      <div class="ch-h"><span class="t">Start from a template</span><span class="muted" style="font-size: 12.5px">creates a real, deployed worker</span></div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px">
        <button
          v-for="t in templates"
          :key="t.key"
          class="card tpl"
          style="padding: 12px; background: var(--s2); text-align: left; cursor: pointer; border: 1px solid var(--b1)"
          @click="openCreate(t.key)"
        >
          <div class="nm" style="font-size: 13px">{{ t.title }}</div>
          <div class="muted" style="font-size: 12px; margin-top: 3px">{{ t.blurb }}</div>
        </button>
      </div>
    </section>

    <!-- create dialog -->
    <Teleport to="body">
      <div v-if="overlays.isOpen('create')" class="dlg-backdrop" @click.self="overlays.close('create')">
        <div class="dlg" role="dialog" aria-label="Create worker" style="width: 440px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Create worker</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Worker name</span>
              <input
                v-model="createName"
                class="inp"
                style="padding: 8px 10px; background: none; border: none; outline: none; color: inherit; font: inherit"
                placeholder="my-worker"
                autofocus
              />
            </label>
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Template</span>
              <select v-model="createTemplate" class="inp" style="padding: 8px 10px; background: var(--s1); color: inherit; font: inherit; border: none; outline: none">
                <option v-for="t in templates" :key="t.key" :value="t.key">{{ t.title }} — {{ t.blurb }}</option>
              </select>
            </label>
            <p class="muted" style="font-size: 12px; margin: 0">Creates the worker in team <span class="mono">{{ activeTeam }}</span> on cell <span class="mono">{{ activeCell }}</span> and deploys the template code immediately.</p>
            <p v-if="createError" style="color: var(--err); font-size: 12.5px; margin: 0">{{ createError }}</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px">
              <UiButton variant="secondary" type="button" @click="overlays.close('create')">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="action.pending.value">{{ action.pending.value ? 'Deploying…' : 'Create and deploy' }}</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- delete confirmation -->
    <Teleport to="body">
      <div v-if="overlays.isOpen('confirmDelete')" class="dlg-backdrop" @click.self="overlays.close('confirmDelete')">
        <div class="dlg" role="alertdialog" aria-label="Delete worker" style="width: 400px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ deleteTarget?.name }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">This removes the worker, its versions, hostnames, vars and secrets. The deletion is immediate and cannot be undone.</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" @click="overlays.close('confirmDelete')">Cancel</UiButton>
              <UiButton variant="primary" style="background: var(--err)" :disabled="action.pending.value" @click="submitDelete">{{ action.pending.value ? 'Deleting…' : 'Delete worker' }}</UiButton>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <RowMenu
      v-if="rowMenu.open"
      :actions="rowActions"
      :x="rowMenu.x"
      :y="rowMenu.y"
      @pick="pickRowAction"
      @close="rowMenu.open = false"
    />

  </div></template>

<style>
.dlg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgb(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tpl:hover {
  border-color: var(--t3) !important;
}
</style>
