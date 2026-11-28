<script setup lang="ts">
/** Real settings: vars, secrets and hostnames CRUD against the plane.
 *  Secrets are write-only — the API never returns their values, only keys. */
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'settings' }],
})
const route = useRoute()
const name = computed(() => String((route.params as { name?: string }).name))
const { detail, pending, refresh } = useWorkerDetail(name)
const { activeCell } = useCellSelection()
const action = useAction()
onMounted(() => void refresh())

const worker = computed(() => detail.value?.worker ?? null)
const varsList = computed(() => detail.value?.vars ?? [])
const secretKeys = computed(() => detail.value?.secretKeys ?? [])
const hostnames = computed(() => detail.value?.hostnames ?? [])

const wpath = () => {
  const w = worker.value!
  return `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(w.teamId)}/workers/${encodeURIComponent(w.name)}`
}

/* vars */
const newVarKey = ref('')
const newVarValue = ref('')
const keyRe = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
async function addVar() {
  const key = newVarKey.value.trim()
  if (!keyRe.test(key)) {
    useToasts().err('Var keys start with a letter or underscore; letters, digits, underscores.')
    return
  }
  const done = await action.run(
    () => consoleApi(`${wpath()}/vars/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: newVarValue.value } }),
    { success: `var ${key} saved — takes effect on next deploy` }
  )
  if (done !== undefined) {
    newVarKey.value = ''
    newVarValue.value = ''
    await refresh()
  }
}
async function removeVar(key: string) {
  const done = await action.run(() => consoleApi(`${wpath()}/vars/${encodeURIComponent(key)}`, { method: 'DELETE' }), { success: `var ${key} removed` })
  if (done !== undefined) await refresh()
}

/* secrets */
const newSecretKey = ref('')
const newSecretValue = ref('')
async function addSecret() {
  const key = newSecretKey.value.trim()
  if (!keyRe.test(key)) {
    useToasts().err('Secret keys start with a letter or underscore; letters, digits, underscores.')
    return
  }
  if (!newSecretValue.value) {
    useToasts().err('Secret value is empty.')
    return
  }
  const done = await action.run(
    () => consoleApi(`${wpath()}/secrets/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: newSecretValue.value } }),
    { success: `secret ${key} saved — takes effect on next deploy` }
  )
  if (done !== undefined) {
    newSecretKey.value = ''
    newSecretValue.value = ''
    await refresh()
  }
}
async function removeSecret(key: string) {
  const done = await action.run(() => consoleApi(`${wpath()}/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' }), { success: `secret ${key} removed` })
  if (done !== undefined) await refresh()
}

/* hostnames */
const newHostname = ref('')
async function addHostname() {
  const host = newHostname.value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9.-]{1,252}[a-z0-9]$/.test(host) || !host.includes('.')) {
    useToasts().err('Enter a valid hostname like api.example.com')
    return
  }
  const done = await action.run(
    () => consoleApi(`${wpath()}/hostnames`, { method: 'POST', body: { hostname: host } }),
    { success: `hostname ${host} attached` }
  )
  if (done !== undefined) {
    newHostname.value = ''
    await refresh()
  }
}
async function removeHostname(host: string) {
  const done = await action.run(
    () => consoleApi(`${wpath()}/hostnames/${encodeURIComponent(host)}`, { method: 'DELETE' }),
    { success: `hostname ${host} detached` }
  )
  if (done !== undefined) await refresh()
}

const inpStyle = 'padding: 7px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font: inherit; outline: none'
</script>

<template>
  <div v-if="pending && !detail" class="muted" style="padding: 20px 0">Loading…</div>
  <div v-else style="display: flex; flex-direction: column; gap: 16px">

    <section class="card" style="padding: 0">
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--b1)"><span class="sec-t" style="font-size: 14px">Environment variables</span><span class="mono dim" style="font-size: 12px; margin-left: 8px">{{ varsList.length }}</span></div>
      <table class="tbl">
        <tbody>
          <tr v-if="varsList.length === 0"><td class="muted" style="padding: 14px 16px">No vars yet.</td></tr>
          <tr v-for="v in varsList" :key="v.key">
            <td class="mono" style="width: 220px">{{ v.key }}</td>
            <td class="mono sm" style="word-break: break-all">{{ v.value }}</td>
            <td style="text-align: right; width: 80px"><UiButton variant="secondary" size="sm" @click="removeVar(v.key)">Remove</UiButton></td>
          </tr>
          <tr>
            <td><input v-model="newVarKey" placeholder="KEY" :style="inpStyle" style="width: 100%" class="mono" /></td>
            <td><input v-model="newVarValue" placeholder="value" :style="inpStyle" style="width: 100%" class="mono" @keydown.enter="addVar" /></td>
            <td style="text-align: right"><UiButton variant="primary" size="sm" :disabled="action.pending.value" @click="addVar">Add var</UiButton></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card" style="padding: 0">
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--b1)"><span class="sec-t" style="font-size: 14px">Secrets</span><span class="mono dim" style="font-size: 12px; margin-left: 8px">{{ secretKeys.length }}</span><span class="muted" style="font-size: 12px; margin-left: 8px">write-only — values are never readable back</span></div>
      <table class="tbl">
        <tbody>
          <tr v-if="secretKeys.length === 0"><td class="muted" style="padding: 14px 16px">No secrets yet.</td></tr>
          <tr v-for="k in secretKeys" :key="k">
            <td class="mono" style="width: 220px">{{ k }}</td>
            <td class="mono sm dim">••••••••</td>
            <td style="text-align: right; width: 80px"><UiButton variant="secondary" size="sm" @click="removeSecret(k)">Remove</UiButton></td>
          </tr>
          <tr>
            <td><input v-model="newSecretKey" placeholder="KEY" :style="inpStyle" style="width: 100%" class="mono" /></td>
            <td><input v-model="newSecretValue" type="password" placeholder="secret value" :style="inpStyle" style="width: 100%" class="mono" @keydown.enter="addSecret" /></td>
            <td style="text-align: right"><UiButton variant="primary" size="sm" :disabled="action.pending.value" @click="addSecret">Add secret</UiButton></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card" style="padding: 0">
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--b1)"><span class="sec-t" style="font-size: 14px">Hostnames</span><span class="mono dim" style="font-size: 12px; margin-left: 8px">{{ hostnames.length }}</span><span class="muted" style="font-size: 12px; margin-left: 8px">ingress routes requests by Host header</span></div>
      <table class="tbl">
        <tbody>
          <tr v-if="hostnames.length === 0"><td class="muted" style="padding: 14px 16px">No hostnames — the worker is unreachable from the ingress.</td></tr>
          <tr v-for="h in hostnames" :key="h.hostname">
            <td class="mono">{{ h.hostname }}</td>
            <td style="width: 100px"><UiBadge :tone="h.status === 'ACTIVE' ? 'ok' : 'neu'" dot>{{ h.status }}</UiBadge></td>
            <td style="text-align: right; width: 80px"><UiButton variant="secondary" size="sm" @click="removeHostname(h.hostname)">Remove</UiButton></td>
          </tr>
          <tr>
            <td colspan="2"><input v-model="newHostname" placeholder="api.example.com" :style="inpStyle" style="width: 100%" class="mono" @keydown.enter="addHostname" /></td>
            <td style="text-align: right"><UiButton variant="primary" size="sm" :disabled="action.pending.value" @click="addHostname">Attach</UiButton></td>
          </tr>
        </tbody>
      </table>
    </section>

  </div>
</template>
