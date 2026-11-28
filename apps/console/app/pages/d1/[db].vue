<script setup lang="ts">
/** Real D1 database detail: a working SQL console. Queries run as cell ops
 *  (the data plane executes SQLite on the cell); results render as tables.
 *  When no cell is connected the op stays PENDING and the UI says so. */
definePageMeta({
  nav: 'D1',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'd1', to: '/d1' }, { label: 'database' }],
})
const route = useRoute()
const dbName = computed(() => String((route.params as { db?: string }).db))
const { activeCell } = useCellSelection()
const action = useAction()

/* resolve database row by name */
interface D1Row {
  database_id: string
  team_id: string
  cluster_id: string
  name: string
}
const db = ref<D1Row | null>(null)
const notFound = ref(false)
async function resolveDb() {
  if (!activeCell.value) return
  const data = await consoleApi<{ databases: D1Row[] }>(
    `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases`
  )
  db.value = data.databases.find((d) => d.name === dbName.value) ?? null
  notFound.value = !db.value
}
watch(activeCell, (c) => { if (c) void resolveDb() }, { immediate: true })

interface OpResult {
  status: string
  result?: unknown
  error?: string | null
}
async function runQuery(sql: string): Promise<OpResult | undefined> {
  return action.run(
    async () => {
      const submitted = await consoleApi<{ op: OpInfo }>(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/d1/databases/${encodeURIComponent(db.value!.database_id)}/query`,
        { method: 'POST', body: { sql, params: [] } }
      )
      return waitForOp(activeCell.value, submitted.op.id, 15_000)
    },
    { silent: true }
  )
}

/* SQL console */
const sql = ref('SELECT name, sql FROM sqlite_master WHERE type = \'table\' ORDER BY name;')
const running = ref(false)
const queryError = ref<string | null>(null)
const resultRows = ref<Record<string, unknown>[] | null>(null)
const resultMeta = ref('')
async function execute() {
  if (!sql.value.trim() || !db.value) return
  running.value = true
  queryError.value = null
  resultRows.value = null
  const op = await runQuery(sql.value)
  running.value = false
  if (!op) {
    queryError.value = 'op submit failed'
    return
  }
  if (op.status !== 'SUCCEEDED') {
    queryError.value =
      op.status === 'PENDING'
        ? 'query op is still PENDING — no cell is connected to execute it'
        : op.error ?? `op ${op.status}`
    return
  }
  const result = op.result as {
    results?: Record<string, unknown>[]
    rows?: Record<string, unknown>[]
    meta?: { changes?: number; rows_read?: number; duration_ms?: number }
  }
  const rowsOut = result?.results ?? result?.rows ?? []
  resultRows.value = rowsOut
  const m = result?.meta
  resultMeta.value = m
    ? `${rowsOut.length} row${rowsOut.length === 1 ? '' : 's'} · ${m.changes ?? 0} changes · ${m.rows_read ?? '—'} read${m.duration_ms !== undefined ? ` · ${m.duration_ms} ms` : ''}`
    : `${rowsOut.length} row${rowsOut.length === 1 ? '' : 's'}`
}
const columns = computed(() => {
  if (!resultRows.value?.length) return []
  const cols: string[] = []
  for (const row of resultRows.value.slice(0, 50)) {
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k)
  }
  return cols
})

/* schema browser: tables through a real query */
const tables = ref<string[]>([])
async function loadSchema() {
  if (!db.value) return
  const op = await runQuery('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' AND name NOT LIKE \'_litestream%\' ORDER BY name;')
  if (op?.status === 'SUCCEEDED') {
    const result = op.result as { results?: { name: string }[]; rows?: { name: string }[] }
    tables.value = (result?.results ?? result?.rows ?? []).map((r) => r.name)
  }
}
watch(db, () => {
  if (db.value) void loadSchema()
})
function browseTable(t: string) {
  sql.value = `SELECT * FROM "${t}" LIMIT 100;`
  void execute()
}
async function copyId() {
  if (!db.value) return
  await navigator.clipboard.writeText(db.value.database_id)
  useToasts().ok('database id copied')
}
</script>

<template><div class="wrap pg-d1" style="display: flex; flex-direction: column; gap: 18px">
    <div v-if="notFound" style="padding: 30px 0">
      <h1 style="font-size: 20px; margin: 0 0 8px">Database not found</h1>
      <p class="muted" style="font-size: 13.5px">No D1 database named <span class="mono">{{ dbName }}</span> on this cell.</p>
      <NuxtLink to="/d1" style="color: var(--accent); font-size: 13.5px">← Back to D1</NuxtLink>
    </div>
    <template v-else>
    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="d1" />D1 database</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">{{ dbName }}</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px; display: flex; gap: 10px; align-items: center">
          <span class="mono">{{ db?.database_id }}</span>
          <UiIconButton icon="copy" :size="12" label="Copy ID" style="width: 22px; height: 22px" @click="copyId" />
          <span v-if="db">team <span class="mono" style="color: var(--t2)">{{ db.team_id }}</span></span>
        </p>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 12px; align-items: start">
      <section class="card" style="padding: 12px">
        <div class="ch-h" style="margin-bottom: 8px"><span class="t">Tables</span><UiIconButton icon="redo" :size="12" label="Reload" style="width: 22px; height: 22px" @click="loadSchema" /></div>
        <div v-if="tables.length === 0" class="muted" style="font-size: 12.5px">No user tables yet — or the schema query is still pending on the cell.</div>
        <a v-for="t in tables" :key="t" href="#" class="mono" style="display: block; padding: 5px 6px; border-radius: 5px; font-size: 12.5px; color: var(--accent)" @click.prevent="browseTable(t)">{{ t }}</a>
      </section>

      <section class="card" style="padding: 0">
        <div style="padding: 12px 14px; border-bottom: 1px solid var(--b1); display: flex; gap: 10px; align-items: center">
          <span class="sec-t" style="font-size: 14px">SQL console</span>
          <span class="muted" style="font-size: 12px">executes as a cell op against the real SQLite file</span>
        </div>
        <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px">
          <textarea
            v-model="sql"
            rows="5"
            spellcheck="false"
            class="mono"
            style="padding: 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 6px; color: inherit; font-size: 12.5px; resize: vertical"
            @keydown.meta.enter="execute"
            @keydown.ctrl.enter="execute"
          />
          <div style="display: flex; align-items: center; gap: 10px">
            <UiButton variant="primary" size="sm" :disabled="running" @click="execute">{{ running ? 'Running…' : 'Run query' }}</UiButton>
            <span class="muted" style="font-size: 12px">⌘⏎ to run</span>
            <div style="flex: 1"></div>
            <span v-if="resultMeta" class="mono dim" style="font-size: 12px">{{ resultMeta }}</span>
          </div>
          <div v-if="queryError" style="color: var(--err); font-size: 12.5px">{{ queryError }}</div>
        </div>
        <table v-if="resultRows && resultRows.length > 0" class="tbl" style="border-top: 1px solid var(--b1)">
          <thead><tr><th v-for="c in columns" :key="c" class="mono">{{ c }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in resultRows.slice(0, 200)" :key="i">
              <td v-for="c in columns" :key="c" class="mono sm" style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ row[c] === null ? 'NULL' : typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c]) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="resultRows" class="muted" style="padding: 14px; font-size: 13px; border-top: 1px solid var(--b1)">Query succeeded — no rows returned.</div>
      </section>
    </div>
    </template>
  </div></template>
