<script setup lang="ts">

definePageMeta({
  nav: 'R2',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'r2' }],
})
const { activeCell } = useCellSelection()
const { activeTeam, teams, refresh: refreshTeams } = useTeamSelection()
const action = useAction()
onMounted(() => { if (teams.value.length === 0) void refreshTeams() })

const { data, pending, error, refresh } = await useAsyncData(
  () => `r2:${activeCell.value}`,
  () =>
    activeCell.value
      ? consoleApi<{ buckets: R2BucketInfo[] }>(`/api/v1/cells/${encodeURIComponent(activeCell.value)}/r2/buckets`)
      : Promise.resolve({ buckets: [] }),
  { watch: [activeCell] }
)
const items = computed(() => data.value?.buckets ?? [])

const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((it) => String(it.bucket_name).toLowerCase().includes(q) || String(it.bucket_name).toLowerCase().includes(q))
})

const createOpen = ref(false)
const createName = ref('')

const createError = ref<string | null>(null)
async function submitCreate() {
  createError.value = null
  const name = createName.value.trim()
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) {
    createError.value = 'Invalid bucket name (3-63 chars: lowercase, digits, dots, dashes).'
    return
  }
  const done = await action.run(() => apiCreateR2(activeCell.value, activeTeam.value, name), { success: `bucket created` })
  if (done !== undefined) {
    createOpen.value = false
    createName.value = ''

    await refresh()
  } else createError.value = 'Create failed — the name may already exist in this team.'
}

const rowMenu = reactive<{ open: boolean; x: number; y: number; item: R2BucketInfo | null }>({ open: false, x: 0, y: 0, item: null })
function openRowMenu(event: MouseEvent, it: R2BucketInfo) {
  event.preventDefault()
  event.stopPropagation()
  rowMenu.x = Math.min(event.clientX, window.innerWidth - 200)
  rowMenu.y = Math.min(event.clientY, window.innerHeight - 150)
  rowMenu.item = it
  rowMenu.open = true
}
const rowActions = [
  { key: 'open', label: 'Open', icon: 'chev' },
  { key: 'delete', label: 'Delete', icon: 'trash', danger: true },
]
const router = useRouter()
const confirmDelete = ref(false)
function pickRowAction(key: string) {
  const it = rowMenu.item
  rowMenu.open = false
  if (!it) return
  if (key === 'open') void router.push(`/r2/${encodeURIComponent(it.bucket_name)}/objects`)
  if (key === 'delete') confirmDelete.value = true
}
async function submitDelete() {
  const it = rowMenu.item
  if (!it) return
  const done = await action.run(() => apiDeleteR2(activeCell.value, rowMenu.item!.bucket_name), { success: `bucket deleted` })
  if (done !== undefined) {
    confirmDelete.value = false
    await refresh()
  }
}
</script>

<template><div class="wrap pg-r2-list" style="display: flex; flex-direction: column; gap: 20px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">R2 buckets</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">S3-compatible object storage bound with <span class="mono" style="color: var(--t2)">[[r2_buckets]]</span>.</p>
      </div>
      <UiButton variant="primary" @click="createOpen = true"><UiIcon name="plus" />Create bucket</UiButton>
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
        <thead><tr><th>Bucket</th><th>Team</th><th></th></tr></thead>
        <tbody>
          <tr v-if="pending"><td colspan="8" class="muted" style="padding: 18px">Loading…</td></tr>
          <tr v-else-if="error"><td colspan="8" style="padding: 18px; color: var(--err)">{{ error.message }}</td></tr>
          <tr v-else-if="filtered.length === 0"><td colspan="8" class="muted" style="padding: 18px">No R2 buckets — create one above.</td></tr>
          <UiLinkRow v-for="b in filtered" :key="b.bucket_name" :to="`/r2/${encodeURIComponent(b.bucket_name)}/objects`" @contextmenu="openRowMenu($event, b)">
            <td><div class="nm"><NuxtLink :to="`/r2/${encodeURIComponent(b.bucket_name)}/objects`">{{ b.bucket_name }}</NuxtLink></div><div class="sm">{{ b.bucket_id }}</div></td>
            <td><span class="wk">{{ b.team_id }}</span></td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" @click.stop="openRowMenu($event, b)" /></td>
          </UiLinkRow>
        </tbody>
      </table>
    </section>

    <Teleport to="body">
      <div v-if="createOpen" class="dlg-backdrop" @click.self="createOpen = false">
        <div class="dlg" role="dialog" style="width: 420px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Create bucket</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <input v-model="createName" placeholder="my-bucket" autofocus style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />

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
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ rowMenu.item?.bucket_name }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">Every object in the bucket is destroyed. This cannot be undone.</p>
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
