<script setup lang="ts">
definePageMeta({
  nav: 'D1',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'd1' }],
})
</script>

<template><div class="wrap pg-d1-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="d1" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">D1 SQL databases</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">SQLite databases bound with <span class="mono" style="color: var(--t2)">[[d1_databases]]</span>. Each database lives on one node; migrations run from <span class="mono" style="color: var(--t2)">migrations/</span>.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt d1 create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create database</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Databases"><template #value>9</template><UiMetricFoot>8 bound · 1 unbound</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Storage"><template #value>3.1<small> GB</small></template><UiMetricFoot>412 tables</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Rows read / written" hint="24h"><template #value>48.2<small> M / 1.3 M</small></template><UiMetricFoot>checkumi-db 65%</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Migrations"><template #value>2<small> pending</small></template><UiMetricFoot><span class="warn">checkumi-db</span></UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by name, ID or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Migrations"><UiSegment pressed>All <span class="n">9</span></UiSegment><UiSegment>Pending migrations <span class="n">1</span></UiSegment><UiSegment>Unbound <span class="n">1</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Node: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Size ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Database</th><th>Bound by</th><th style="text-align: right">Size</th><th style="text-align: right">Tables</th><th>Migrations</th><th>Node</th><th>Rows read 24h</th><th></th></tr></thead>
        <tbody>
          <tr class="sel"><td><div class="nm"><NuxtLink to="/d1/checkumi-db">checkumi-db</NuxtLink></div><div class="sm">DB · d1_4be20f7a</div></td><td><div class="bw"><span class="wk">checkumi-edge</span><span class="wk">checkumi-cron</span></div></td><td class="num" style="text-align: right">1.42 GB</td><td class="num" style="text-align: right">38</td><td><UiBadge tone="warn" dot>2 PENDING</UiBadge></td><td class="num muted">fsn · k3s-007</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">31.4M</span><ChartSparkline seed="d1l1" :width="60" :height="18" color="var(--accent)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-index</div><div class="sm">INDEX · d1_b20e771f</div></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td class="num" style="text-align: right">880 MB</td><td class="num" style="text-align: right">12</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">nbg · k3s-014</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">14.0M</span><ChartSparkline seed="d1l2" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">whois-snapshots</div><div class="sm">WHOIS · d1_0c3d5512</div></td><td><div class="bw"><span class="wk">whois-cron</span></div></td><td class="num" style="text-align: right">412 MB</td><td class="num" style="text-align: right">4</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">hel · k3s-016</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">2.1M</span><ChartSparkline seed="d1l3" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-search-meta</div><div class="sm">META · d1_77ac0b31</div></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td class="num" style="text-align: right">186 MB</td><td class="num" style="text-align: right">9</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">nbg · k3s-014</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">408k</span><ChartSparkline seed="d1l4" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">playtown-db</div><div class="sm">DB · d1_5e19f0c8</div></td><td><div class="bw"><span class="wk">playtown-api</span><span class="wk">playtown-hooks</span></div></td><td class="num" style="text-align: right">144 MB</td><td class="num" style="text-align: right">21</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">fsn · k3s-008</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">212k</span><ChartSparkline seed="d1l5" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">checkumi-audit</div><div class="sm">AUDIT · d1_a3f6c220</div></td><td><div class="bw"><span class="wk">checkumi-cron</span></div></td><td class="num" style="text-align: right">61 MB</td><td class="num" style="text-align: right">3</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">fsn · k3s-007</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">1.2k</span><ChartSparkline seed="d1l6" :width="60" :height="18" color="var(--t2)" /></div></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">opentin-staging</div><div class="sm">unbound · d1_19d0e44a</div></td><td><span class="muted" style="font-size: 12.5px">—</span></td><td class="num" style="text-align: right">24 MB</td><td class="num" style="text-align: right">12</td><td><UiBadge tone="neu" dot>NO MIGRATIONS</UiBadge></td><td class="num muted">fsn · k3s-007</td><td><span class="num">0</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>7 of 9 · sorted by size</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm">Next</UiButton></div>
      </div>
    </section>

  </div></template>
