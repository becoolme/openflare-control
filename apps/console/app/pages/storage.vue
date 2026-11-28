<script setup lang="ts">
/** Real storage hub: counts come from the live resource list endpoints,
 *  creation happens on each resource's own page (where the dialogs live). */
definePageMeta({
  crumbs: () => [{ label: 'storage' }],
})
const { activeCell } = useCellSelection()
const { data, pending } = await useAsyncData(
  () => `storage-hub:${activeCell.value}`,
  async () => {
    if (!activeCell.value) return { kv: 0, d1: 0, r2: 0, queues: 0, hyperdrive: 0 }
    const cell = encodeURIComponent(activeCell.value)
    const [kv, d1, r2, queues, hyperdrive] = await Promise.all(
      [
        consoleApi<{ namespaces: unknown[] }>(`/api/v1/cells/${cell}/kv/namespaces`).then((r) => r.namespaces.length),
        consoleApi<{ databases: unknown[] }>(`/api/v1/cells/${cell}/d1/databases`).then((r) => r.databases.length),
        consoleApi<{ buckets: unknown[] }>(`/api/v1/cells/${cell}/r2/buckets`).then((r) => r.buckets.length),
        consoleApi<{ queues: unknown[] }>(`/api/v1/cells/${cell}/queues`).then((r) => r.queues.length),
        consoleApi<{ configs: unknown[] }>(`/api/v1/cells/${cell}/hyperdrive/configs`).then((r) => r.configs.length),
      ].map((p) => p.catch(() => 0))
    )
    return { kv, d1, r2, queues, hyperdrive }
  },
  { watch: [activeCell] }
)
const types = computed((): { key: 'kv' | 'd1' | 'r2' | 'q' | 'hd'; label: string; desc: string; to: string; count: number; color: string }[] => [
  { key: 'kv', label: 'KV', desc: 'namespaces', to: '/kv', count: data.value?.kv ?? 0, color: '#5EB0FF' },
  { key: 'd1', label: 'D1 SQL', desc: 'databases', to: '/d1', count: data.value?.d1 ?? 0, color: '#C6F432' },
  { key: 'r2', label: 'R2 Object Storage', desc: 'buckets', to: '/r2', count: data.value?.r2 ?? 0, color: '#FF9A4D' },
  { key: 'q', label: 'Queues', desc: 'queues', to: '/queues', count: data.value?.queues ?? 0, color: '#B69CFF' },
  { key: 'hd', label: 'Hyperdrive', desc: 'configs', to: '/hyperdrive', count: data.value?.hyperdrive ?? 0, color: '#F5B83D' },
])
</script>

<template><div class="wrap pg-storage" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Storage &amp; Databases</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">KV, D1, R2, Queues, Durable Objects and Hyperdrive. Resources are owned by the team and resolved per deployment.</p>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
      <NuxtLink v-for="t in types" :key="t.key" :to="t.to" style="text-decoration: none; color: inherit">
        <div class="card pc" style="cursor: pointer">
          <div class="hd"><span class="nmx">{{ t.label }}</span><ResourceBindingChip :kind="t.key" :label="String(t.count)" style="margin-left: auto"> {{ t.desc }}</ResourceBindingChip></div>
          <div class="big" :style="{ color: t.color }">{{ pending ? '…' : t.count }}</div>
          <div class="ft"><span>open {{ t.label }} →</span></div>
        </div>
      </NuxtLink>
      <NuxtLink to="/durable-objects" style="text-decoration: none; color: inherit">
        <div class="card pc" style="cursor: pointer">
          <div class="hd"><span class="nmx">Durable Objects</span><ResourceBindingChip kind="do" label="code" style="margin-left: auto"> from workers</ResourceBindingChip></div>
          <div class="big" style="color: #3DD68C">—</div>
          <div class="ft"><span>declared in worker migrations →</span></div>
        </div>
      </NuxtLink>
    </div>

    <p class="muted" style="font-size: 12.5px; margin: 0">Create and manage resources on each type's page — every create button there opens a working dialog against this cell.</p>

  </div></template>
