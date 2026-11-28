<script setup lang="ts">
/** Real KV namespace detail: keys are listed/read/written/deleted through
 *  cell ops (KV_LIST/KV_GET/KV_PUT/KV_DELETE). Ops execute on the cell —
 *  when no cell is connected they stay PENDING and the page says so. */
definePageMeta({
  nav: 'KV',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'kv', to: '/kv' }, { label: 'namespace' }],
})
const route = useRoute()
const nsId = computed(() => String((route.params as { namespace?: string }).namespace))
const { activeCell } = useCellSelection()
const action = useAction()

/* resolve the namespace row from the cell list */
const ns = ref<KvNamespaceInfo | null>(null)
const notFound = ref(false)
async function resolveNs() {
  if (!activeCell.value) return
  const data = await consoleApi<{ namespaces: KvNamespaceInfo[] }>(
    `/api/v1/cells/${encodeURIComponent(activeCell.value)}/kv/namespaces`
  )
  ns.value = data.namespaces.find((n) => n.namespace_id === nsId.value) ?? null
  notFound.value = !ns.value
}
watch(activeCell, (c) => { if (c) void resolveNs() }, { immediate: true })

/* op runner: submit + poll, surface the real terminal state */
interface OpResult {
  status: string
  result?: unknown
  error?: string | null
}
async function runOp(kind: string, payload: Record<string, unknown>): Promise<OpResult | undefined> {
  return action.run(
    async () => {
      const submitted = await consoleApi<{ op: OpInfo }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/kv/namespaces/${encodeURIComponent(nsId.value)}/ops`,
        { method: 'POST', body: { kind, payload } }
      )
      return waitForOp(activeCell.value, submitted.op.id, 12_000)
    },
    { silent: true }
  )
}

/* key listing with prefix filter */
const prefix = ref('')
const keys = ref<{ name: string; bytes?: number; expiration?: number | null }[]>([])
const listState = ref<'idle' | 'pending' | 'error'>('idle')
const listNote = ref('')
async function loadKeys() {
  listState.value = 'pending'
  const op = await runOp('KV_LIST', { prefix: prefix.value || undefined, limit: 200 })
  if (!op) {
    listState.value = 'error'
    listNote.value = 'op submit failed'
    return
  }
  if (op.status !== 'SUCCEEDED') {
    listState.value = 'error'
    listNote.value =
      op.status === 'PENDING'
        ? 'op is still PENDING — no cell is connected to execute it'
        : op.error ?? `op ${op.status}`
    keys.value = []
    return
  }
  const result = op.result as { keys?: { name: string; bytes?: number; expiration?: number | null }[] }
  keys.value = result?.keys ?? []
  listState.value = 'idle'
  listNote.value = ''
}
watch([activeCell, ns], () => {
  if (ns.value) void loadKeys()
})

/* key viewer */
const viewing = ref<{ key: string; value: string } | null>(null)
async function viewKey(key: string) {
  const op = await runOp('KV_GET', { key })
  if (op?.status === 'SUCCEEDED') {
    const result = op.result as { value?: string | null }
    viewing.value = { key, value: result?.value ?? '(not found or empty)' }
  } else {
    useToasts().err(`read ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}

/* add key */
const addOpen = ref(false)
const addKey = ref('')
const addValue = ref('')
async function submitAdd() {
  if (!addKey.value.trim()) return
  const op = await runOp('KV_PUT', { key: addKey.value.trim(), value: addValue.value })
  if (op?.status === 'SUCCEEDED') {
    useToasts().ok(`key ${addKey.value} written`)
    addOpen.value = false
    addKey.value = ''
    addValue.value = ''
    await loadKeys()
  } else {
    useToasts().err(`write ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete (no cell?)'}`)
  }
}

/* delete key */
const deleting = ref<string | null>(null)
async function deleteKey(key: string) {
  deleting.value = key
  const op = await runOp('KV_DELETE', { key })
  deleting.value = null
  if (op?.status === 'SUCCEEDED') {
    useToasts().ok(`key ${key} deleted`)
    await loadKeys()
  } else {
    useToasts().err(`delete ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}

async function copyId() {
  if (!ns.value) return
  await navigator.clipboard.writeText(ns.value.namespace_id)
  useToasts().ok('namespace id copied')
}
const fmtBytes = (n?: number) => (n === undefined ? '—' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`)
</script>

<template><div class="wrap pg-kv" style="display: flex; flex-direction: column; gap: 18px">
    <div v-if="notFound" style="padding: 30px 0">
      <h1 style="font-size: 20px; margin: 0 0 8px">Namespace not found</h1>
      <p class="muted" style="font-size: 13.5px">No KV namespace <span class="mono">{{ nsId }}</span> on this cell.</p>
      <NuxtLink to="/kv" style="color: var(--accent); font-size: 13.5px">← Back to KV</NuxtLink>
    </div>
    <template v-else>
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="kv" />KV namespace</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">{{ ns?.title ?? nsId }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px; display: flex; gap: 10px; align-items: center">
          <span class="mono">{{ nsId }}</span>
          <UiIconButton icon="copy" :size="12" label="Copy ID" style="width: 22px; height: 22px" @click="copyId" />
          <span v-if="ns">team <span class="mono" style="color: var(--t2)">{{ ns.team_id }}</span></span>
        </p>
      </div>
      <UiButton variant="primary" @click="addOpen = true"><UiIcon name="plus" />Add key</UiButton>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <div class="inp" style="flex: 1; max-width: 360px; display: flex; align-items: center; gap: 8px; padding: 0 10px">
          <UiIcon name="search" />
          <input v-model="prefix" type="search" placeholder="prefix filter…" aria-label="Filter keys by prefix" style="background: none; border: none; outline: none; color: inherit; font: inherit; width: 100%; padding: 7px 0" @keydown.enter="loadKeys" />
        </div>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm" @click="loadKeys"><UiIcon name="redo" :size="12" />Refresh</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Key</th><th style="text-align: right">Size</th><th>Expiration</th><th style="width: 130px"></th></tr></thead>
        <tbody>
          <tr v-if="listState === 'pending'"><td colspan="4" class="muted" style="padding: 16px">Listing keys…</td></tr>
          <tr v-else-if="listState === 'error'"><td colspan="4" style="padding: 16px; color: var(--err)">{{ listNote }}</td></tr>
          <tr v-else-if="keys.length === 0"><td colspan="4" class="muted" style="padding: 16px">No keys{{ prefix ? ` with prefix "${prefix}"` : '' }}.</td></tr>
          <tr v-for="k in keys" :key="k.name">
            <td><a href="#" class="mono" style="color: var(--accent)" @click.prevent="viewKey(k.name)">{{ k.name }}</a></td>
            <td class="num dim" style="text-align: right">{{ fmtBytes(k.bytes) }}</td>
            <td class="sm">{{ k.expiration ? new Date(k.expiration * 1000).toLocaleString() : '—' }}</td>
            <td style="text-align: right">
              <UiButton variant="secondary" size="sm" :disabled="deleting === k.name" @click="deleteKey(k.name)">{{ deleting === k.name ? 'Deleting…' : 'Delete' }}</UiButton>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- key viewer drawer -->
    <Teleport to="body">
      <div v-if="viewing" class="dlg-backdrop" @click.self="viewing = null">
        <div class="dlg" role="dialog" style="width: 520px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600" class="mono">{{ viewing.key }}</div>
          <div style="padding: 16px 18px">
            <pre class="mono" style="background: var(--s2); padding: 12px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; max-height: 320px; overflow-y: auto">{{ viewing.value }}</pre>
            <div style="display: flex; justify-content: flex-end; margin-top: 12px">
              <UiButton variant="secondary" @click="viewing = null">Close</UiButton>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- add key dialog -->
    <Teleport to="body">
      <div v-if="addOpen" class="dlg-backdrop" @click.self="addOpen = false">
        <div class="dlg" role="dialog" style="width: 480px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Add key</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitAdd">
            <input v-model="addKey" placeholder="key name" autofocus class="mono" style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
            <textarea v-model="addValue" placeholder="value" rows="6" class="mono" style="padding: 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font-size: 12px; resize: vertical" />
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" type="button" @click="addOpen = false">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="action.pending.value">Write key</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
    </template>
  </div></template>
