<script setup lang="ts">
import { ConsoleApiError } from '../../composables/useConsoleApi'

definePageMeta({
  nav: 'Metrics',
  crumbs: () => [{ label: 'kit' }, { label: 'api coverage' }],
})

type Row = {
  feature: string
  endpoint: string
  status: 'live' | 'partial' | 'missing' | 'error'
  note: string
}

const { activeCell, refresh } = useCellSelection()
const rows = ref<Row[]>([])
const pending = ref(true)
const error = ref<string | null>(null)

async function probe(path: string): Promise<Row['status']> {
  try {
    await consoleApi(path)
    return 'live'
  } catch (e) {
    return e instanceof ConsoleApiError && (e.status === 404 || e.status === 501) ? 'missing' : 'error'
  }
}

async function run() {
  pending.value = true
  error.value = null
  await refresh()
  const cell = activeCell.value
  if (!cell) {
    rows.value = []
    pending.value = false
    return
  }
  const base = `/api/v1/cells/${cell}`
  const [dbs, buckets, queues, catalog] = await Promise.all([
    consoleApi<{ databases: { database_id: string }[] }>(`${base}/d1/databases`),
    consoleApi<{ buckets: { bucket_name: string }[] }>(`${base}/r2/buckets`),
    consoleApi<{ queues: { queue_id: string }[] }>(`${base}/queues`),
    consoleApi<{ workflows: { workerId: string; name: string }[] }>(`${base}/services`),
  ])
  const probes: [string, string, string][] = [
    ['Cells', '/api/v1/cells', 'list/select cells'],
    ['Teams + quotas', '/api/v1/teams', 'list/create/get/patch/delete'],
    ['Workers', `${base}/workers`, 'list/create/get/patch/delete'],
    ['D1 databases', `${base}/d1/databases`, 'list/create; query/migrations enqueue'],
    ['R2 buckets', `${base}/r2/buckets`, 'list/create; object ops via cell-ops'],
    ['KV namespaces', `${base}/kv/namespaces`, 'list/create; data ops via cell-ops'],
    ['Queues', `${base}/queues`, 'list/create/patch delay'],
    ['Service catalog', `${base}/services`, 'aggregated bindings'],
    ['Publications', `${base}/publications`, 'publish + ACK state'],
    ['Logs', `${base}/logs`, 'ingest + query'],
    ['Worker metrics', `${base}/metrics`, 'runtime deltas: requests/errors/latency/CPU/cold starts'],
    ['Hyperdrive', `${base}/hyperdrive`, 'resource metadata + binding'],
  ]
  if (dbs.databases[0]) {
    probes.push([
      'D1 stats',
      `${base}/d1/databases/${dbs.databases[0].database_id}/stats`,
      'size/tables from the data plane; pending migrations from the ledger',
    ])
  }
  if (buckets.buckets[0]) {
    probes.push([
      'R2 stats',
      `${base}/r2/buckets/${encodeURIComponent(buckets.buckets[0].bucket_name)}/stats?waitMs=0`,
      'cached object/size scan; refresh with waitMs',
    ])
  }
  if (queues.queues[0]) {
    probes.push([
      'Queue stats',
      `${base}/queues/${queues.queues[0].queue_id}/stats`,
      'backlog/visible/in-flight/delayed/DLQ',
    ])
  }
  const wf = catalog.workflows[0]
  if (wf) {
    const [teamId, ...parts] = wf.workerId.split(':')
    const worker = parts.join(':')
    const wfBase = `${base}/teams/${encodeURIComponent(teamId ?? '')}/workers/${encodeURIComponent(worker)}/workflows/${encodeURIComponent(wf.name)}`
    probes.push(
      ['Workflow stats', `${wfBase}/stats`, 'instance count/storage + op ledger'],
      ['Workflow instances', `${base}/workflows/${encodeURIComponent(wf.name)}/instances`, 'engine class-dir files']
    )
  }
  const out: Row[] = []
  for (const [feature, endpoint, note] of probes) {
    out.push({ feature, endpoint, note, status: await probe(endpoint) })
  }
  // Honest partials: the endpoint is live, but the runtime cannot measure this.
  out.push(
    {
      feature: 'Per-worker CPU / cold starts',
      endpoint: `${base}/teams/{team}/workers/{name}/metrics`,
      status: 'partial',
      note: 'null by design: CPU is per tenant process, launches are per pod',
    },
    {
      feature: 'Workflow per-state counters',
      endpoint: `${base}/teams/{team}/workers/{name}/workflows/{name}/stats`,
      status: 'partial',
      note: 'instance files are listed; running/waiting/completed need an engine status index',
    },
    {
      feature: 'DO active instances',
      endpoint: `${base}/durable-objects/{class}/stats`,
      status: 'partial',
      note: 'instance/storage real; active count needs a liveness index',
    },
    {
      feature: 'Queue delivered',
      endpoint: `${base}/queues/{id}/stats`,
      status: 'partial',
      note: 'backlog real; the delivered counter is not in the pod scrape yet',
    },
    {
      feature: 'Team/user profile',
      endpoint: '/api/v1/me',
      status: 'missing',
      note: 'team/quotas exist; user identity/auth profile is still static',
    }
  )
  rows.value = out
  pending.value = false
}

onMounted(run)
</script>

<template>
  <div class="wrap" style="display: flex; flex-direction: column; gap: 20px">
    <div>
      <div class="gl" style="margin-bottom: 6px">Diagnostics</div>
      <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">
        Console ↔ API coverage
      </h1>
      <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">
        Probes the live management API for the selected cell and lists the UI surfaces that still
        have no endpoint. Missing rows are the backlog for the next API batch.
      </p>
    </div>

    <section class="card" style="padding: 0">
      <table class="tbl">
        <thead>
          <tr><th>Feature</th><th>Endpoint</th><th>Status</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr v-if="pending"><td colspan="4" class="muted" style="padding: 18px">Probing…</td></tr>
          <tr v-else-if="error"><td colspan="4" style="padding: 18px; color: var(--err)">{{ error }}</td></tr>
          <tr v-for="row in rows" :key="row.feature + row.endpoint">
            <td><div class="nm">{{ row.feature }}</div></td>
            <td class="mono" style="font-size: 12px">{{ row.endpoint }}</td>
            <td>
              <UiBadge :tone="row.status === 'live' ? 'ok' : row.status === 'partial' ? 'warn' : row.status === 'missing' ? 'neu' : 'err'" dot>
                {{ row.status.toUpperCase() }}
              </UiBadge>
            </td>
            <td class="muted" style="font-size: 12.5px">{{ row.note }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
