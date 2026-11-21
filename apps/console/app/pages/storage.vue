<script setup lang="ts">
definePageMeta({
  crumbs: () => [{ label: 'storage' }],
})
const overlays = useOverlays(['create'] as const)
</script>

<template><div class="wrap pg-storage" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Storage &amp; Databases</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">KV, D1, R2, Queues, Durable Objects and Hyperdrive. Resources are owned by the team and resolved per deployment; Cloudflare IDs in <span class="mono" style="color: var(--t2)">wrangler.toml</span> are ignored.</p>
      </div>
      <div style="display: flex; gap: 8px; position: relative">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt d1 create</UiButton>
        <UiButton variant="primary" @click="overlays.toggle('create')" :aria-expanded="overlays.isOpen('create') ? 'true' : 'false'"><UiIcon name="plus" />Create<span style="opacity: .6; margin-left: 2px"><UiIcon name="chev" :size="13" /></span></UiButton>
        <UiMenu v-if="overlays.isOpen('create')" style="right: 0; top: 40px; width: 280px">
          <UiMenuLabel>New resource</UiMenuLabel>
          <UiMenuItem hint="K" highlighted><ResourceBindingChip kind="kv" />KV namespace</UiMenuItem>
          <UiMenuItem to="/d1/checkumi-db" hint="D"><ResourceBindingChip kind="d1" />D1 database</UiMenuItem>
          <UiMenuItem to="/r2/checkumi-assets/objects" hint="R"><ResourceBindingChip kind="r2" />R2 bucket</UiMenuItem>
          <UiMenuItem hint="Q"><ResourceBindingChip kind="q" />Queue</UiMenuItem>
          <UiMenuItem hint="H"><ResourceBindingChip kind="hd" />Hyperdrive config</UiMenuItem>
          <UiMenuSeparator />
          <UiMenuItem hint="from code" style="color: var(--t3)"><ResourceBindingChip kind="do" />Durable Objects</UiMenuItem>
        </UiMenu>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 10px">
      <UiSegmented role="group" aria-label="Type"><UiSegment pressed>All <span class="n">41</span></UiSegment><UiSegment>KV <span class="n">14</span></UiSegment><UiSegment>D1 <span class="n">9</span></UiSegment><UiSegment>R2 <span class="n">5</span></UiSegment><UiSegment>Queues <span class="n">7</span></UiSegment><UiSegment>Durable Objects <span class="n">4</span></UiSegment><UiSegment>Hyperdrive <span class="n">2</span></UiSegment></UiSegmented>
      <UiInputBox style="width: 260px"><UiIcon name="search" /><span>Filter by name or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
      <div style="flex: 1"></div>
      <span class="muted" style="font-size: 12px">Updated 30 s ago</span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
      <div class="card pc"><div class="hd"><span class="pico"><UiIcon name="logs" :size="15" /></span><span class="nmx">KV</span><ResourceBindingChip kind="kv" label="14" style="margin-left: auto"> namespaces</ResourceBindingChip></div><div class="big">1.82M<small> keys · 2.4 GB</small></div><div class="ft"><span>reads 9.1M / writes 214k · 24h</span></div><ChartSparkline seed="kv1" :width="300" :height="22" color="#5EB0FF" /></div>
      <div class="card pc"><div class="hd"><span class="pico"><UiIcon name="db" :size="15" /></span><span class="nmx">D1 SQL</span><ResourceBindingChip kind="d1" label="9" style="margin-left: auto"> databases</ResourceBindingChip></div><div class="big">3.1<small> GB · 412 tables</small></div><div class="ft"><span>rows read 48.2M · written 1.3M</span><span class="warn">2 pending migr.</span></div><ChartSparkline seed="d11" :width="300" :height="22" color="#C6F432" /></div>
      <div class="card pc"><div class="hd"><span class="pico"><UiIcon name="upload" :size="15" /></span><span class="nmx">R2 Object Storage</span><ResourceBindingChip kind="r2" label="5" style="margin-left: auto"> buckets</ResourceBindingChip></div><div class="big">184k<small> objects · 61.7 GB</small></div><div class="ft"><span>class A 412k · class B 6.8M</span></div><ChartSparkline seed="r21" :width="300" :height="22" color="#FF9A4D" /></div>
      <div class="card pc"><div class="hd"><span class="pico"><UiIcon name="layers" :size="15" /></span><span class="nmx">Queues</span><ResourceBindingChip kind="q" label="7" style="margin-left: auto"> queues</ResourceBindingChip></div><div class="big">1,284<small> backlog · 3 in DLQ</small></div><div class="ft"><span>delivered 2.2M · 24h</span><span class="warn">playtown-events lagging</span></div><ChartSparkline seed="q1" :width="300" :height="22" color="#B69CFF" /></div>
      <div class="card pc"><div class="hd"><span class="pico"><UiIcon name="layers" :size="15" /></span><span class="nmx">Durable Objects</span><ResourceBindingChip kind="do" label="4" style="margin-left: auto"> classes</ResourceBindingChip></div><div class="big">8,912<small> instances · 640 MB</small></div><div class="ft"><span>312 active · 8,600 hibernated</span></div><ChartSparkline seed="do1" :width="300" :height="22" color="#3DD68C" /></div>
      <div class="card pc"><div class="hd"><span class="pico"><UiIcon name="zap" :size="15" /></span><span class="nmx">Hyperdrive</span><ResourceBindingChip kind="hd" label="2" style="margin-left: auto"> configs</ResourceBindingChip></div><div class="big">94.1<small> % cache hit · p50 4 ms</small></div><div class="ft"><span>pooled 38 / 60 conns</span></div><ChartSparkline seed="hd1" :width="300" :height="22" color="#F5B83D" /></div>
    </div>

    <UiBanner tone="info" icon="info"><div>KV, Queues and Durable Objects are bound per worker. This hub <b>aggregates them client-side</b> from each worker's bindings; D1 and R2 use the account-level <span class="mono">/api/workers/d1</span> and <span class="mono">/api/workers/r2</span> lists. <span class="miss"><UiIcon name="warn" :size="10" />account-level list API: KV · Queues · DO · Hyperdrive</span></div></UiBanner>

    <!-- KV -->
    <section class="card" style="padding: 0">
      <div class="lh"><ResourceBindingChip kind="kv" /><span class="t">KV namespaces</span><span class="d">14 · eventually consistent key-value</span><div style="flex: 1"></div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />New namespace</UiButton><UiButton variant="secondary" size="sm" to="/kv/CHECKUMI_CACHE">View all →</UiButton></div>
      <table class="tbl">
        <thead><tr><th>Namespace</th><th>Bound by</th><th style="text-align: right">Keys</th><th style="text-align: right">Size</th><th style="text-align: right">Reads 24h</th><th style="text-align: right">Writes 24h</th><th>Updated</th><th></th></tr></thead>
        <tbody>
          <tr class="sel"><td><div class="nm"><NuxtLink to="/kv/CHECKUMI_CACHE">CHECKUMI_CACHE</NuxtLink></div><div class="sm">kv_7f3a91c2</div></td><td><div class="bw"><span class="wk">checkumi-edge</span><span class="wk">checkumi-cron</span></div></td><td class="num" style="text-align: right">812,440</td><td class="num" style="text-align: right">1.1 GB</td><td class="num" style="text-align: right">6.2M</td><td class="num" style="text-align: right">98.1k</td><td class="num muted">4s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">SESSIONS</div><div class="sm">kv_02bd44e1</div></td><td><div class="bw"><span class="wk">checkumi-edge</span></div></td><td class="num" style="text-align: right">402,118</td><td class="num" style="text-align: right">612 MB</td><td class="num" style="text-align: right">2.4M</td><td class="num" style="text-align: right">88.0k</td><td class="num muted">12s ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">FLAGS</div><div class="sm">kv_9c10ab73</div></td><td><div class="bw"><span class="wk">playtown-hooks</span><span class="wk">+3</span></div></td><td class="num" style="text-align: right">214</td><td class="num" style="text-align: right">48 KB</td><td class="num" style="text-align: right">412k</td><td class="num" style="text-align: right">12</td><td class="num muted">2d ago</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">REDIRECTS</div><div class="sm">kv_51ee0d08</div></td><td><div class="bw"><span class="wk">legacy-redirects</span></div></td><td class="num" style="text-align: right">3,904</td><td class="num" style="text-align: right">1.2 MB</td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0</td><td class="num muted">Oct 03</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
    </section>

    <!-- D1 -->
    <section class="card" style="padding: 0">
      <div class="lh"><ResourceBindingChip kind="d1" /><span class="t">D1 databases</span><span class="d">9 · SQLite at the edge</span><div style="flex: 1"></div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />New database</UiButton><UiButton variant="secondary" size="sm" to="/d1/checkumi-db">View all →</UiButton></div>
      <table class="tbl">
        <thead><tr><th>Database</th><th>Bound by</th><th style="text-align: right">Size</th><th style="text-align: right">Tables</th><th>Migrations</th><th>Node</th><th style="text-align: right">Rows read 24h</th><th></th></tr></thead>
        <tbody>
          <tr><td><div class="nm"><NuxtLink to="/d1/checkumi-db">checkumi-db</NuxtLink></div><div class="sm">DB · d1_4a1c09e7</div></td><td><div class="bw"><span class="wk">checkumi-edge</span><span class="wk">checkumi-cron</span></div></td><td class="num" style="text-align: right">1.42 GB</td><td class="num" style="text-align: right">38</td><td><UiBadge tone="warn" dot>2 PENDING</UiBadge></td><td class="num muted">fsn · k3s-007</td><td class="num" style="text-align: right">31.4M</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-index</div><div class="sm">INDEX · d1_b20e771f</div></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td class="num" style="text-align: right">880 MB</td><td class="num" style="text-align: right">12</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">nbg · k3s-014</td><td class="num" style="text-align: right">14.0M</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">whois-snapshots</div><div class="sm">WHOIS · d1_0c3d5512</div></td><td><div class="bw"><span class="wk">whois-cron</span></div></td><td class="num" style="text-align: right">412 MB</td><td class="num" style="text-align: right">4</td><td><UiBadge tone="ok" dot>UP TO DATE</UiBadge></td><td class="num muted">hel · k3s-016</td><td class="num" style="text-align: right">2.1M</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-staging</div><div class="sm">unbound</div></td><td><span class="muted" style="font-size: 12.5px">—</span></td><td class="num" style="text-align: right">24 MB</td><td class="num" style="text-align: right">12</td><td><UiBadge tone="neu" dot>NO MIGRATIONS</UiBadge></td><td class="num muted">fsn · k3s-007</td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
    </section>

    <!-- R2 -->
    <section class="card" style="padding: 0">
      <div class="lh"><ResourceBindingChip kind="r2" /><span class="t">R2 buckets</span><span class="d">5 · S3-compatible object storage</span><div style="flex: 1"></div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />New bucket</UiButton><UiButton variant="secondary" size="sm" to="/r2/checkumi-assets/objects">View all →</UiButton></div>
      <table class="tbl">
        <thead><tr><th>Bucket</th><th>Bound by</th><th style="text-align: right">Objects</th><th style="text-align: right">Size</th><th>Public access</th><th style="text-align: right">Class A / B 24h</th><th>Created</th><th></th></tr></thead>
        <tbody>
          <tr><td><div class="nm"><NuxtLink to="/r2/checkumi-assets/objects">checkumi-assets</NuxtLink></div><div class="sm">ASSETS_BUCKET</div></td><td><div class="bw"><span class="wk">checkumi-edge</span></div></td><td class="num" style="text-align: right">128,402</td><td class="num" style="text-align: right">42.8 GB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge> <span class="miss">public URL</span></td><td class="num" style="text-align: right">288k / 5.1M</td><td class="num muted">Sep 12</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">whois-archive</div><div class="sm">ARCHIVE</div></td><td><div class="bw"><span class="wk">whois-cron</span></div></td><td class="num" style="text-align: right">51,040</td><td class="num" style="text-align: right">18.4 GB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">96 / 1.4k</td><td class="num muted">Oct 02</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-uploads</div><div class="sm">UPLOADS</div></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td class="num" style="text-align: right">4,912</td><td class="num" style="text-align: right">512 MB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">124k / 1.3M</td><td class="num muted">Nov 02</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
    </section>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start">
      <!-- Queues -->
      <section class="card" style="padding: 0">
        <div class="lh"><ResourceBindingChip kind="q" /><span class="t">Queues</span><span class="d">7</span><div style="flex: 1"></div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />New queue</UiButton><UiButton variant="secondary" size="sm" to="/queues/playtown-events">View all →</UiButton></div>
        <table class="tbl">
          <thead><tr><th>Queue</th><th style="text-align: right">Backlog</th><th>Consumer</th><th style="text-align: right">DLQ</th><th></th></tr></thead>
          <tbody>
            <tr><td><div class="nm"><NuxtLink to="/queues/playtown-events">playtown-events</NuxtLink></div><div class="sm">2 producers</div></td><td class="num warn" style="text-align: right">1,204</td><td><span class="wk">playtown-hooks</span></td><td class="num err" style="text-align: right">3</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><div class="nm">checkumi-jobs</div><div class="sm">1 producer</div></td><td class="num" style="text-align: right">72</td><td><span class="wk">checkumi-cron</span></td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><div class="nm">whois-fetch</div><div class="sm">1 producer</div></td><td class="num" style="text-align: right">8</td><td><span class="wk">whois-cron</span></td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          </tbody>
        </table>
      </section>
      <!-- DO -->
      <section class="card" style="padding: 0">
        <div class="lh"><ResourceBindingChip kind="do" /><span class="t">Durable Objects</span><span class="d">4 classes</span><div style="flex: 1"></div><UiButton variant="secondary" size="sm" to="/durable-objects/RoomDO">View all →</UiButton></div>
        <table class="tbl">
          <thead><tr><th>Class</th><th>Worker</th><th style="text-align: right">Instances</th><th style="text-align: right">Storage</th><th></th></tr></thead>
          <tbody>
            <tr><td><div class="nm"><NuxtLink to="/durable-objects/RoomDO">RoomState</NuxtLink></div><div class="sm">SQLite · v3 migration</div></td><td><span class="wk">checkumi-edge</span></td><td class="num" style="text-align: right">8,412</td><td class="num" style="text-align: right">590 MB</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><div class="nm">RateLimiter</div><div class="sm">KV storage</div></td><td><span class="wk">rybbit-proxy</span></td><td class="num" style="text-align: right">488</td><td class="num" style="text-align: right">42 MB</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><div class="nm">GameLobby</div><div class="sm">SQLite · v1</div></td><td><span class="wk">playtown-hooks</span></td><td class="num" style="text-align: right">12</td><td class="num" style="text-align: right">8 MB</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Hyperdrive -->
    <section class="card" style="padding: 0">
      <div class="lh"><ResourceBindingChip kind="hd" /><span class="t">Hyperdrive</span><span class="d">2 · pooled, cached Postgres from Workers</span><div style="flex: 1"></div><span class="miss"><UiIcon name="warn" :size="10" />config CRUD API</span><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />New config</UiButton></div>
      <table class="tbl">
        <thead><tr><th>Config</th><th>Origin</th><th>Bound by</th><th>Caching</th><th style="text-align: right">Pool</th><th style="text-align: right">Cache hit</th><th style="text-align: right">Query p50</th><th></th></tr></thead>
        <tbody>
          <tr><td><div class="nm">checkumi-pg</div><div class="sm">HYPERDRIVE</div></td><td><div class="num">checkumi-prod <span class="dim">· Managed Postgres</span></div><div class="sm">grp3 · pooler :6432 · sslmode=require</div></td><td><span class="wk">rybbit-proxy</span></td><td><UiBadge tone="ok" dot>ON · 60 s</UiBadge></td><td class="num" style="text-align: right">28 / 40</td><td class="num" style="text-align: right">96.2%</td><td class="num" style="text-align: right">3.8 ms</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-ro</div><div class="sm">PG_RO</div></td><td><div class="num">opentin-main <span class="dim">· external</span></div><div class="sm">db.opentin.io:5432</div></td><td><span class="wk">opentin-search</span></td><td><UiBadge tone="neu" dot>OFF</UiBadge></td><td class="num" style="text-align: right">10 / 20</td><td class="num dim" style="text-align: right">—</td><td class="num" style="text-align: right">14.1 ms</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
    </section>

  </div></template>
