<script setup lang="ts">
definePageMeta({
  nav: 'KV',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'kv' }],
})
const { activeCell } = useCellSelection()
const { activeTeam, teams, refresh: refreshTeams } = useTeamSelection()
const action = useAction()
onMounted(() => { if (teams.value.length === 0) void refreshTeams() })

const { data, pending, error, refresh } = await useAsyncData(
  () => `kv:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ namespaces: KvNamespaceInfo[] }>(`/api/v1/cells/${encodeURIComponent(activeCell.value)}/kv/namespaces`)
      : Promise.resolve({ namespaces: [] }),
  { watch: [activeCell] }
)
const items = computed(() => data.value?.namespaces ?? [])

const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((n) => n.title.toLowerCase().includes(q) || n.namespace_id.toLowerCase().includes(q))
})

/* create */
const createOpen = ref(false)
const createName = ref('')
const createError = ref<string | null>(null)
async function submitCreate() {
  createError.value = null
  const title = createName.value.trim()
  if (!title || title.length > 63) {
    createError.value = '1-63 characters.'
    return
  }
  const done = await action.run(() => apiCreateKv(activeCell.value, activeTeam.value, title), { success: `namespace ${title} created` })
  if (done !== undefined) {
    createOpen.value = false
    createName.value = ''
    await refresh()
  } else createError.value = 'Create failed — the title may already exist in this team.'
}

/* row menu + delete */
const rowMenu = reactive<{ open: boolean; x: number; y: number; item: KvNamespaceInfo | null }>({ open: false, x: 0, y: 0, item: null })
function openRowMenu(event: MouseEvent, it: KvNamespaceInfo) {
  event.preventDefault()
  event.stopPropagation()
  rowMenu.x = Math.min(event.clientX, window.innerWidth - 200)
  rowMenu.y = Math.min(event.clientY, window.innerHeight - 150)
  rowMenu.item = it
  rowMenu.open = true
}
const rowActions = [
  { key: 'open', label: 'Open namespace', icon: 'chev' },
  { key: 'delete', label: 'Delete namespace', icon: 'trash', danger: true },
]
const router = useRouter()
const confirmDelete = ref(false)
function pickRowAction(key: string) {
  const it = rowMenu.item
  rowMenu.open = false
  if (!it) return
  if (key === 'open') void router.push(`/kv/${encodeURIComponent(it.namespace_id)}`)
  if (key === 'delete') confirmDelete.value = true
}
async function submitDelete() {
  const it = rowMenu.item
  if (!it) return
  const done = await action.run(() => apiDeleteKv(activeCell.value, it.namespace_id), { success: 'namespace deleted' })
  if (done !== undefined) {
    confirmDelete.value = false
    await refresh()
  }
}
</script>

<template><div class="wrap pg-kv-list" style="display: flex; flex-direction: column; gap: 20px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">KV namespaces</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Key-value namespaces bound with <span class="mono" style="color: var(--t2)">[[kv_namespaces]]</span>.</p>
      </div>
      <UiButton variant="primary" @click="createOpen = true"><UiIcon name="plus" />Create namespace</UiButton>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="width: 280px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input v-model="query" type="search" placeholder="Filter by title or id…" aria-label="Filter namespaces" style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0" />
        </div>
        <div style="flex: 1"></div>
        <span class="muted" style="font-size: 12.5px">{{ filtered.length }} of {{ items.length }}</span>
      </div>
      <table class="tbl">
        <thead><tr><th>Namespace</th><th>Team</th><th>Binding</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="4" class="muted" style="padding: 18px">Loading…</td></tr>
          <tr v-else-if="error"><td colspan="4" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="filtered.length === 0"><td colspan="4" class="muted" style="padding: 18px">{{ items.length === 0 ? 'No KV namespaces — create one above.' : 'No matches.' }}</td></tr>
          <UiLinkRow v-for="n in filtered" :key="n.namespace_id" :to="`/kv/${encodeURIComponent(n.namespace_id)}`" @contextmenu="openRowMenu($event, n)">
            <td><div class="nm"><NuxtLink :to="`/kv/${encodeURIComponent(n.namespace_id)}`">{{ n.title }}</NuxtLink></div><div class="sm">{{ n.namespace_id }}</div></td>
            <td><span class="wk">{{ n.team_id }}</span></td>
            <td class="sm mono">{{ (n as unknown as { binding?: object }).binding ? 1 : 0 ? 'bound' : '—' }}</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" @click.stop="openRowMenu($event, n)" /></td>
          </UiLinkRow>
        </tbody>
      </table>
    </section>

    <Teleport to="body">
      <div v-if="createOpen" class="dlg-backdrop" @click.self="createOpen = false">
        <div class="dlg" role="dialog" style="width: 420px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Create KV namespace</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <input v-model="createName" placeholder="namespace title" autofocus style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
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
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ rowMenu.item?.title }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">All keys in the namespace are lost. This cannot be undone.</p>
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
