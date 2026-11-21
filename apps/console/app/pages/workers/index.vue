<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers' }],
})
const overlays = useOverlays(['create', 'row'] as const)
</script>

<template><div class="wrap pg-workers" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workers</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Workers-compatible functions on real <span class="mono" style="color: var(--t2)">workerd</span>. Deploy a <span class="mono" style="color: var(--t2)">wrangler.toml</span> project unchanged; bindings resolve to resources in this team.</p>
      </div>
      <div style="display: flex; gap: 8px; position: relative">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt deploy</UiButton>
        <UiButton variant="primary" @click="overlays.toggle('create')" :aria-expanded="overlays.isOpen('create') ? 'true' : 'false'"><UiIcon name="plus" />Create<span style="opacity: .6; margin-left: 2px"><UiIcon name="chev" :size="13" /></span></UiButton>
        <UiMenu v-if="overlays.isOpen('create')" style="right: 0; top: 40px; width: 300px">
          <UiMenuLabel>New worker</UiMenuLabel>
          <UiMenuItem icon="layers" hint="12" highlighted>Start from a template</UiMenuItem>
          <UiMenuItem icon="github" hint="GitHub">Import a Git repository</UiMenuItem>
          <UiMenuItem icon="upload" hint="≤ 25 MB">Upload project (.zip / dist)</UiMenuItem>
          <UiMenuItem icon="term" hint="copy cmd">Deploy with vrt CLI</UiMenuItem>
          <UiMenuSeparator />
          <UiMenuLabel>Other</UiMenuLabel>
          <UiMenuItem to="/workflows/order-fulfillment" icon="redo" hint="needs a worker">Workflow</UiMenuItem>
          <UiMenuItem icon="clock" hint="on a worker">Cron trigger</UiMenuItem>
        </UiMenu>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Workers"><template #value>27</template><UiMetricFoot>23 live · 1 err · 2 idle</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Requests" hint="24h"><template #value>3.41<small> M</small></template><UiMetricFoot>peak 118 req/s</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Error rate" hint="24h"><template #value>0.21<small> %</small></template><UiMetricFoot><span class="warn">playtown-hooks 4.7%</span></UiMetricFoot></UiMetricCard>
      <UiMetricCard label="CPU p50 / p99"><template #value>1.8<small> / 22 ms</small></template><UiMetricFoot>limit 50 ms</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Cold starts" hint="24h"><template #value>412<small> · 38 ms</small></template><UiMetricFoot>snapshot restore p50</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0; position: relative">
      <UiTabs style="padding: 0 10px">
        <UiTab active>Workers <span class="mono dim">27</span></UiTab>
        <UiTab to="/workflows/order-fulfillment">Workflows <span class="mono dim">6</span></UiTab>
        <UiTab>Cron triggers <span class="mono dim">9</span></UiTab>
        <UiTab>Queue consumers <span class="mono dim">5</span></UiTab>
      </UiTabs>
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by name, route or binding…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All <span class="n">27</span></UiSegment><UiSegment>Live <span class="n">23</span></UiSegment><UiSegment>Errors <span class="n">1</span></UiSegment><UiSegment>Deploying <span class="n">1</span></UiSegment><UiSegment>Idle <span class="n">2</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Binding: any</UiButton>
        <UiButton variant="secondary" size="sm"><UiIcon name="layers" :size="12" />Project: all</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Requests ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Worker</th><th>Status</th><th>Deployment</th><th>Bindings</th><th>Requests 24h</th><th>Errors</th><th>CPU p99</th><th></th></tr></thead>
        <tbody>
          <tr class="sel">
            <td><div class="nm"><NuxtLink to="/workers/checkumi-edge">checkumi-edge</NuxtLink></div><div class="sm">w-checkumi-edge.example.dev</div></td>
            <td><UiBadge tone="ok" dot>LIVE</UiBadge></td>
            <td><div class="num">v42 <span class="dim">90%</span> · v43 <span class="warn">10%</span></div><div class="split" style="width: 120px; margin-top: 6px"><span style="width: 90%; background: var(--t3)"></span><span style="width: 10%; background: var(--warn)"></span></div><div class="sm">2m · alex</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="kv">2</ResourceBindingChip><ResourceBindingChip kind="d1">1</ResourceBindingChip><ResourceBindingChip kind="r2">1</ResourceBindingChip><ResourceBindingChip kind="q">1</ResourceBindingChip><ResourceBindingChip kind="do">1</ResourceBindingChip></div></td>
            <td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">1.24M</span><ChartSparkline seed="a1" :width="60" :height="18" color="var(--accent)" /></div></td>
            <td class="num">0.08%</td>
            <td class="num">3.1 ms</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </tr>
          <tr>
            <td><div class="nm">rybbit-proxy</div><div class="sm">w-rybbit-proxy.example.dev</div></td>
            <td><UiBadge tone="ok" dot>LIVE</UiBadge></td>
            <td><div class="num">v118 <span class="dim">100%</span></div><div class="sm">1h · ci</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="sv">1</ResourceBindingChip><ResourceBindingChip kind="hd">1</ResourceBindingChip></div></td>
            <td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">1.61M</span><ChartSparkline seed="b2" :width="60" :height="18" color="var(--t2)" /></div></td>
            <td class="num">0.02%</td>
            <td class="num">1.4 ms</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </tr>
          <tr>
            <td><div class="nm">playtown-hooks</div><div class="sm">w-playtown-hooks.example.dev</div></td>
            <td><UiBadge tone="warn" dot>ERRORS</UiBadge></td>
            <td><div class="num">v9 <span class="dim">100%</span></div><div class="sm">yesterday</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="q">2</ResourceBindingChip><ResourceBindingChip kind="kv">1</ResourceBindingChip><ResourceBindingChip kind="wf">1</ResourceBindingChip></div></td>
            <td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">88.2k</span><ChartSparkline seed="c3" :width="60" :height="18" color="var(--warn)" /></div></td>
            <td class="num warn">4.71%</td>
            <td class="num">12.8 ms</td>
            <td style="text-align: right; position: relative"><UiIconButton icon="more" :size="15" label="More actions" style="background: var(--s2); border-color: var(--b2); color: var(--t1)" @click="overlays.toggle('row')" :aria-expanded="overlays.isOpen('row') ? 'true' : 'false'" />
              <UiMenu v-if="overlays.isOpen('row')" style="right: 6px; top: 40px; text-align: left; width: 236px">
                <UiMenuItem to="/workers/checkumi-edge" icon="ext">Open worker</UiMenuItem>
                <UiMenuItem to="/workers/checkumi-edge/logs" icon="logs" hint="T" highlighted>Live tail</UiMenuItem>
                <UiMenuItem to="/workers/checkumi-edge/deployments" icon="redo">Roll back to v8…</UiMenuItem>
                <UiMenuItem icon="copy">Copy URL</UiMenuItem>
                <UiMenuItem icon="term">Copy <span class="mono">vrt deploy</span> cmd</UiMenuItem>
                <UiMenuSeparator />
                <UiMenuItem to="/kit/ops" icon="trash" style="color: var(--err)">Delete worker…</UiMenuItem>
              </UiMenu>
            </td>
          </tr>
          <tr>
            <td><div class="nm">opentin-search</div><div class="sm">w-opentin-search.example.dev</div></td>
            <td><UiBadge tone="ok" dot>LIVE</UiBadge></td>
            <td><div class="num">v27 <span class="dim">100%</span></div><div class="sm">Nov 14 · ci</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="d1">2</ResourceBindingChip><ResourceBindingChip kind="kv">1</ResourceBindingChip><ResourceBindingChip kind="as" /></div></td>
            <td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">402k</span><ChartSparkline seed="d4" :width="60" :height="18" color="var(--t2)" /></div></td>
            <td class="num">0.11%</td>
            <td class="num">22.4 ms</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </tr>
          <tr>
            <td><div class="nm">whois-cron</div><div class="sm">no route · <span style="color: var(--t3)"><UiIcon name="clock" :size="11" /> */15 * * * *</span></div></td>
            <td><UiBadge tone="ok" dot>LIVE</UiBadge></td>
            <td><div class="num">v6 <span class="dim">100%</span></div><div class="sm">Nov 12</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="d1">1</ResourceBindingChip><ResourceBindingChip kind="r2">1</ResourceBindingChip></div></td>
            <td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">96</span><span class="sm" style="margin: 0">cron runs</span></div></td>
            <td class="num">0.00%</td>
            <td class="num">180 ms</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </tr>
          <tr>
            <td><div class="nm">vrt-kv-demo</div><div class="sm">w-vrt-kv-demo.example.dev</div></td>
            <td><UiBadge tone="info"><UiIcon name="spin" :size="11" />DEPLOYING</UiBadge></td>
            <td><div class="num">v3 → v4</div><div class="sm" style="color: var(--info)">signing snapshot · 18 s</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="kv">1</ResourceBindingChip></div></td>
            <td><span class="num dim">—</span></td>
            <td class="num dim">—</td>
            <td class="num dim">—</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </tr>
          <tr class="dim">
            <td><div class="nm">legacy-redirects</div><div class="sm">w-legacy-redirects.example.dev</div></td>
            <td><UiBadge tone="neu" dot>IDLE</UiBadge></td>
            <td><div class="num">v2 <span class="dim">100%</span></div><div class="sm">scaled to zero · 9d</div></td>
            <td><div style="display: flex; gap: 4px"><ResourceBindingChip kind="kv">1</ResourceBindingChip></div></td>
            <td><span class="num">0</span></td>
            <td class="num dim">—</td>
            <td class="num dim">—</td>
            <td style="text-align: right"><UiIconButton icon="more" :size="15" label="More actions" /></td>
          </tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>7 of 27 · sorted by requests</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm">Next</UiButton></div>
      </div>
    </section>

    <div style="display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: 12px">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Start from a template</span><a href="#" class="muted" style="font-size: 12.5px">All 12 →</a></div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">Hello World</div><div class="muted" style="font-size: 12px; margin-top: 3px">fetch handler · TS</div></a>
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">D1 REST API <ResourceBindingChip kind="d1" /></div><div class="muted" style="font-size: 12px; margin-top: 3px">Hono + migrations</div></a>
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">Queue consumer <ResourceBindingChip kind="q" /></div><div class="muted" style="font-size: 12px; margin-top: 3px">batch + DLQ</div></a>
          <a href="#" class="card" style="padding: 12px; background: var(--s2)"><div class="nm" style="font-size: 13px">Static site <ResourceBindingChip kind="as" /></div><div class="muted" style="font-size: 12px; margin-top: 3px">SPA fallback</div></a>
        </div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Deploy from your terminal</span><UiIconButton icon="copy" :size="13" label="Copy" /></div>
        <div class="code" style="font-size: 12px; padding: 12px 14px"><span class="c"># existing Cloudflare project — no changes</span>{{ "\n" }}<span class="p">$</span> vrt login
<span class="p">$</span> vrt deploy <span class="c">--config wrangler.toml</span>{{ "\n" }}<span class="ok">✓</span> uploaded 3 modules · 41.2 KiB
<span class="ok">✓</span> v43 live on <span class="s">w-checkumi-edge.example.dev</span></div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Usage this month</span><span class="v">Pro · resets Dec 1</span></div>
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px">
          <div><div style="display: flex; justify-content: space-between"><span class="muted">Requests</span><span class="num">61.2M / 100M</span></div><div class="bar"><span style="width: 61%; background: var(--accent)"></span></div></div>
          <div><div style="display: flex; justify-content: space-between"><span class="muted">CPU time</span><span class="num">412 / 1,000 core·h</span></div><div class="bar"><span style="width: 41%; background: var(--t2)"></span></div></div>
          <div><div style="display: flex; justify-content: space-between"><span class="muted">Workers</span><span class="num">27 / 100</span></div><div class="bar"><span style="width: 27%; background: var(--t2)"></span></div></div>
          <div class="muted" style="font-size: 12px">Quota from team plan · <span class="miss"><UiIcon name="warn" :size="10" />no per-worker cap API</span></div>
        </div>
      </section>
    </div>

  </div></template>
