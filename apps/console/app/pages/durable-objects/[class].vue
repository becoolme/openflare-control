<script setup lang="ts">
definePageMeta({
  nav: 'DurableObjects',
  crumbs: () => [{ label: 'durable-objects', to: '/storage' }, { label: 'RoomDO' }],
  validate: (route) => (route.params as Record<string, unknown>).class === 'RoomDO',
})
const overlays = useOverlays(['instance'] as const)
</script>

<template><div class="wrap pg-durable-objects" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases · Durable Objects</div>
        <div style="display: flex; align-items: center; gap: 12px">
          <span class="pico" style="color: var(--ok)"><UiIcon name="layers" :size="16" /></span>
          <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em" class="mono">RoomDO</h1>
          <UiBadge tone="ok" dot>ACTIVE</UiBadge>
          <UiBadge tone="warn" dot>MIGRATION v3 PENDING</UiBadge>
        </div>
        <p class="muted" style="margin: 8px 0 0; font-size: 13.5px">Class exported by <NuxtLink to="/workers/checkumi-edge" class="mono" style="color: var(--t2)">checkumi-edge</NuxtLink> · binding <span class="mono" style="color: var(--t2)">ROOMS</span> · namespace <span class="mono" style="color: var(--t2)">do_ns_4f0c…a21</span></p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="shield" :size="13" />Snapshot namespace</UiButton>
        <UiButton variant="primary"><UiIcon name="play" :size="13" />Run migration v3</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Storage backend" value-style="font-size: 18px"><template #value>SQLite</template><UiMetricFoot>new_sqlite_classes · per-object DB</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Instances" hint="total"><template #value>1,284</template><UiMetricFoot><span class="ok">37 active</span> · 1,247 hibernated</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage" hint="all objects"><template #value>2.41<small> GiB</small></template><UiMetricFoot>largest room:lobby 48 MiB</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Requests" hint="24h"><template #value>612<small> k</small></template><UiMetricFoot>alarms fired 3,920 · ws 211</UiMetricFoot></UiMetricCard>
    </div>

    <UiTabs>
      <UiTab active>Instances <span class="mono dim">1,284</span></UiTab>
      <UiTab>Migrations <span class="mono dim">3</span></UiTab>
      <UiTab>Snapshots <span class="mono dim">6</span></UiTab>
      <UiTab>Metrics</UiTab>
    </UiTabs>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 0; border: 1px solid var(--b1); border-radius: 12px; overflow: hidden; background: var(--s1)">
      <div style="min-width: 0">
        <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
          <UiInputBox style="flex: 1"><UiIcon name="search" /><span>Find by name (idFromName) or hex id…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
          <UiSegmented role="group" aria-label="State"><UiSegment pressed>All</UiSegment><UiSegment>Active</UiSegment><UiSegment>Alarm set</UiSegment></UiSegmented>
        </div>
        <table class="tbl">
          <thead><tr><th>Instance</th><th>Storage</th><th>Last active</th><th>Alarm</th><th>Node</th></tr></thead>
          <tbody>
            <tr class="sel" @click="overlays.toggle('instance')"><td><div class="nm">room:lobby <UiBadge tone="ok" dot style="height: 18px; font-size: 10px">ACTIVE</UiBadge></div><div class="sm">a91f0c3e…7d2b</div></td><td class="num">48.2 MiB</td><td class="num">now · 14 ws</td><td class="num">in 42 s</td><td class="num muted">k3s-014</td></tr>
            <tr><td><div class="nm">room:m_8f21</div><div class="sm">3c0e81aa…f001</div></td><td class="num">1.9 MiB</td><td class="num">12 s ago</td><td class="num">in 9 m</td><td class="num muted">k3s-014</td></tr>
            <tr><td><div class="nm">room:m_8f19</div><div class="sm">77ba20d1…09e4</div></td><td class="num">2.3 MiB</td><td class="num">4 m ago</td><td class="num dim">—</td><td class="num muted">k3s-016</td></tr>
            <tr><td><div class="nm">room:tourney-11</div><div class="sm">e40f9c12…aa13</div></td><td class="num">11.7 MiB</td><td class="num">1 h ago</td><td class="num">Nov 22 09:00</td><td class="num muted">k3s-016</td></tr>
            <tr><td><div class="nm dim">— unnamed —</div><div class="sm">newUniqueId · 0f7d3a55…be71</div></td><td class="num">84 KiB</td><td class="num">yesterday</td><td class="num dim">—</td><td class="num muted">k3s-014</td></tr>
            <tr class="dim"><td><div class="nm">room:m_7a02</div><div class="sm">hibernated · 19be7700…4c9a</div></td><td class="num">640 KiB</td><td class="num">Nov 09</td><td class="num dim">—</td><td class="num muted">k3s-014</td></tr>
          </tbody>
        </table>
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted"><span>6 of 1,284 · sorted by last active</span><UiButton variant="secondary" size="sm">Load more</UiButton></div>
      </div>
      <UiDrawer v-if="overlays.isOpen('instance')" aria-label="Instance detail">
        <UiDrawerHeader><span class="mono" style="font-weight: 600">room:lobby</span><UiBadge tone="ok" dot>ACTIVE</UiBadge><div style="flex: 1"></div><UiIconButton icon="copy" label="Copy id" /><UiIconButton icon="x" label="Close" @click="overlays.close('instance')" /></UiDrawerHeader>
        <UiDrawerBody>
          <div>
            <UiKeyValueRow label="Object id">a91f0c3e5b…e7d2b</UiKeyValueRow>
            <UiKeyValueRow label="Storage">48.2 MiB · 3 tables</UiKeyValueRow>
            <UiKeyValueRow label="Connections">14 WebSockets (hibernatable)</UiKeyValueRow>
            <UiKeyValueRow label="Alarm" value-style="color: var(--warn)">15:42:10 UTC · in 42 s</UiKeyValueRow>
          </div>
          <div>
            <div class="ch-h" style="margin-bottom: 6px"><span class="gl">Storage preview</span><span class="hint">read-only · first 6 keys</span></div>
            <div style="border: 1px solid var(--b1); border-radius: 8px; background: var(--bg)">
              <div class="skv"><span>state</span><span>212 B</span></div>
              <div class="skv"><span>players:count</span><span>8 B</span></div>
              <div class="skv"><span>players:u_291c</span><span>1.1 KiB</span></div>
              <div class="skv"><span>players:u_77ab</span><span>1.0 KiB</span></div>
              <div class="skv"><span>sql: messages (9,410 rows)</span><span>46 MiB</span></div>
              <div class="skv"><span>sql: _cf_KV</span><span>4 KiB</span></div>
            </div>
          </div>
          <UiBanner tone="info" icon="info" :icon-size="14" style="font-size: 12.5px"><div>Snapshots capture this object's SQLite file through <span class="mono">/v1/do/snapshot</span>. Restore is per namespace.</div></UiBanner>
        </UiDrawerBody>
        <UiDrawerFooter><UiButton variant="secondary" size="sm"><UiIcon name="shield" :size="12" />Snapshot</UiButton><UiButton variant="secondary" size="sm"><UiIcon name="logs" :size="12" />Tail logs</UiButton><div style="flex: 1"></div><UiButton variant="secondary" size="sm" style="color: var(--err)"><UiIcon name="trash" :size="12" />Delete instance</UiButton></UiDrawerFooter>
      </UiDrawer>
    </div>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 460px; gap: 12px; align-items: start">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><div><h2 class="sec-t">Migrations</h2><p class="sec-d">From <span class="mono">[[migrations]]</span> in <span class="mono">wrangler.toml</span>. Applied in order on deploy; pending tags block new code that needs them.</p></div></div>
        <div class="mig"><span class="dot" style="border-color: var(--ok); background: var(--ok)"></span><div><div class="mono" style="font-size: 13px">v1 · <span style="color: var(--t2)">new_sqlite_classes = ["RoomDO"]</span></div><div class="hint" style="margin-top: 3px">applied Oct 21 · deploy v12</div></div><UiBadge tone="ok" dot>APPLIED</UiBadge></div>
        <div class="mig"><span class="dot" style="border-color: var(--ok); background: var(--ok)"></span><div><div class="mono" style="font-size: 13px">v2 · <span style="color: var(--t2)">renamed_classes = [{ from = "Room", to = "RoomDO" }]</span></div><div class="hint" style="margin-top: 3px">applied Nov 02 · deploy v31 · 1,102 objects moved</div></div><UiBadge tone="ok" dot>APPLIED</UiBadge></div>
        <div class="mig"><span class="dot" style="border-color: var(--warn)"></span><div><div class="mono" style="font-size: 13px">v3 · <span style="color: var(--t2)">deleted_classes = ["LegacyPresence"]</span></div><div class="hint" style="margin-top: 3px">in v43 (canary 10%) · deletes 182 LegacyPresence objects and their storage</div></div><div style="display: flex; gap: 6px; align-items: center"><UiBadge tone="warn" dot>PENDING</UiBadge><UiButton variant="primary" size="sm">Run</UiButton></div></div>
        <div class="code" style="font-size: 11.5px; padding: 10px 12px; margin-top: 12px"><span class="c"># same call the console makes</span>{{ "\n" }}<span class="p">POST</span> /v1/do/migrate  <span class="s">{ "worker": "checkumi-edge", "tag": "v3", "dryRun": false }</span></div>
      </section>
      <div style="display: flex; flex-direction: column; gap: 8px">
        <div class="gl">Delete instance · confirm</div>
        <UiDialog inline aria-label="Delete instance">
          <UiDialogBody>
            <UiDialogTitle>Delete room:lobby?</UiDialogTitle>
            <p class="muted" style="font-size: 13px; margin: 0 0 12px; line-height: 1.55">The object's storage (<b style="color: var(--t1)">48.2 MiB</b>, 3 tables), its alarm and 14 open WebSockets are dropped. The next request to <span class="mono">idFromName("room:lobby")</span> creates an empty object.</p>
            <UiBanner tone="err" icon="warn" :icon-size="14" style="font-size: 12.5px; margin-bottom: 12px"><div><b>Data is lost.</b> Take a snapshot first if you may need it.</div></UiBanner>
            <label class="chk" style="margin-bottom: 12px"><UiCheckbox checked />Snapshot before deleting</label>
            <div class="field"><label>Type <span class="mono" style="color: var(--t1)">room:lobby</span> to confirm</label><UiInputBox focused><span class="mono" style="color: var(--t1)">room:lobby</span></UiInputBox></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">do.instance.delete</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton size="sm" style="background: var(--err); color: #fff; border-color: transparent">Snapshot &amp; delete</UiButton></UiDialogFooter>
        </UiDialog>
      </div>
    </div>

  </div></template>
