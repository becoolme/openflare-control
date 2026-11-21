<script setup lang="ts">
import { ConsoleApiError } from '../../composables/useConsoleApi'

definePageMeta({
  nav: 'Metrics',
  crumbs: () => [{ label: 'kit' }, { label: 'api coverage' }],
})

type Row = {
  feature: string
  endpoint: string
  status: 'live' | 'missing' | 'error'
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
    return e instanceof ConsoleApiError && e.status === 404 ? 'missing' : 'error'
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
  const probes: [string, string, string][] = [
    ['Cells', '/api/v1/cells', 'list/select cells'],
    ['Workers', `/api/v1/cells/${cell}/workers`, 'list/create/get/patch/delete'],
    ['D1 databases', `/api/v1/cells/${cell}/d1/databases`, 'list/create; query/migrations enqueue'],
    ['R2 buckets', `/api/v1/cells/${cell}/r2/buckets`, 'list/create; object ops via cell-ops'],
    ['KV namespaces', `/api/v1/cells/${cell}/kv/namespaces`, 'list/create; data ops via cell-ops'],
    ['Queues', `/api/v1/cells/${cell}/queues`, 'list/create/patch delay'],
    ['Service catalog', `/api/v1/cells/${cell}/services`, 'aggregated bindings'],
    ['Workflows', `/api/v1/cells/${cell}/services`, 'declarations + instance ops'],
    ['Durable Objects', `/api/v1/cells/${cell}/services`, 'class list via worker durable-objects'],
    ['Publications', `/api/v1/cells/${cell}/publications`, 'publish + ACK state'],
    ['Logs', `/api/v1/cells/${cell}/logs`, 'ingest + query'],
  ]
  const out: Row[] = []
  for (const [feature, endpoint, note] of probes) {
    out.push({ feature, endpoint, note, status: await probe(endpoint) })
  }
  // Features the UI needs but the plane does not expose yet.
  out.push(
    {
      feature: 'Hyperdrive resources',
      endpoint: '/api/v1/cells/{cell}/hyperdrive',
      status: 'missing',
      note: 'UI page exists; only version bindings can carry HYPERDRIVE',
    },
    {
      feature: 'Worker metrics',
      endpoint: '/api/v1/cells/{cell}/metrics',
      status: 'missing',
      note: 'requests/errors/CPU/cold starts are static in the UI',
    },
    {
      feature: 'D1 stats',
      endpoint: '/api/v1/cells/{cell}/d1/databases/{id}/stats',
      status: 'missing',
      note: 'size/tables/pending migrations not exposed',
    },
    {
      feature: 'R2 stats',
      endpoint: '/api/v1/cells/{cell}/r2/buckets/{name}/stats',
      status: 'missing',
      note: 'object count/size/class A-B ops not aggregated',
    },
    {
      feature: 'Queue metrics',
      endpoint: '/api/v1/cells/{cell}/queues/{id}/stats',
      status: 'missing',
      note: 'backlog/delivered/oldest/DLQ depth not exposed',
    },
    {
      feature: 'Workflow instances',
      endpoint: '/api/v1/cells/{cell}/workflows/{name}/instances',
      status: 'missing',
      note: 'only op channel exists; no instance list/read',
    },
    {
      feature: 'DO instances/storage',
      endpoint: '/api/v1/cells/{cell}/durable-objects/{class}/instances',
      status: 'missing',
      note: 'class list exists; instances/storage not exposed',
    },
    {
      feature: 'Team/quota/user',
      endpoint: '/api/v1/team',
      status: 'missing',
      note: 'shell team/plan/quota data is static',
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
              <UiBadge :tone="row.status === 'live' ? 'ok' : row.status === 'missing' ? 'warn' : 'err'" dot>
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
