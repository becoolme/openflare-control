<script setup lang="ts">
/** Real workflow detail: instances are created/inspected/driven through
 *  workflow ops (WF_CREATE/WF_GET/WF_ACTION/WF_DELETE). The engine runs
 *  on the cell; ops without a connected cell stay PENDING and the page
 *  shows that truthfully. */
definePageMeta({
  nav: 'Workflows',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'workflows', to: '/workflows' }, { label: 'workflow' }],
})
const route = useRoute()
const wfName = computed(() => String((route.params as { name?: string }).name))
const { activeCell } = useCellSelection()
const action = useAction()

/* resolve workflow row through the services catalog */
interface WfRow {
  workflowId: string
  workerId: string
  name: string
  className: string
  teamId: string
}
const wf = ref<WfRow | null>(null)
const notFound = ref(false)
const workerRef = computed(() => {
  if (!wf.value) return null
  const [teamId, ...parts] = wf.value.workerId.split(':')
  return { teamId: teamId ?? '', name: parts.join(':') }
})
async function resolveWf() {
  if (!activeCell.value) return
  const data = await consoleApi<{ workflows: WfRow[] }>(
    `/api/v1/cells/${encodeURIComponent(activeCell.value)}/services`
  )
  wf.value = (data.workflows ?? []).find((w) => w.name === wfName.value) ?? null
  notFound.value = !wf.value
}
watch(activeCell, (c) => { if (c) void resolveWf() }, { immediate: true })

const wfBase = computed(() => {
  const w = workerRef.value
  if (!w || !wf.value) return ''
  return `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(w.teamId)}/workers/${encodeURIComponent(w.name)}/workflows/${encodeURIComponent(wf.value.name)}`
})

async function runOp(kind: string, extra: Record<string, unknown> = {}) {
  return action.run(
    async () => {
      const submitted = await consoleApi<{ opId: string }>(wfBase.value + '/ops', {
        method: 'POST',
        body: { kind, ...extra },
      })
      return waitForOp(activeCell.value, submitted.opId, 15_000)
    },
    { silent: true }
  )
}

/* create instance */
const createOpen = ref(false)
const instanceParams = ref('{}')
const lastCreated = ref<string | null>(null)
async function submitCreate() {
  let params: unknown = {}
  try {
    params = instanceParams.value.trim() ? JSON.parse(instanceParams.value) : {}
  } catch {
    useToasts().err('params must be valid JSON')
    return
  }
  const op = await runOp('WF_CREATE', { params })
  if (op?.status === 'DONE') {
    const result = op.result as { instanceId?: string; id?: string }
    lastCreated.value = result?.instanceId ?? result?.id ?? null
    useToasts().ok(`instance created${lastCreated.value ? `: ${lastCreated.value}` : ''}`)
    createOpen.value = false
    instanceParams.value = '{}'
  } else {
    useToasts().err(`create ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete (no cell?)'}`)
  }
}

/* inspect instance */
const inspectId = ref('')
const inspecting = ref<{ id: string; body: string } | null>(null)
async function submitInspect() {
  if (!inspectId.value.trim()) return
  const op = await runOp('WF_GET', { instanceId: inspectId.value.trim() })
  if (op?.status === 'DONE') {
    inspecting.value = { id: inspectId.value.trim(), body: JSON.stringify(op.result, null, 2) }
  } else {
    useToasts().err(`get ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}

/* instance action (pause/resume/terminate/restart — engine-defined verbs) */
async function sendAction(verb: string) {
  if (!inspectId.value.trim()) return
  const op = await runOp('WF_ACTION', { instanceId: inspectId.value.trim(), action: verb })
  if (op?.status === 'DONE') {
    useToasts().ok(`${verb} sent to ${inspectId.value.trim()}`)
    await submitInspect()
  } else {
    useToasts().err(`${verb} ${op?.status ?? 'failed'}: ${op?.error ?? 'op did not complete'}`)
  }
}
</script>

<template><div class="wrap pg-workflow" style="display: flex; flex-direction: column; gap: 18px">
    <div v-if="notFound" style="padding: 30px 0">
      <h1 style="font-size: 20px; margin: 0 0 8px">Workflow not found</h1>
      <p class="muted" style="font-size: 13.5px">No workflow named <span class="mono">{{ wfName }}</span> on this cell.</p>
      <NuxtLink to="/workflows" style="color: var(--accent); font-size: 13.5px">← Back to workflows</NuxtLink>
    </div>
    <template v-else-if="wf">
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Workflow</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">{{ wf.name }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">class <span class="mono" style="color: var(--t2)">{{ wf.className }}</span> · worker <NuxtLink :to="`/workers/${encodeURIComponent(workerRef?.name ?? '')}`" style="color: var(--accent)" class="mono">{{ workerRef?.name }}</NuxtLink></p>
      </div>
      <UiButton variant="primary" @click="createOpen = true"><UiIcon name="plus" />New instance</UiButton>
    </div>

    <section class="card" style="padding: 0">
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--b1)"><span class="sec-t" style="font-size: 14px">Inspect an instance</span><span class="muted" style="font-size: 12px; margin-left: 8px">the engine has no instance index — you need the instance id (shown when you create one)</span></div>
      <div style="padding: 14px 16px; display: flex; gap: 10px; align-items: center">
        <input v-model="inspectId" placeholder="instance id" class="mono" style="flex: 1; max-width: 420px; padding: 8px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none" @keydown.enter="submitInspect" />
        <UiButton variant="primary" size="sm" @click="submitInspect">Inspect</UiButton>
        <template v-if="inspecting">
          <UiButton variant="secondary" size="sm" @click="sendAction('pause')">Pause</UiButton>
          <UiButton variant="secondary" size="sm" @click="sendAction('resume')">Resume</UiButton>
          <UiButton variant="secondary" size="sm" @click="sendAction('restart')">Restart</UiButton>
          <UiButton variant="secondary" size="sm" style="color: var(--err)" @click="sendAction('terminate')">Terminate</UiButton>
        </template>
      </div>
      <div v-if="inspecting" style="padding: 0 16px 16px">
        <pre class="mono" style="background: var(--s2); padding: 12px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; max-height: 320px; overflow-y: auto">{{ inspecting.body }}</pre>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="createOpen" class="dlg-backdrop" @click.self="createOpen = false">
        <div class="dlg" role="dialog" style="width: 460px">
          <div style="padding: 16px 18px; border-bottom: 1px solid var(--b1); font-weight: 600">New instance of {{ wf.name }}</div>
          <form style="padding: 16px 18px; display: flex; flex-direction: column; gap: 12px" @submit.prevent="submitCreate">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px">
              <span class="muted">Params (JSON)</span>
              <textarea v-model="instanceParams" rows="6" class="mono" spellcheck="false" style="padding: 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font-size: 12px; resize: vertical" />
            </label>
            <div style="display: flex; justify-content: flex-end; gap: 8px">
              <UiButton variant="secondary" type="button" @click="createOpen = false">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :disabled="action.pending.value">Start instance</UiButton>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
    </template>
  </div></template>
