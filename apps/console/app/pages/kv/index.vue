<script setup lang="ts">
definePageMeta({
  nav: 'KV',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'kv' }],
})
</script>

<template><div class="wrap pg-kv-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="kv" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">KV namespaces</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Eventually consistent key-value storage. Bind a namespace with <span class="mono" style="color: var(--t2)">[[kv_namespaces]]</span>; the binding name resolves to a namespace in this team.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt kv namespace create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create namespace</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Namespaces"><template #value>14</template><UiMetricFoot>12 bound · 2 unbound</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Keys"><template #value>1.82<small> M</small></template><UiMetricFoot>2.4 GB stored</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Reads" hint="24h"><template #value>9.1<small> M</small></template><UiMetricFoot>CHECKUMI_CACHE 68%</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Writes" hint="24h"><template #value>214<small> k</small></template><UiMetricFoot>deletes 3.2k · lists 41k</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by name, ID or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Binding"><UiSegment pressed>All <span class="n">14</span></UiSegment><UiSegment>Bound <span class="n">12</span></UiSegment><UiSegment>Unbound <span class="n">2</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Worker: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Reads ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Namespace</th><th>Bound by</th><th style="text-align: right">Keys</th><th style="text-align: right">Size</th><th>Reads 24h</th><th style="text-align: right">Writes 24h</th><th>Updated</th><th></th></tr></thead>
        <tbody>
          <UiLinkRow to="/kv/CHECKUMI_CACHE" class="sel"><td><div class="nm"><NuxtLink to="/kv/CHECKUMI_CACHE">CHECKUMI_CACHE</NuxtLink></div><div class="sm">kv_7f3a91c2</div></td><td><div class="bw"><span class="wk">checkumi-edge</span><span class="wk">checkumi-cron</span></div></td><td class="num" style="text-align: right">812,440</td><td class="num" style="text-align: right">1.1 GB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">6.2M</span><ChartSparkline seed="kvl1" :width="60" :height="18" color="var(--accent)" /></div></td><td class="num" style="text-align: right">98.1k</td><td class="num muted">4s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></UiLinkRow>
          <tr><td><div class="nm">SESSIONS</div><div class="sm">kv_02bd44e1</div></td><td><div class="bw"><span class="wk">checkumi-edge</span></div></td><td class="num" style="text-align: right">402,118</td><td class="num" style="text-align: right">612 MB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">2.4M</span><ChartSparkline seed="kvl2" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num" style="text-align: right">88.0k</td><td class="num muted">12s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">FLAGS</div><div class="sm">kv_9c10ab73</div></td><td><div class="bw"><span class="wk">playtown-hooks</span><span class="wk">+3</span></div></td><td class="num" style="text-align: right">214</td><td class="num" style="text-align: right">48 KB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">412k</span><ChartSparkline seed="kvl3" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num" style="text-align: right">12</td><td class="num muted">2d ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">RATE_LIMITS</div><div class="sm">kv_c4e8a210</div></td><td><div class="bw"><span class="wk">rybbit-proxy</span></div></td><td class="num" style="text-align: right">318,902</td><td class="num" style="text-align: right">96 MB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">208k</span><ChartSparkline seed="kvl4" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num" style="text-align: right">22.4k</td><td class="num muted">1s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">SEARCH_CACHE</div><div class="sm">kv_6a0f3db9</div></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td class="num" style="text-align: right">241,770</td><td class="num" style="text-align: right">488 MB</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">96.0k</span><ChartSparkline seed="kvl5" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num" style="text-align: right">3.1k</td><td class="num muted">40s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">DEMO_KV</div><div class="sm">kv_1d77e5c0</div></td><td><div class="bw"><span class="wk">vrt-kv-demo</span></div></td><td class="num" style="text-align: right">38</td><td class="num" style="text-align: right">6 KB</td><td><span class="num dim">—</span></td><td class="num dim" style="text-align: right">—</td><td class="num muted">18s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">REDIRECTS</div><div class="sm">kv_51ee0d08</div></td><td><div class="bw"><span class="wk">legacy-redirects</span></div></td><td class="num" style="text-align: right">3,904</td><td class="num" style="text-align: right">1.2 MB</td><td><span class="num">0</span></td><td class="num" style="text-align: right">0</td><td class="num muted">Oct 03</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">IMPORT_TMP</div><div class="sm">kv_e902b6f4</div></td><td><span class="muted" style="font-size: 12.5px">unbound</span></td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0 B</td><td><span class="num">0</span></td><td class="num" style="text-align: right">0</td><td class="num muted">Sep 28</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>8 of 14 · sorted by reads</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Namespaces are listed from each worker's bindings and merged client-side. <span class="miss"><UiIcon name="warn" :size="10" />account-level KV list API</span> Unbound namespaces appear only after the list API ships.</div></UiBanner>

  </div></template>
