<script setup lang="ts">
/**
 * Worker detail shell. Resolves the real worker by name (no fixture
 * validation — a worker that exists on the cell renders, anything else
 * shows a real not-found state) and owns the header actions: Deploy,
 * Visit, copy URL, delete.
 */
const route = useRoute()
const router = useRouter()
const name = computed(() => String((route.params as { name?: string }).name))
const { detail, pending, error, notFound, refresh } = useWorkerDetail(name)
const { activeCell } = useCellSelection()
const action = useAction()

watch([name, activeCell], () => void refresh(), { immediate: true })

const tabs = [
  { label: 'Overview', name: 'workers-name', path: '' },
  { label: 'Deployments', name: 'workers-name-deployments', path: '/deployments' },
  { label: 'Logs', name: 'workers-name-logs', path: '/logs' },
  { label: 'Settings', name: 'workers-name-settings', path: '/settings' },
].map((tab) => ({ ...tab, to: `/workers/${name.value}${tab.path}` }))

const worker = computed(() => detail.value?.worker ?? null)
const primaryHostname = computed(() => detail.value?.hostnames?.[0]?.hostname ?? null)
const statusTone = computed(() => {
  const s = worker.value?.status ?? ''
  return s === 'ACTIVE' ? 'ok' : s === 'FAILED' ? 'err' : 'neu'
})

async function copyUrl() {
  if (!primaryHostname.value) return
  await navigator.clipboard.writeText(primaryHostname.value)
  useToasts().ok(`copied ${primaryHostname.value}`)
}
function visit() {
  if (!primaryHostname.value) return
  window.open(`http://${primaryHostname.value}`, '_blank', 'noopener')
}

/* deploy dialog: paste or edit worker source, deploys through deploy-source */
const deployOpen = ref(false)
const deploySource = ref('')
const deployError = ref<string | null>(null)
const DEFAULT_SOURCE =
  'export default {\n  fetch(req) {\n    return new Response(`hello from ${req.headers.get("host")}\\n`)\n  },\n}\n'
function openDeploy() {
  deploySource.value = DEFAULT_SOURCE
  deployError.value = null
  deployOpen.value = true
}
async function submitDeploy() {
  deployError.value = null
  const w = worker.value
  if (!w || !activeCell.value) return
  if (!deploySource.value.trim()) {
    deployError.value = 'Source is empty.'
    return
  }
  const r = await action.run(
    () =>
      apiDeploySource(activeCell.value, w.teamId, w.name, {
        modules: [{ name: 'main.js', type: 'esModule', text: deploySource.value }],
      }),
    { success: `deployed ${w.name}` }
  )
  if (r !== undefined) {
    deployOpen.value = false
    await refresh()
  } else {
    deployError.value = 'Deploy failed — check the error toast.'
  }
}

/* header overflow menu incl. delete */
const menuOpen = ref(false)
const confirmDelete = ref(false)
async function submitDelete() {
  const w = worker.value
  if (!w) return
  const done = await action.run(() => apiDeleteWorker(activeCell.value, w.teamId, w.name), {
    success: `worker ${w.name} deleted`,
  })
  if (done !== undefined) {
    confirmDelete.value = false
    void router.push('/workers')
  }
}
</script>

<template><div class="wrap" style="display: flex; flex-direction: column; gap: 18px">
    <div v-if="pending && !detail" class="muted" style="padding: 30px 0">Loading worker…</div>
    <div v-else-if="notFound" style="padding: 30px 0">
      <h1 style="font-size: 20px; margin: 0 0 8px">Worker not found</h1>
      <p class="muted" style="font-size: 13.5px">No worker named <span class="mono">{{ name }}</span> exists on cell <span class="mono">{{ activeCell }}</span>. It may have been deleted.</p>
      <NuxtLink to="/workers" style="color: var(--accent); font-size: 13.5px">← Back to workers</NuxtLink>
    </div>
    <div v-else-if="error" style="padding: 30px 0; color: var(--err)">{{ error }}</div>

    <template v-else-if="worker">
    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
      <div style="display: flex; gap: 14px; align-items: center; min-width: 0">
        <span class="pico" style="width: 44px; height: 44px; border-radius: 11px; color: var(--accent)"><UiIcon name="zap" :size="20" /></span>
        <div style="min-width: 0">
          <div style="display: flex; align-items: center; gap: 10px">
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.03em">{{ worker.name }}</h1>
            <UiBadge :tone="statusTone" dot>{{ worker.status }}</UiBadge>
            <span class="kind mono" style="font-size: 12px">{{ worker.workerId }}</span>
          </div>
          <div style="font-family: 'Geist Mono', monospace; font-size: 12.5px; color: var(--t3); margin-top: 6px; display: flex; gap: 8px; align-items: center; white-space: nowrap">
            <template v-if="primaryHostname">
              <span style="color: var(--t2)">{{ primaryHostname }}</span>
              <UiIconButton icon="copy" :size="12" label="Copy URL" style="width: 22px; height: 22px" @click="copyUrl" />
            </template>
            <span v-else class="dim">no ingress hostname — add one in Settings</span>
            <span class="dim">·</span>{{ worker.activeVersionId ?? 'no active version' }}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex: none">
        <UiButton variant="secondary" :disabled="!primaryHostname" :style="!primaryHostname ? 'opacity:.5' : ''" @click="visit"><UiIcon name="ext" :size="13" />Visit</UiButton>
        <UiButton variant="primary" @click="openDeploy"><UiIcon name="upload" :size="13" />Deploy</UiButton>
        <UiIconButton icon="more" :size="15" label="More" style="width: 34px; height: 34px; border-color: var(--b2)" @click="menuOpen = !menuOpen" />
      </div>
    </div>
    <div v-if="menuOpen" style="position: relative">
      <div class="menu" style="position: absolute; right: 0; top: 0; z-index: 60; min-width: 180px">
        <a href="#" style="color: var(--err)" @click.prevent="menuOpen = false; confirmDelete = true"><UiIcon name="trash" :size="14" />Delete worker</a>
      </div>
    </div>
    <UiTabs><UiTab v-for="tab in tabs" :key="tab.label" :to="tab.to" :active="tab.name === route.name" :aria-current="tab.name === route.name ? 'page' : undefined">{{ tab.label }}</UiTab></UiTabs>

    <NuxtPage :key="`${name}:${detail?.versions.length ?? 0}`" />

    <!-- deploy dialog -->
    <Teleport to="body">
      <div v-if="deployOpen" class="dlg-backdrop" @click.self="deployOpen = false">
        <div class="dlg" role="dialog" aria-label="Deploy worker" style="width: 560px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Deploy {{ worker.name }}</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitDeploy">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Module source (main.js, ES module)</span>
              <textarea
                v-model="deploySource"
                rows="12"
                spellcheck="false"
                class="mono"
                style="padding: 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font-size: 12px; resize: vertical"
              />
            </label>
            <p v-if="deployError" style="color: var(--err); font-size: 12.5px; margin: 0">{{ deployError }}</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" type="button" @click="deployOpen = false">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="action.pending.value">{{ action.pending.value ? 'Deploying…' : 'Deploy' }}</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- delete confirmation -->
    <Teleport to="body">
      <div v-if="confirmDelete" class="dlg-backdrop" @click.self="confirmDelete = false">
        <div class="dlg" role="alertdialog" aria-label="Delete worker" style="width: 400px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">Delete {{ worker.name }}?</div>
          <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px">
            <p class="muted" style="font-size: 13px; margin: 0">This removes the worker, its versions, hostnames, vars and secrets. The deletion is immediate and cannot be undone.</p>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" @click="confirmDelete = false">Cancel</UiButton>
              <UiButton variant="primary" style="background: var(--err)" :disabled="action.pending.value" @click="submitDelete">{{ action.pending.value ? 'Deleting…' : 'Delete worker' }}</UiButton>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
    </template>
  </div></template>
