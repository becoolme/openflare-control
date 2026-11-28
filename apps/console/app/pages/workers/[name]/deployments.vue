<script setup lang="ts">
/** Real deployments: every row is a version on the plane; Activate moves
 *  the worker's active version pointer and republishes. */
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'deployments' }],
})
const route = useRoute()
const name = computed(() => String((route.params as { name?: string }).name))
const { detail, pending, refresh } = useWorkerDetail(name)
const { activeCell } = useCellSelection()
const action = useAction()
onMounted(() => void refresh())

const versions = computed(() =>
  [...(detail.value?.versions ?? [])].sort((a, b) => b.createdAt?.localeCompare?.(a.createdAt ?? '') ?? 0)
)
const activeId = computed(() => detail.value?.worker.activeVersionId ?? null)

async function activate(v: VersionInfo) {
  const w = detail.value?.worker
  if (!w) return
  const done = await action.run(
    () =>
      consoleApi(
        `/api/v1/cells/${encodeURIComponent(activeCell.value)}/teams/${encodeURIComponent(w.teamId)}/workers/${encodeURIComponent(w.name)}/versions/${encodeURIComponent(v.versionId)}/activate`,
        { method: 'POST' }
      ),
    { success: `${v.versionId} is now live on ${w.name}` }
  )
  if (done !== undefined) await refresh()
}
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : '—'

/* Rollout truth: an activated version only serves once the cell APPLIES the
 * publication. A rejected generation (bad config, missing entrypoint, …)
 * leaves the old code serving — surface that instead of a silent LIVE badge. */
interface Publication {
  revision: number
  ackStatus: string
  cause: string | null
  workerId: string | null
  versionId: string | null
  ackReason: string | null
  ackTenantFailures: { tenant: string; code: string; detail?: string }[]
  issuedAt: string
}
const publications = ref<Publication[]>([])
async function refreshPublications() {
  const w = detail.value?.worker
  if (!w) return
  try {
    const res = await consoleApi<{ data: { publications: Publication[] } }>(
      `/api/v1/cells/${encodeURIComponent(activeCell.value)}/publications?limit=20`
    )
    publications.value = res.data.publications
  } catch {
    publications.value = []
  }
}
onMounted(() => void refreshPublications())
const workerPubs = computed(() => {
  const w = detail.value?.worker
  if (!w) return []
  const id = `${w.teamId}:${w.name}`
  return publications.value.filter((p) => p.workerId === id)
})
/* Rollouts are whole-cell and sequential, so the newest publication is the
 * honest current state: once one lands APPLIED, every older failure is
 * history. Only a newest entry that has not converged means the cell is
 * still rolling out — or, when the ack carries a failure reason, that the
 * generation was rejected and the previous one keeps serving. */
const stuckPub = computed(() => {
  const newest = publications.value[0]
  if (!newest || newest.ackStatus === 'APPLIED' || newest.ackStatus === 'SUPERSEDED') return null
  return newest
})
const stuckFailed = computed(
  () => !!(stuckPub.value?.ackReason || stuckPub.value?.ackTenantFailures?.length)
)
const pubByVersion = computed(() => {
  const m = new Map<string, Publication>()
  for (const p of workerPubs.value) if (p.versionId && !m.has(p.versionId)) m.set(p.versionId, p)
  return m
})
</script>

<template>
  <section class="card" style="padding: 0">
    <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
      <span class="sec-t" style="font-size: 14px">Deployments</span>
      <span class="mono dim" style="font-size: 12px">{{ versions.length }} version{{ versions.length === 1 ? '' : 's' }}</span>
      <div style="flex: 1"></div>
      <span class="muted" style="font-size: 12px">activating a version republishes the cell snapshot</span>
    </div>
    <div v-if="stuckPub" style="padding: 10px 16px; border-bottom: 1px solid var(--b1); background: color-mix(in srgb, var(--warn, #d97706) 8%, transparent)">
      <div style="font-size: 13px">
        <strong>Rollout {{ stuckPub.ackStatus.toLowerCase() }}</strong>
        <span class="muted"> — rev {{ stuckPub.revision }} ({{ (stuckPub.cause ?? '').toLowerCase() }}){{ stuckPub.ackReason ? ': ' + stuckPub.ackReason : '' }}. {{ stuckFailed ? 'The previous generation keeps serving.' : 'Waiting for the cell to converge…' }}</span>
      </div>
      <pre v-if="stuckPub.ackTenantFailures?.[0]?.detail" class="mono" style="margin: 8px 0 0; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: auto; color: var(--warn, #d97706)">{{ stuckPub.ackTenantFailures[0].detail }}</pre>
    </div>
    <table class="tbl">
      <thead><tr><th>Version</th><th>Bundle</th><th>Created</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-if="pending && !detail"><td colspan="5" class="muted" style="padding: 16px">Loading…</td></tr>
        <tr v-else-if="versions.length === 0"><td colspan="5" class="muted" style="padding: 16px">No deployments yet — use the Deploy button above.</td></tr>
        <tr v-for="v in versions" :key="v.versionId">
          <td><div class="nm mono">{{ v.versionId }}</div></td>
          <td class="mono sm">{{ (v.bundleSha256 ?? '').slice(0, 16) || '—' }}…</td>
          <td class="sm">{{ fmtTime(v.createdAt) }}</td>
          <td>
            <UiBadge v-if="v.versionId === activeId" tone="ok" dot>LIVE</UiBadge>
            <span v-else class="muted sm">inactive</span>
            <div v-if="pubByVersion.get(v.versionId)" class="muted" style="font-size: 11px; margin-top: 2px">
              rollout: {{ pubByVersion.get(v.versionId)!.ackStatus.toLowerCase() }}
            </div>
          </td>
          <td style="text-align: right">
            <UiButton
              v-if="v.versionId !== activeId"
              variant="secondary"
              size="sm"
              :disabled="action.pending.value"
              @click="activate(v)"
            >Activate</UiButton>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
