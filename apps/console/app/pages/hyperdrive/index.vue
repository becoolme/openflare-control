<script setup lang="ts">
definePageMeta({
  nav: 'Hyperdrive',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'hyperdrive' }],
})
</script>

<template><div class="wrap pg-hyperdrive-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="hd" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Hyperdrive</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Pooled, cached Postgres connections from workers, bound with <span class="mono" style="color: var(--t2)">[[hyperdrive]]</span>. Point a config at a managed database or an external origin.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt hyperdrive create</UiButton>
        <UiButton variant="primary" disabled style="opacity: .5"><UiIcon name="plus" />Create config</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Configs"><template #value>2</template><UiMetricFoot>1 managed · 1 external</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Cache hit" hint="24h"><template #value>94.1<small> %</small></template><UiMetricFoot>checkumi-pg only</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Query p50"><template #value>4<small> ms</small></template><UiMetricFoot>p99 38 ms</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Pooled connections"><template #value>38<small> / 60</small></template><UiMetricFoot>2 pools</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by config, origin or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Origin"><UiSegment pressed>All <span class="n">2</span></UiSegment><UiSegment>Managed Postgres <span class="n">1</span></UiSegment><UiSegment>External <span class="n">1</span></UiSegment></UiSegmented>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Name ↑</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Config</th><th>Origin</th><th>Bound by</th><th>Caching</th><th style="text-align: right">Pool</th><th style="text-align: right">Cache hit</th><th style="text-align: right">Query p50</th><th></th></tr></thead>
        <tbody>
          <tr><td><div class="nm">checkumi-pg</div><div class="sm">HYPERDRIVE</div></td><td><div class="num">checkumi-prod <span class="dim">· Managed Postgres</span></div><div class="sm">grp3 · pooler :6432 · sslmode=require</div></td><td><span class="wk">rybbit-proxy</span></td><td><UiBadge tone="ok" dot>ON · 60 s</UiBadge></td><td class="num" style="text-align: right">28 / 40</td><td class="num" style="text-align: right">96.2%</td><td class="num" style="text-align: right">3.8 ms</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-ro</div><div class="sm">PG_RO</div></td><td><div class="num">opentin-main <span class="dim">· external</span></div><div class="sm">db.opentin.io:5432</div></td><td><span class="wk">opentin-search</span></td><td><UiBadge tone="neu" dot>OFF</UiBadge></td><td class="num" style="text-align: right">10 / 20</td><td class="num dim" style="text-align: right">—</td><td class="num" style="text-align: right">14.1 ms</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>2 of 2</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Configs are read from worker bindings. <span class="miss"><UiIcon name="warn" :size="10" />config CRUD API</span> <span class="miss"><UiIcon name="warn" :size="10" />config detail page</span> Until they ship, edit configs in <span class="mono">wrangler.toml</span> and redeploy.</div></UiBanner>

  </div></template>
