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
</script>

<template>
  <section class="card" style="padding: 0">
    <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
      <span class="sec-t" style="font-size: 14px">Deployments</span>
      <span class="mono dim" style="font-size: 12px">{{ versions.length }} version{{ versions.length === 1 ? '' : 's' }}</span>
      <div style="flex: 1"></div>
      <span class="muted" style="font-size: 12px">activating a version republishes the cell snapshot</span>
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
