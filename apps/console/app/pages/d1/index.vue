<script setup lang="ts">
import type { D1DatabaseInfo, D1StatsInfo } from '../../composables/useConsoleApi'
definePageMeta({
  nav: 'D1',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'd1' }],
})
const { activeCell } = useCellSelection()
const { activeTeam, teams, refresh: refreshTeams } = useTeamSelection()
const action = useAction()
onMounted(() => {
  if (teams.value.length === 0) void refreshTeams()
})
const { data, pending, error, refresh } = await useAsyncData(
  () => `d1:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ databases: D1DatabaseInfo[] }>(
          `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases`
        )
      : Promise.resolve({ databases: [] }),
  { watch: [activeCell] }
)
const databases = computed(() => data.value?.databases ?? [])
const statsById = ref<Record<string, D1StatsInfo>>({})
let statsSeq = 0
const formatBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}
const totalBytes = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.sizeBytes ?? 0), 0)
)
const totalTables = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.tableCount ?? 0), 0)
)
const pendingMigrations = computed(() =>
  Object.values(statsById.value).reduce((n, s) => n + (s.pendingMigrations ?? 0), 0)
)
watch(
  [activeCell, databases],
  async () => {
    const seq = ++statsSeq
    if (!activeCell.value) {
      statsById.value = {}
      return
    }
    const entries = await Promise.all(
      databases.value.slice(0, 100).map(async (db) => {
        try {
          const stats = await consoleApi<D1StatsInfo>(
            `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases/${db.database_id}/stats`
          )
          return [db.database_id, stats] as const
        } catch {
          return [db.database_id, null] as const
        }
      })
    )
    if (seq !== statsSeq) return
    statsById.value = Object.fromEntries(entries.filter(([, v]) => v)) as Record<string, D1StatsInfo>
  },
  { immediate: true }
)

/* real search */
const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return databases.value
  return databases.value.filter(
    (db) => db.name.toLowerCase().includes(q) || db.database_id.toLowerCase().includes(q)
  )
})

/* real create */
const createOpen = ref(false)
const createName = ref('')
const createError = ref<string | null>(null)
const nameRe = /^[a-z0-9][a-z0-9-]{0,62}$/
async function submitCreate() {
  createError.value = null
  const name = createName.value.trim()
  if (!nameRe.test(name)) {
    createError.value = 'Lowercase letters, digits and dashes; must start with a letter or digit.'
    return
  }
  if (!activeCell.value || !activeTeam.value) {
    createError.value = 'No cell or team selected.'
    return
  }
  const done = await action.run(() => apiCreateD1(activeCell.value, activeTeam.value, name), {
    success: `database ${name} created`,
  })
  if (done !== undefined) {
    createOpen.value = false
    createName.value = ''
    await refresh()
  } else {
    createError.value = 'Create failed — the name may already exist in this team.'
  }
}

/* real row menu: click on "more" + right-click */
const rowMenu = reactive<{ open: boolean; x: number; y: number; db: D1DatabaseInfo | null }>({
  open: false,
  x: 0,
  y: 0,
  db: null,
})
function openRowMenu(event: MouseEvent, db: D1DatabaseInfo) {
  event.preventDefault()
  event.stopPropagation()
  rowMenu.x = Math.min(event.clientX, window.innerWidth - 200)
  rowMenu.y = Math.min(event.clientY, window.innerHeight - 150)
  rowMenu.db = db
  rowMenu.open = true
}
const rowActions = [
  { key: 'open', label: 'Open database', icon: 'chev' },
  { key: 'delete', label: 'Delete database', icon: 'trash', danger: true },
]
const router = useRouter()
const confirmDelete = ref(false)
async function pickRowAction(key: string) {
  const db = rowMenu.db
  rowMenu.open = false
  if (!db) return
  if (key === 'open') void router.push(`/d1/${encodeURIComponent(db.name)}`)
  if (key === 'delete') confirmDelete.value = true
}
async function submitDelete() {
  const db = rowMenu.db
  if (!db) return
  const done = await action.run(() => apiDeleteD1(activeCell.value, db.database_id), {
    success: `database ${db.name} deleted`,
  })
  if (done !== undefined) {
    confirmDelete.value = false
    await refresh()
  }
}
</script>

<template><div class="wrap pg-d1-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="d1" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">D1 SQL databases</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">SQLite databases bound with <span class="mono" style="color: var(--t2)">[[d1_databases]]</span>. Each database lives on one node; migrations run from <span class="mono" style="color: var(--t2)">migrations/</span>.</p>
      </div>
      <UiButton variant="primary" @click="createOpen = true"><UiIcon name="plus" />Create database</UiButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Databases"><template #value>{{ databases.length }}</template><UiMetricFoot>{{ activeCell || 'no cell selected' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>{{ formatBytes(totalBytes) }}</template><UiMetricFoot>reported by the D1 data plane</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Tables"><template #value>{{ totalTables }}</template><UiMetricFoot>{{ pendingMigrations }} pending migration{{ pendingMigrations === 1 ? '' : 's' }}</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Migrations"><template #value>{{ pendingMigrations }}</template><UiMetricFoot>pending apply ops</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="width: 280px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input v-model="query" type="search" placeholder="Filter by name or id…" aria-label="Filter databases" style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0" />
        </div>
        <div style="flex: 1"></div>
        <span class="muted" style="font-size: 12.5px">{{ filtered.length }} of {{ databases.length }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Database</th><th>Bound by</th><th style="text-align: right">Size</th><th style="text-align: right">Tables</th><th>Migrations</th><th>Node</th><th>Rows read 24h</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading databases…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="databases.length === 0"><td colspan="8" class="muted" style="padding: 18px">No D1 databases.</td></tr>
          <UiLinkRow v-for="db in filtered" :key="db.database_id" :to="`/d1/${encodeURIComponent(db.name)}`" @contextmenu="openRowMenu($event, db)">
            <td><div class="nm"><NuxtLink :to="`/d1/${encodeURIComponent(db.name)}`">{{ db.name }}</NuxtLink></div><div class="sm">{{ db.database_id }}</div></td>
            <td><span class="wk">{{ db.team_id }}</span></td>
            <td class="num dim" style="text-align: right">{{ formatBytes(statsById[db.database_id]?.sizeBytes) }}</td>
            <td class="num dim" style="text-align: right">{{ statsById[db.database_id]?.tableCount ?? '—' }}</td>
            <td><UiBadge :tone="(statsById[db.database_id]?.pendingMigrations ?? 0) > 0 ? 'warn' : 'neu'" dot>{{ statsById[db.database_id]?.pendingMigrations ?? 0 }} pending</UiBadge></td>
            <td class="num muted">{{ db.cluster_id }}</td>
            <td class="num dim">{{ statsById[db.database_id]?.ops ?? '—' }} ops</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" @click.stop="openRowMenu($event, db)" /></td>
          </UiLinkRow>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>{{ filtered.length }} database{{ filtered.length === 1 ? '' : 's' }}</span>
      </div>
    </section>


    <Teleport to="body">
      <div v-if="createOpen" class="dlg-backdrop" @click.self="createOpen = false">
        <div class="dlg" role="dialog" aria-label="Create database" style="width: 420px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Create D1 database</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Database name</span>
              <input v-model="createName" placeholder="my-database" autofocus style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
            </label>
            <p class="muted" style="font-size: 12px; margin: 0">Creates in team <span class="mono">{{ activeTeam }}</span> on cell <span class="mono">{{ activeCell }}</span>.</p>
            <p v-if="createError" style="color: var(--err); font-size: 12.5px; margin: 0">{{ createError }}</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" type="button" @click="createOpen = false">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="action.pending.value">{{ action.pending.value ? 'Creating…' : 'Create database' }}</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="confirmDelete" class="dlg-backdrop" @click.self="confirmDelete = false">
        <div class="dlg" role="alertdialog" aria-label="Delete database" style="width: 400px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ rowMenu.db?.name }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">The database and all its tables are removed. Workers bound to it will fail their queries. This cannot be undone.</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" @click="confirmDelete = false">Cancel</UiButton>
              <UiButton variant="primary" style="background: var(--err)" :disabled="action.pending.value" @click="submitDelete">{{ action.pending.value ? 'Deleting…' : 'Delete database' }}</UiButton>
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
