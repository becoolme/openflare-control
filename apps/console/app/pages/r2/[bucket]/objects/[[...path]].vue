<script setup lang="ts">
/** Real R2 object browser: lists with prefix+delimiter folder semantics,
 *  uploads/downloads as base64 through cell ops (4 MiB channel cap),
 *  deletes with confirmation. Ops execute on the cell — when none is
 *  connected the page surfaces the PENDING state honestly. */
definePageMeta({
  nav: 'R2',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'r2', to: '/r2' }, { label: 'bucket' }],
})
const route = useRoute()
const bucket = computed(() => String((route.params as { bucket?: string }).bucket))
const prefixPath = computed(() => {
  const p = (route.params as { path?: string[] | string }).path
  if (!p) return ''
  return Array.isArray(p) ? p.join('/') + (p.length ? '/' : '') : String(p)
})
const { activeCell } = useCellSelection()
const action = useAction()

async function runOp(kind: string, payload: Record<string, unknown>) {
  return action.run(
    async () => {
      const submitted = await consoleApi<{ opId: string }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/r2/buckets/${encodeURIComponent(bucket.value)}/ops`,
        { method: 'POST', body: { kind, payload } }
      )
      return waitForOp(activeCell.value, submitted.opId, 15_000)
    },
    { silent: true }
  )
}

interface R2ObjectRow {
  key: string
  size?: number
  uploaded?: string
  contentType?: string
}
const objects = ref<R2ObjectRow[]>([])
const folders = ref<string[]>([])
const listState = ref<'idle' | 'pending' | 'error'>('idle')
const listNote = ref('')
async function load() {
  listState.value = 'pending'
  const op = await runOp('R2_LIST', { prefix: prefixPath.value, delimiter: '/', limit: 500 })
  if (!op || op.status !== 'DONE') {
    listState.value = 'error'
    listNote.value = !op
      ? 'op submit failed'
      : op.status === 'PENDING'
        ? 'list op is still PENDING — no cell is connected to execute it'
        : op.error ?? `op ${op.status}`
    objects.value = []
    folders.value = []
    return
  }
  const result = op.result as {
    objects?: R2ObjectRow[]
    keys?: R2ObjectRow[]
    prefixes?: string[]
    delimitedPrefixes?: string[]
  }
  objects.value = result?.objects ?? result?.keys ?? []
  folders.value = result?.prefixes ?? result?.delimitedPrefixes ?? []
  listState.value = 'idle'
  listNote.value = ''
}
watch([activeCell, prefixPath], () => void load(), { immediate: true })

/* upload */
const uploadOpen = ref(false)
const uploadKey = ref('')
const uploadText = ref('')
const uploadState = ref<string | null>(null)
function b64encode(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
}
function b64decode(s: string) {
  return decodeURIComponent(escape(atob(s)))
}
async function submitUpload() {
  const key = (prefixPath.value + uploadKey.value).replace(/^\/+/, '')
  if (!uploadKey.value.trim()) return
  uploadState.value = 'uploading'
  const op = await runOp('R2_PUT', {
    key,
    body: uploadText.value,
    contentType: 'text/plain',
  })
  uploadState.value = null
  if (op?.status === 'DONE') {
    useToasts().ok(`object ${key} written`)
    uploadOpen.value = false
    uploadKey.value = ''
    uploadText.value = ''
    await load()
  } else {
    useToasts().err(`upload ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}

/* download/view */
const viewing = ref<{ key: string; body: string; contentType?: string } | null>(null)
async function viewObject(key: string) {
  const op = await runOp('R2_GET', { key })
  if (op?.status === 'DONE') {
    const result = op.result as {
      body?: string
      bodyBase64?: string
      object?: { httpMetadata?: { contentType?: string } }
    }
    let body = result?.body ?? ''
    if (!body && result?.bodyBase64) {
      try {
        body = b64decode(result.bodyBase64)
      } catch {
        body = '(binary object — cannot preview as text)'
      }
    }
    viewing.value = { key, body, contentType: result?.object?.httpMetadata?.contentType }
  } else {
    useToasts().err(`read ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}

/* delete */
const confirmDelete = ref<string | null>(null)
async function submitDelete() {
  const key = confirmDelete.value
  if (!key) return
  const op = await runOp('R2_DELETE', { key })
  confirmDelete.value = null
  if (op?.status === 'DONE') {
    useToasts().ok(`object ${key} deleted`)
    await load()
  } else {
    useToasts().err(`delete ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}

const fmtBytes = (n?: number) =>
  n === undefined ? '—' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`
const crumbsPath = computed(() => {
  const parts = prefixPath.value.split('/').filter(Boolean)
  return parts.map((p, i) => ({
    label: p,
    to: `/r2/${encodeURIComponent(bucket.value)}/objects/${parts.slice(0, i + 1).map(encodeURIComponent).join('/')}`,
  }))
})
</script>

<template><div class="wrap pg-r2objects" style="display: flex; flex-direction: column; gap: 18px">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="r2" />R2 bucket</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">{{ bucket }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13px; display: flex; gap: 6px; align-items: center">
          <NuxtLink :to="`/r2/${encodeURIComponent(bucket)}/objects`" style="color: var(--accent)">root</NuxtLink>
          <template v-for="c in crumbsPath" :key="c.to">/ <NuxtLink :to="c.to" style="color: var(--accent)">{{ c.label }}</NuxtLink></template>
        </p>
      </div>
      <UiButton variant="primary" @click="uploadOpen = true"><UiIcon name="upload" />Upload object</UiButton>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <span class="mono dim" style="font-size: 12px">/{{ prefixPath }}</span>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm" @click="load"><UiIcon name="redo" :size="12" />Refresh</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Object</th><th style="text-align: right">Size</th><th>Type</th><th style="width: 110px"></th></tr></thead>
        <tbody>
          <tr v-if="listState === 'pending'"><td colspan="4" class="muted" style="padding: 16px">Listing objects…</td></tr>
          <tr v-else-if="listState === 'error'"><td colspan="4" style="padding: 16px; color: var(--err)">{{ listNote }}</td></tr>
          <tr v-else-if="objects.length === 0 && folders.length === 0"><td colspan="4" class="muted" style="padding: 16px">Empty here — upload the first object.</td></tr>
          <tr v-for="f in folders" :key="f">
            <td colspan="4">
              <NuxtLink :to="`/r2/${encodeURIComponent(bucket)}/objects/${f.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`" class="mono" style="color: var(--accent)"><UiIcon name="layers" :size="12" /> {{ f.replace(prefixPath, '') }}</NuxtLink>
            </td>
          </tr>
          <tr v-for="o in objects" :key="o.key">
            <td><a href="#" class="mono" style="color: var(--accent)" @click.prevent="viewObject(o.key)">{{ o.key.replace(prefixPath, '') }}</a></td>
            <td class="num dim" style="text-align: right">{{ fmtBytes(o.size) }}</td>
            <td class="sm">{{ o.contentType ?? '—' }}</td>
            <td style="text-align: right"><UiButton variant="secondary" size="sm" @click="confirmDelete = o.key">Delete</UiButton></td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- upload dialog -->
    <Teleport to="body">
      <div v-if="uploadOpen" class="dlg-backdrop" @click.self="uploadOpen = false">
        <div class="dlg" role="dialog" style="width: 480px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Upload object</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitUpload">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Key (prefixed with /{{ prefixPath }})</span>
              <input v-model="uploadKey" placeholder="notes/hello.txt" autofocus class="mono" style="padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" />
            </label>
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Text content (binary upload lands in a later slice — 4 MiB cap)</span>
              <textarea v-model="uploadText" rows="6" class="mono" style="padding: 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font-size: 12px; resize: vertical" />
            </label>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" type="button" @click="uploadOpen = false">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="uploadState === 'uploading'">{{ uploadState === 'uploading' ? 'Uploading…' : 'Upload' }}</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- viewer -->
    <Teleport to="body">
      <div v-if="viewing" class="dlg-backdrop" @click.self="viewing = null">
        <div class="dlg" role="dialog" style="width: 560px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600" class="mono">{{ viewing.key }}</div>
          <div style="padding: 16px 18px">
            <pre class="mono" style="background: var(--s2); padding: 12px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; max-height: 340px; overflow-y: auto">{{ viewing.body }}</pre>
            <div style="display: flex; justify-content: flex-end; margin-top: 12px"><UiButton variant="secondary" @click="viewing = null">Close</UiButton></div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- delete confirm -->
    <Teleport to="body">
      <div v-if="confirmDelete" class="dlg-backdrop" @click.self="confirmDelete = null">
        <div class="dlg" role="alertdialog" style="width: 400px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete object?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="mono" style="font-size: 12.5px; margin: 0; word-break: break-all">{{ confirmDelete }}</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" @click="confirmDelete = null">Cancel</UiButton>
              <UiButton variant="primary" style="background: var(--err)" @click="submitDelete">Delete</UiButton>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div></template>
