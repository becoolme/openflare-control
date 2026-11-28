<script setup lang="ts">
interface HyperdriveRow {
  hyperdrive_id: string
  team_id: string
  cluster_id: string
  name: string
  origin: string
  caching: boolean
}

definePageMeta({
  nav: 'Hyperdrive',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'hyperdrive' }],
})
const { activeCell } = useCellSelection()
const { activeTeam, teams, refresh: refreshTeams } = useTeamSelection()
const action = useAction()
onMounted(() => { if (teams.value.length === 0) void refreshTeams() })

const { data, pending, error, refresh } = await useAsyncData(
  () => `hyperdrive:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ hyperdrives: HyperdriveRow[] }>(`/api/v1/cells/${encodeURIComponent(activeCell.value)}/hyperdrive`)
      : Promise.resolve({ hyperdrives: [] }),
  { watch: [activeCell] }
)
const items = computed(() => data.value?.hyperdrives ?? [])

const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((it) => String(it.name).toLowerCase().includes(q) || String(it.hyperdrive_id).toLowerCase().includes(q))
})

const createOpen = ref(false)
const createName = ref('')
const createOrigin = ref('')
const createError = ref<string | null>(null)
async function submitCreate() {
  createError.value = null
  const name = createName.value.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    createError.value = 'Lowercase letters, digits and dashes.'
    return
  }
  const origin = createOrigin.value.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(origin) || /@/.test(origin.split('//')[1] ?? '')) {
    createError.value = 'Origin must be a URL without embedded credentials, like postgres://host:5432/db.'
    return
  }
  const done = await action.run(() => apiCreateHyperdrive(activeCell.value, activeTeam.value, name, createOrigin.value.trim()), { success: `config created` })
  if (done !== undefined) {
    createOpen.value = false
    createName.value = ''
    createOrigin.value = ''
    await refresh()
  } else createError.value = 'Create failed — the name may already exist in this team.'
}

const rowMenu = reactive<{ open: boolean; x: number; y: number; item: HyperdriveRow | null }>({ open: false, x: 0, y: 0, item: null })
function openRowMenu(event: MouseEvent, it: HyperdriveRow) {
  event.preventDefault()
  event.stopPropagation()
  rowMenu.x = Math.min(event.clientX, window.innerWidth - 200)
  rowMenu.y = Math.min(event.clientY, window.innerHeight - 150)
  rowMenu.item = it
  rowMenu.open = true
}
const rowActions = [{ key: 'delete', label: 'Delete', icon: 'trash', danger: true }]
const router = useRouter()
const confirmDelete = ref(false)
function pickRowAction(key: string) {
  const it = rowMenu.item
  rowMenu.open = false
  if (!it) return
  
  if (key === 'delete') confirmDelete.value = true
}
async function submitDelete() {
  const it = rowMenu.item
  if (!it) return
  const done = await action.run(() => apiDeleteHyperdrive(activeCell.value, rowMenu.item!.hyperdrive_id), { success: `config deleted` })
  if (done !== undefined) {
    confirmDelete.value = false
    await refresh()
  }
}
</script>

<template><div class="wrap pg-hyperdrive-list" style="display: flex; flex-direction: column; gap: 20px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Hyperdrive</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Connection pooling and caching for existing PostgreSQL databases.</p>
      </div>
      <UiButton variant="primary" @click="createOpen = true"><UiIcon name="plus" />Create config</UiButton>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="width: 280px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input v-model="query" type="search" placeholder="Filter…" aria-label="Filter" style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0" />
        </div>
        <div style="flex: 1"></div>
        <span class="muted" style="font-size: 12.5px">{{ filtered.length }} of {{ items.length }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Config</th><th>Origin</th><th>Team</th><th>Caching</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="filtered.length === 0"><td colspan="8" class="muted" style="padding: 18px">No hyperdrive configs — create one above.</td></tr>
          <tr v-for="h in filtered" :key="h.hyperdrive_id" @contextmenu="openRowMenu($event, h)">
            <td><div class="nm">{{ h.name }}</div><div class="sm">{{ h.hyperdrive_id }}</div></td>
            <td class="mono sm">{{ h.origin }}</td>
            <td><span class="wk">{{ h.team_id }}</span></td>
            <td><UiBadge :tone="h.caching ? 'ok' : 'neu'">{{ h.caching ? 'on' : 'off' }}</UiBadge></td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" @click.stop="openRowMenu($event, h)" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <Teleport to="body">
      <div v-if="createOpen" class="dlg-backdrop" @click.self="createOpen = false">
        <div class="dlg" role="dialog" style="width: 420px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Create config</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <input v-model="createName" placeholder="config name" autofocus style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
<input v-model="createOrigin" placeholder="postgres://host:5432/dbname" style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
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
            <p class="muted" style="font-size: 13px; margin: 0">Workers bound to this config lose database connectivity. This cannot be undone.</p>
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
