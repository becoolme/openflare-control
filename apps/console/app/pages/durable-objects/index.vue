<script setup lang="ts">
definePageMeta({
  nav: 'DurableObjects',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'durable-objects' }],
})
</script>

<template><div class="wrap pg-do-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="do" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Durable Objects</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Classes exported by workers and declared in <span class="mono" style="color: var(--t2)">[[durable_objects.bindings]]</span>. Classes come from code; add one by deploying a worker with a new migration.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt deploy</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Classes"><template #value>4</template><UiMetricFoot>across 4 workers</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Instances"><template #value>8,912</template><UiMetricFoot>RoomDO 94%</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Active now"><template #value>312</template><UiMetricFoot>8,600 hibernated</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>640<small> MB</small></template><UiMetricFoot>SQLite 598 MB · KV 42 MB</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by class, binding or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Storage"><UiSegment pressed>All <span class="n">4</span></UiSegment><UiSegment>SQLite <span class="n">3</span></UiSegment><UiSegment>KV <span class="n">1</span></UiSegment></UiSegmented>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Instances ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Class</th><th>Worker</th><th>Binding</th><th>Storage backend</th><th style="text-align: right">Instances</th><th style="text-align: right">Active</th><th style="text-align: right">Storage</th><th>Requests 24h</th><th></th></tr></thead>
        <tbody>
          <UiLinkRow to="/durable-objects/RoomDO" class="sel"><td><div class="nm"><NuxtLink to="/durable-objects/RoomDO">RoomDO</NuxtLink></div><div class="sm">do_ns_4f0c…a21</div></td><td><span class="wk">checkumi-edge</span></td><td class="num">ROOMS</td><td><UiBadge tone="neu" dot>SQLITE · v3</UiBadge></td><td class="num" style="text-align: right">8,412</td><td class="num" style="text-align: right">288</td><td class="num" style="text-align: right">590 MB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">2.1M</span><ChartSparkline seed="dol1" :width="60" :height="18" color="var(--accent)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></UiLinkRow>
          <tr><td><div class="nm">RateLimiter</div><div class="sm">do_ns_91b2…07e</div></td><td><span class="wk">rybbit-proxy</span></td><td class="num">LIMITER</td><td><UiBadge tone="neu" dot>KV · v1</UiBadge></td><td class="num" style="text-align: right">488</td><td class="num" style="text-align: right">22</td><td class="num" style="text-align: right">42 MB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">1.6M</span><ChartSparkline seed="dol2" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">GameLobby</div><div class="sm">do_ns_2d7a…c90</div></td><td><span class="wk">playtown-hooks</span></td><td class="num">LOBBY</td><td><UiBadge tone="neu" dot>SQLITE · v1</UiBadge></td><td class="num" style="text-align: right">12</td><td class="num" style="text-align: right">2</td><td class="num" style="text-align: right">8 MB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">41.2k</span><ChartSparkline seed="dol3" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">DigestLock</div><div class="sm">do_ns_c013…5b8</div></td><td><span class="wk">playtown-api</span></td><td class="num">DIGEST_LOCK</td><td><UiBadge tone="neu" dot>SQLITE · v1</UiBadge></td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0 B</td><td><span class="num">0</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>4 of 4 · sorted by instances</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Classes are listed from each worker's Durable Object bindings. <span class="miss"><UiIcon name="warn" :size="10" />account-level DO namespace list API</span> Instance counts come from the per-class detail API.</div></UiBanner>

  </div></template>
