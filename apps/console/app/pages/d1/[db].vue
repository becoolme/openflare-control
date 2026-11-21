<script setup lang="ts">
definePageMeta({
  nav: 'D1',
  crumbs: () => [{ label: 'd1', to: '/storage' }, { label: 'checkumi-db' }],
  validate: (route) => (route.params as Record<string, unknown>).db === 'checkumi-db',
})
</script>

<template><div class="wrap pg-d1" style="display: flex; flex-direction: column; gap: 18px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="d1" />SQL database · SQLite</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">checkumi-db</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px; display: flex; gap: 14px; align-items: center"><span class="mono">d1_4be20f7a</span><UiIconButton icon="copy" :size="12" label="Copy ID" style="width: 22px; height: 22px" /><span>binding <span class="mono" style="color: var(--t2)">DB</span> in <span class="mono" style="color: var(--t2)">checkumi-edge</span></span><span>node <span class="mono">k3s-007</span></span><UiBadge tone="warn">2 pending migrations</UiBadge></p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="arrup" :size="13" />Export .sql <span class="miss" style="margin-left: 4px">API</span></UiButton>
        <UiButton variant="secondary"><UiIcon name="clock" :size="13" />Time Travel <span class="miss" style="margin-left: 4px">API</span></UiButton>
        <UiButton variant="primary"><UiIcon name="play" :size="13" />Apply migrations</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Database size"><template #value>184<small> MB</small></template><UiMetricFoot>7 tables · 12 indexes</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Queries" hint="24h"><template #value>1.84<small> M</small></template><ChartSparkline seed="d1q" :width="240" :height="18" color="#B48CFF" /></UiMetricCard>
      <UiMetricCard label="Rows read · written" hint="24h"><template #value>92<small> M · 310 k</small></template><ChartSparkline seed="d1r" :width="240" :height="18" color="var(--t2)" /></UiMetricCard>
      <UiMetricCard label="Query p95"><template #value>3.8<small> ms</small></template><UiMetricFoot class="ok">● healthy · WAL 2.1 MB</UiMetricFoot></UiMetricCard>
    </div>

    <UiTabs>
      <UiTab active>Console</UiTab><UiTab>Tables <span class="mono dim">7</span></UiTab><UiTab>Migrations <span class="mono dim" style="color: var(--warn)">2</span></UiTab><UiTab>Metrics</UiTab><UiTab>Settings</UiTab>
    </UiTabs>

    <div style="display: grid; grid-template-columns: 220px minmax(0, 1fr); border: 1px solid var(--b1); border-radius: 12px; overflow: hidden; background: var(--s1)">
      <aside class="tside">
        <UiInputBox style="height: 30px; margin-bottom: 6px"><UiIcon name="search" :size="13" /><span style="color: var(--t4)">Filter tables</span></UiInputBox>
        <div class="gh">Tables</div>
        <div class="ti"><UiIcon name="layers" :size="13" />checks<span class="c">48,210</span></div>
        <div class="ti on"><UiIcon name="layers" :size="13" />check_runs<span class="c">2.1M</span></div>
        <div class="ti"><UiIcon name="layers" :size="13" />items<span class="c">310,442</span></div>
        <div class="ti"><UiIcon name="layers" :size="13" />lists<span class="c">18,906</span></div>
        <div class="ti"><UiIcon name="layers" :size="13" />users<span class="c">9,418</span></div>
        <div class="ti"><UiIcon name="layers" :size="13" />share_tokens<span class="c">2,207</span></div>
        <div class="ti"><UiIcon name="layers" :size="13" />webhooks<span class="c">144</span></div>
        <div class="gh">System</div>
        <div class="ti" style="color: var(--t3)"><UiIcon name="layers" :size="13" />d1_migrations<span class="c">14</span></div>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm" style="justify-content: center; margin-top: 8px"><UiIcon name="plus" :size="12" />New table</UiButton>
      </aside>

      <section style="min-width: 0">
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--b1)">
          <UiSegmented role="group" aria-label="Query tabs"><UiSegment pressed>Query 1</UiSegment><UiSegment>failed runs</UiSegment><UiSegment><UiIcon name="plus" :size="12" /></UiSegment></UiSegmented>
          <div style="flex: 1"></div>
          <span class="muted" style="font-size: 12px">read-write · statements run in one batch</span>
          <UiButton variant="secondary" size="sm">Format</UiButton>
          <UiButton variant="primary" size="sm"><UiIcon name="play" :size="12" />Run <kbd>⌘↵</kbd></UiButton>
        </div>
        <div class="sqled"><div class="ln">1
2
3
4
5
6
7</div><div class="tx"><span class="k">SELECT</span> r.id, r.check_id, c.name, r.status, r.duration_ms, r.started_at
  <span class="k">FROM</span> check_runs r
  <span class="k">JOIN</span> checks c <span class="k">ON</span> c.id = r.check_id
 <span class="k">WHERE</span> r.status = <span class="s">'failed'</span>{{ "\n   " }}<span class="k">AND</span> r.started_at &gt;{{ " " }}<span class="v">datetime</span>(<span class="s">'now'</span>, <span class="s">'-1 day'</span>)
 <span class="k">ORDER BY</span> r.started_at <span class="k">DESC</span>{{ "\n " }}<span class="k">LIMIT</span>{{ " " }}<span class="p">50</span>;</div></div>
        <div style="display: flex; gap: 16px; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--b1); font-size: 12px" class="muted">
          <span class="ok"><UiIcon name="check" :size="11" /> success</span><span><span class="mono" style="color: var(--t1)">6</span> rows</span><span><span class="mono" style="color: var(--t1)">4.2 ms</span> duration</span><span><span class="mono" style="color: var(--t1)">2,184</span> rows read</span><span><span class="mono" style="color: var(--t1)">0</span> written</span>
          <div style="flex: 1"></div>
          <UiButton variant="secondary" size="sm"><UiIcon name="copy" :size="12" />Copy as CSV</UiButton>
          <UiButton variant="secondary" size="sm">EXPLAIN</UiButton>
        </div>
        <table class="tbl rg">
          <thead><tr><th>id<small>INTEGER</small></th><th>check_id<small>TEXT</small></th><th>name<small>TEXT</small></th><th>status<small>TEXT</small></th><th style="text-align: right">duration_ms<small>INT</small></th><th>started_at<small>TEXT</small></th></tr></thead>
          <tbody>
            <tr><td class="dim">2104418</td><td>chk_9a1f</td><td>api /health</td><td class="err">failed</td><td style="text-align: right">10000</td><td>2026-11-21 14:38:02</td></tr>
            <tr><td class="dim">2104377</td><td>chk_9a1f</td><td>api /health</td><td class="err">failed</td><td style="text-align: right">10000</td><td>2026-11-21 14:33:02</td></tr>
            <tr><td class="dim">2103950</td><td>chk_02be</td><td>pg tcp 5432</td><td class="err">failed</td><td style="text-align: right">3011</td><td>2026-11-21 13:02:41</td></tr>
            <tr><td class="dim">2101211</td><td>chk_77c0</td><td>cdn image</td><td class="err">failed</td><td style="text-align: right">842</td><td>2026-11-21 06:12:19</td></tr>
            <tr><td class="dim">2099804</td><td>chk_5d14</td><td>webhook echo</td><td class="err">failed</td><td style="text-align: right"><span class="nul">NULL</span></td><td>2026-11-21 01:44:55</td></tr>
            <tr><td class="dim">2098472</td><td>chk_02be</td><td>pg tcp 5432</td><td class="err">failed</td><td style="text-align: right">3008</td><td>2026-11-20 22:10:07</td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <div style="display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 12px">
      <section class="card" style="padding: 16px 18px">
        <div class="ch-h"><span class="t">Migrations</span><span class="v mono">migrations/ · 14 applied · 2 pending</span></div>
        <div class="mig"><span class="warn"><UiIcon name="clock" :size="13" /></span><span class="n">0016_add_check_region.sql</span><span style="display: flex; gap: 8px; align-items: center"><UiBadge tone="warn">pending</UiBadge></span></div>
        <div class="mig"><span class="warn"><UiIcon name="clock" :size="13" /></span><span class="n">0015_index_runs_status_started.sql</span><span style="display: flex; gap: 8px; align-items: center"><UiBadge tone="warn">pending</UiBadge></span></div>
        <div class="mig"><span class="ok"><UiIcon name="check" :size="13" /></span><span class="n">0014_share_tokens_expiry.sql</span><span class="mono dim" style="font-size: 11.5px">Nov 18 · v43</span></div>
        <div class="mig"><span class="ok"><UiIcon name="check" :size="13" /></span><span class="n">0013_webhooks.sql</span><span class="mono dim" style="font-size: 11.5px">Nov 02 · v39</span></div>
        <div class="mig"><span class="ok"><UiIcon name="check" :size="13" /></span><span class="n">0012_items_position.sql</span><span class="mono dim" style="font-size: 11.5px">Oct 21 · v36</span></div>
        <div style="display: flex; gap: 8px; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--b1)">
          <span class="muted" style="font-size: 12px; flex: 1">Applied in order inside a transaction; the first failure rolls back the batch and stops.</span>
          <UiButton variant="secondary" size="sm">Show 9 more</UiButton>
          <UiButton variant="primary" size="sm"><UiIcon name="play" :size="12" />Apply 2</UiButton>
        </div>
      </section>

      <div style="display: flex; flex-direction: column; gap: 12px">
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="t">Queries / min</span><span class="v">peak 2.9k · 14:05</span></div>
          <ChartArea seed="d1qm" :width="460" :height="70" color="#B48CFF" />
          <div class="axis"><span>-24h</span><span>-12h</span><span>now</span></div>
        </section>
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="t">Query history</span><a href="#" class="muted" style="font-size: 12.5px">All →</a></div>
          <div class="qh" style="border-top: 0"><span class="q">SELECT r.id, r.check_id, c.name … LIMIT 50</span><span class="mono dim">4.2 ms</span><span class="mono dim">now</span></div>
          <div class="qh"><span class="q">UPDATE checks SET interval_s = 60 WHERE id = 'chk_9a1f'</span><span class="mono dim">1.1 ms</span><span class="mono dim">12 m</span></div>
          <div class="qh"><span class="q">PRAGMA table_info(check_runs)</span><span class="mono dim">0.2 ms</span><span class="mono dim">40 m</span></div>
          <div class="qh"><span class="q err">DELETE FROM items WHERE list_id = ? — SQLITE_CONSTRAINT</span><span class="mono dim">0.4 ms</span><span class="mono dim">2 h</span></div>
        </section>
      </div>
    </div>

    <section class="card" style="padding: 16px 18px; display: flex; gap: 14px; align-items: center">
      <UiIcon name="shield" :size="18" />
      <div style="flex: 1">
        <div style="font-weight: 600; font-size: 13.5px">Backups &amp; point-in-time restore</div>
        <div class="muted" style="font-size: 12.5px">The SQLite file lives on the worker's deployment volume. Snapshots, Time Travel bookmarks and restore are not exposed yet.</div>
      </div>
      <span class="miss">backup / restore API</span>
      <UiButton variant="secondary" size="sm" disabled style="opacity: .5">Restore…</UiButton>
    </section>

  </div></template>
