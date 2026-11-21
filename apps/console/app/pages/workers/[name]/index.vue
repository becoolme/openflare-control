<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'checkumi-edge' }],
})
</script>

<template>    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start">
      <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">

        <section class="card" style="padding: 0">
          <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
            <span class="sec-t" style="font-size: 14px">Traffic</span>
            <span class="mono dim" style="font-size: 12px">all versions · all routes</span>
            <div style="flex: 1"></div>
            <UiSegmented role="group" aria-label="Range"><UiSegment>1h</UiSegment><UiSegment pressed>24h</UiSegment><UiSegment>7d</UiSegment></UiSegmented>
            <UiButton variant="secondary" size="sm" href="#"><UiIcon name="chart" :size="12" />Metrics</UiButton>
          </div>
          <div class="chg">
            <div>
              <div class="ch-h"><span class="t">Requests</span><span class="v">1.24M · 14.4 req/s</span></div>
              <ChartArea seed="r1" :width="400" :height="92" color="var(--accent)" />
              <div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span></div>
            </div>
            <div>
              <div class="ch-h"><span class="t">Errors</span><span class="v"><span class="ok">0.08%</span> · 992 total</span></div>
              <ChartBars seed="e1" :count="48" :width="400" :height="92" color="var(--err)" />
              <div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span></div>
            </div>
            <div>
              <div class="ch-h"><span class="t">CPU time</span><span style="display: flex; gap: 10px"><span class="lg"><i style="background: var(--accent)"></i>p50 1.1 ms</span><span class="lg"><i style="background: var(--info)"></i>p99 3.1 ms</span></span></div>
              <div style="position: relative"><ChartArea seed="c1" :width="400" :height="92" color="var(--info)" /><div style="position: absolute; inset: 0"><ChartArea seed="c2" :width="400" :height="92" color="var(--accent)" /></div></div>
              <div class="axis"><span>0 ms</span><span>limit 50 ms</span></div>
            </div>
            <div>
              <div class="ch-h"><span class="t">Wall time</span><span style="display: flex; gap: 10px"><span class="lg"><i style="background: var(--t2)"></i>p50 18 ms</span><span class="lg"><i style="background: var(--warn)"></i>p99 212 ms</span></span></div>
              <div style="position: relative"><ChartArea seed="w1" :width="400" :height="92" color="var(--warn)" /><div style="position: absolute; inset: 0"><ChartArea seed="w2" :width="400" :height="92" color="var(--t2)" /></div></div>
              <div class="axis"><span>incl. subrequests</span><span>D1 · fetch</span></div>
            </div>
          </div>
        </section>

        <section class="card" style="padding: 16px">
          <div class="ch-h" style="margin-bottom: 12px"><span style="display: flex; gap: 10px; align-items: center"><span class="sec-t" style="font-size: 14px">Active deployment</span><UiBadge tone="warn"><UiIcon name="spin" :size="11" />GRADUAL · 10%</UiBadge></span><NuxtLink to="/workers/checkumi-edge/deployments" class="muted" style="font-size: 12.5px">All deployments →</NuxtLink></div>
          <div class="split" style="height: 10px; margin-bottom: 12px"><span style="width: 90%; background: var(--t3)"></span><span style="width: 10%; background: var(--warn)"></span></div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div style="border: 1px solid var(--b1); border-radius: 10px; padding: 12px 14px; background: var(--s2)">
              <div style="display: flex; justify-content: space-between; align-items: center"><span class="num" style="font-size: 14px">v42 <span class="dim">· 90%</span></span><span class="kind">stable</span></div>
              <div class="sm" style="margin-top: 6px">a41f9c2 · fix: cache headers on /api/check</div>
              <div style="display: flex; gap: 14px; margin-top: 10px; font-size: 12px" class="mono"><span class="muted">err <span class="ok">0.07%</span></span><span class="muted">cpu p99 <span style="color: var(--t1)">3.0 ms</span></span></div>
            </div>
            <div style="border: 1px solid rgba(245,184,61,.35); border-radius: 10px; padding: 12px 14px; background: rgba(245,184,61,.04)">
              <div style="display: flex; justify-content: space-between; align-items: center"><span class="num" style="font-size: 14px">v43 <span class="warn">· 10%</span></span><span class="kind" style="color: var(--warn); border-color: rgba(245,184,61,.4)">canary · 18m</span></div>
              <div class="sm" style="margin-top: 6px">c09e117 · feat: R2 signed uploads</div>
              <div style="display: flex; gap: 14px; margin-top: 10px; font-size: 12px" class="mono"><span class="muted">err <span class="ok">0.11%</span></span><span class="muted">cpu p99 <span style="color: var(--t1)">3.4 ms</span></span></div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 12px">
            <UiButton variant="primary" size="sm"><UiIcon name="arrup" :size="12" />Promote v43 to 100%</UiButton>
            <UiButton variant="secondary" size="sm"><UiIcon name="redo" :size="12" />Roll back to v42</UiButton>
            <span class="muted" style="font-size: 12px; margin-left: 6px">Health gate: err &lt; 1% · p99 &lt; 50 ms — <span class="ok">passing</span></span>
            <div style="flex: 1"></div>
            <span class="miss"><UiIcon name="warn" :size="10" />gradual split API</span>
          </div>
        </section>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px">
          <section class="card" style="padding: 16px">
            <div class="ch-h"><span class="sec-t" style="font-size: 14px">Bindings <span class="mono dim" style="font-size: 12px; font-weight: 400">7</span></span><a href="#" class="muted" style="font-size: 12.5px">Manage →</a></div>
            <div class="bgrp" style="padding-top: 2px">Storage</div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">SESSIONS</span><ResourceBindingChip kind="kv" /><NuxtLink to="/kv/CHECKUMI_CACHE" class="mono muted" style="font-size: 12px">checkumi-sessions →</NuxtLink></div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">FLAGS</span><ResourceBindingChip kind="kv" /><NuxtLink to="/kv/CHECKUMI_CACHE" class="mono muted" style="font-size: 12px">feature-flags →</NuxtLink></div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">DB</span><ResourceBindingChip kind="d1" /><NuxtLink to="/d1/checkumi-db" class="mono muted" style="font-size: 12px">checkumi-main →</NuxtLink></div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">UPLOADS</span><ResourceBindingChip kind="r2" /><NuxtLink to="/r2/checkumi-assets/objects" class="mono muted" style="font-size: 12px">checkumi-uploads →</NuxtLink></div>
            <div class="bgrp">Messaging &amp; state</div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">EVENTS</span><ResourceBindingChip kind="q" /><NuxtLink to="/queues/playtown-events" class="mono muted" style="font-size: 12px">checkumi-events →</NuxtLink></div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">ROOMS</span><ResourceBindingChip kind="do" /><NuxtLink to="/durable-objects/RoomDO" class="mono muted" style="font-size: 12px">class RoomDO →</NuxtLink></div>
            <div class="bgrp">Config</div>
            <div class="dm"><span class="mono" style="font-size: 12.5px">vars · secrets</span><ResourceBindingChip kind="sv" label="ENV" /><span class="mono muted" style="font-size: 12px">4 vars · 3 secrets</span></div>
          </section>

          <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
            <section class="card" style="padding: 16px">
              <div class="ch-h"><span class="sec-t" style="font-size: 14px">Domains &amp; routes</span><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Add</UiButton></div>
              <div class="dm"><span style="min-width: 0"><div class="mono" style="font-size: 12.5px">w-checkumi-edge.example.dev</div><div class="sm">platform · always on</div></span><UiBadge tone="ok" dot>TLS</UiBadge><span></span></div>
              <div class="dm"><span style="min-width: 0"><div class="mono" style="font-size: 12.5px">edge.checkumi.com</div><div class="sm">CNAME ✓ · cert renews Feb 02</div></span><UiBadge tone="ok" dot>ACTIVE</UiBadge><span></span></div>
              <div class="dm"><span style="min-width: 0"><div class="mono" style="font-size: 12.5px">api.checkumi.app</div><div class="sm" style="color: var(--warn)">waiting for DNS · TXT _openflare</div></span><UiBadge tone="warn" dot>PENDING</UiBadge><span></span></div>
            </section>
            <section class="card" style="padding: 16px">
              <div class="ch-h"><span class="sec-t" style="font-size: 14px">Triggers</span><a href="#" class="muted" style="font-size: 12.5px">Edit →</a></div>
              <div class="dm"><span style="display: flex; gap: 8px; align-items: center"><UiIcon name="clock" :size="13" /><span class="mono" style="font-size: 12.5px">*/15 * * * *</span></span><span class="mono muted" style="font-size: 12px">next 14:45 UTC</span><UiBadge tone="ok" dot>OK</UiBadge></div>
              <div class="dm"><span style="display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="q" /><span class="mono" style="font-size: 12.5px; white-space: nowrap">checkumi-events</span></span><span class="mono muted" style="font-size: 12px; white-space: nowrap">batch 10</span><UiBadge tone="ok" dot>CONSUMER</UiBadge></div>
            </section>
          </div>
        </div>

        <section class="card" style="padding: 0">
          <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
            <span class="sec-t" style="font-size: 14px">Recent invocations</span><span class="st live"><i></i></span><span class="mono dim" style="font-size: 12px">tail · 12 events/s</span>
            <div style="flex: 1"></div><UiButton variant="secondary" size="sm" to="/workers/checkumi-edge/logs"><UiIcon name="logs" :size="12" />Open logs</UiButton>
          </div>
          <div class="tail" style="border: 0; border-radius: 0 0 12px 12px"><span class="t">14:31:07.412</span>{{ "  " }}<span class="ok">200</span>  GET  /api/check?id=8f2c        <span class="t">cpu 1.2ms  wall 14ms   v42</span>{{ "\n" }}<span class="t">14:31:07.398</span>{{ "  " }}<span class="ok">200</span>  POST /api/events               <span class="t">cpu 2.0ms  wall 9ms    v42</span>{{ "  " }}<span class="c">queue.send EVENTS</span>{{ "\n" }}<span class="t">14:31:07.371</span>{{ "  " }}<span class="ok">201</span>  PUT  /upload/avatars/u_912.png <span class="t">cpu 3.1ms  wall 182ms  v43</span>{{ "  " }}<span class="c">r2.put UPLOADS</span>{{ "\n" }}<span class="t">14:31:07.344</span>{{ "  " }}<span class="err">500</span>  GET  /api/report/77            <span class="t">cpu 8.4ms  wall 61ms   v42</span>{{ "  " }}<span class="err">D1_ERROR: no such column: tz</span>{{ "\n" }}<span class="t">14:31:07.309</span>{{ "  " }}<span class="ok">200</span>  GET  /                         <span class="t">cpu 0.4ms  wall 3ms    v42</span>{{ "  " }}<span class="c">assets</span></div>
        </section>
      </div>

      <aside style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="sec-t" style="font-size: 14px">Runtime</span><UiIconButton icon="edit" :size="13" label="Edit runtime" to="/workers/checkumi-edge/settings" /></div>
          <UiKeyValueRow label="Compat date" style="grid-template-columns: 112px minmax(0,1fr)">2026-09-01</UiKeyValueRow>
          <UiKeyValueRow label="Flags" style="grid-template-columns: 112px minmax(0,1fr)"><span class="kind">nodejs_compat</span></UiKeyValueRow>
          <UiKeyValueRow label="Runtime" style="grid-template-columns: 112px minmax(0,1fr)">workerd 1.20261018</UiKeyValueRow>
          <UiKeyValueRow label="Placement" style="grid-template-columns: 112px minmax(0,1fr)">pool fsn · 3 nodes</UiKeyValueRow>
          <UiKeyValueRow label="Isolate memory" style="grid-template-columns: 112px minmax(0,1fr)">38 / 128 MiB</UiKeyValueRow>
          <UiKeyValueRow label="Scale to zero" style="grid-template-columns: 112px minmax(0,1fr)">after 15 min idle</UiKeyValueRow>
          <UiKeyValueRow label="Snapshot" value-style="display: flex; gap: 6px; align-items: center" style="grid-template-columns: 112px minmax(0,1fr)">sha256:9c1e…4a07 <span style="color: var(--ok)"><UiIcon name="shield" :size="12" /></span></UiKeyValueRow>
          <UiKeyValueRow label="Main module" style="grid-template-columns: 112px minmax(0,1fr)">index.js · 41 KiB</UiKeyValueRow>
        </section>
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="sec-t" style="font-size: 14px">Limits</span><span class="v">per request</span></div>
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px">
            <div><div style="display: flex; justify-content: space-between"><span class="muted">CPU p99</span><span class="num">3.1 / 50 ms</span></div><div class="bar"><span style="width: 6%; background: var(--accent)"></span></div></div>
            <div><div style="display: flex; justify-content: space-between"><span class="muted">Subrequests max</span><span class="num">12 / 50</span></div><div class="bar"><span style="width: 24%; background: var(--t2)"></span></div></div>
            <div><div style="display: flex; justify-content: space-between"><span class="muted">Memory peak</span><span class="num">61 / 128 MiB</span></div><div class="bar"><span style="width: 48%; background: var(--t2)"></span></div></div>
          </div>
        </section>
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="sec-t" style="font-size: 14px">Source</span><span class="kind">CLI</span></div>
          <div class="code" style="font-size: 11.5px; padding: 10px 12px"><span class="c"># wrangler.toml</span>{{ "\n" }}<span class="k">name</span> = <span class="s">"checkumi-edge"</span>{{ "\n" }}<span class="k">main</span> = <span class="s">"src/index.ts"</span>{{ "\n" }}<span class="k">compatibility_date</span> = <span class="s">"2026-09-01"</span>

[[<span class="v">kv_namespaces</span>]]
<span class="k">binding</span> = <span class="s">"SESSIONS"</span></div>
          <div class="muted" style="font-size: 12px; margin-top: 10px">Cloudflare IDs in <span class="mono">id =</span> are ignored; names resolve inside team <span class="mono">acme</span>.</div>
        </section>
        <section class="card" style="padding: 8px">
          <a href="#" class="nv"><UiIcon name="github" /><span>Connect Git repository</span></a>
          <a href="#" class="nv"><UiIcon name="key" /><span>Create deploy hook</span></a>
          <a href="#" class="nv"><UiIcon name="copy" /><span>Duplicate worker</span></a>
          <NuxtLink to="/workers/checkumi-edge/settings" class="nv" style="color: var(--err)"><UiIcon name="trash" /><span>Delete…</span></NuxtLink>
        </section>
      </aside>
    </div></template>
