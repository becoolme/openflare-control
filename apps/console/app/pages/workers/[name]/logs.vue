<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'checkumi-edge' }],
})
</script>

<template>    <section class="card" style="padding: 10px 12px; display: flex; align-items: center; gap: 8px; flex-wrap: nowrap">
      <UiBadge tone="ok" dot style="white-space: nowrap">Connected · 12 events/s</UiBadge>
      <UiInputBox style="flex: 1; min-width: 160px; height: 30px"><UiIcon name="search" :size="13" /><input placeholder="Search path, message, ray id…" aria-label="Search logs" value="report" /></UiInputBox>
      <UiButton variant="secondary" size="sm">Status: 4xx, 5xx <UiIcon name="chev" :size="11" /></UiButton>
      <UiButton variant="secondary" size="sm">Method: all <UiIcon name="chev" :size="11" /></UiButton>
      <UiButton variant="secondary" size="sm">Outcome: 2 <UiIcon name="chev" :size="11" /></UiButton>
      <UiButton variant="secondary" size="sm">Sampling 100% <UiIcon name="chev" :size="11" /></UiButton>
      <UiButton variant="secondary" size="sm"><UiIcon name="x" :size="12" />Pause</UiButton>
      <span class="miss"><UiIcon name="warn" :size="10" />7-day search</span>
    </section>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px; align-items: start">
      <section class="card" style="padding: 0; overflow: hidden">
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--b1)">
          <span class="oc"><i style="background: var(--ok)"></i>ok 11,904</span>
          <span class="oc"><i style="background: var(--err)"></i>exception 41</span>
          <span class="oc"><i style="background: var(--warn)"></i>exceededCpu 3</span>
          <span class="oc"><i style="background: var(--t3)"></i>canceled 12</span>
          <div style="flex: 1"></div>
          <span class="sm">buffer 1,000 · 15 min</span>
        </div>
        <div style="padding: 10px 16px 4px"><ChartBars seed="lg1" :count="64" :width="666" :height="36" color="var(--t3)" /></div>
        <table class="tbl lt">
          <thead><tr><th>Time</th><th>Outcome</th><th>Request</th><th>Status</th><th class="num">CPU</th><th class="num">Wall</th><th>Node</th></tr></thead>
          <tbody>
            <tr><td class="mono muted">14:31:07.344</td><td><span class="oc err"><i style="background: var(--err)"></i>exception</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/77?tz=Asia%2FTokyo</td><td class="mono err">500</td><td class="num">8.4 ms</td><td class="num">61 ms</td><td class="mono muted">fsn·021</td></tr>
            <tr class="sel"><td class="mono muted">14:31:06.902</td><td><span class="oc err"><i style="background: var(--err)"></i>exception</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/412</td><td class="mono err">500</td><td class="num">7.9 ms</td><td class="num">58 ms</td><td class="mono muted">fsn·022</td></tr>
            <tr><td class="mono muted">14:31:05.117</td><td><span class="oc ok"><i style="background: var(--ok)"></i>ok</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/9</td><td class="mono warn">404</td><td class="num">0.9 ms</td><td class="num">6 ms</td><td class="mono muted">nbg·023</td></tr>
            <tr><td class="mono muted">14:31:02.660</td><td><span class="oc warn"><i style="background: var(--warn)"></i>exceededCpu</span></td><td class="mono pth"><span class="muted">POST</span> /api/report/export</td><td class="mono err">503</td><td class="num warn">50.0 ms</td><td class="num">1.21 s</td><td class="mono muted">fsn·021</td></tr>
            <tr><td class="mono muted">14:30:58.031</td><td><span class="oc ok"><i style="background: var(--ok)"></i>ok</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/77/pdf</td><td class="mono warn">429</td><td class="num">1.1 ms</td><td class="num">4 ms</td><td class="mono muted">hel·024</td></tr>
            <tr><td class="mono muted">14:30:51.774</td><td><span class="oc dim"><i style="background: var(--t3)"></i>canceled</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/stream</td><td class="mono dim">499</td><td class="num">2.2 ms</td><td class="num">30.0 s</td><td class="mono muted">fsn·022</td></tr>
            <tr><td class="mono muted">14:30:44.208</td><td><span class="oc err"><i style="background: var(--err)"></i>exception</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/31</td><td class="mono err">500</td><td class="num">8.1 ms</td><td class="num">55 ms</td><td class="mono muted">nbg·023</td></tr>
            <tr><td class="mono muted">14:30:39.950</td><td><span class="oc ok"><i style="background: var(--ok)"></i>ok</span></td><td class="mono pth"><span class="muted">DELETE</span> /api/report/12</td><td class="mono warn">403</td><td class="num">0.6 ms</td><td class="num">3 ms</td><td class="mono muted">fsn·021</td></tr>
            <tr><td class="mono muted">14:30:31.402</td><td><span class="oc err"><i style="background: var(--err)"></i>exception</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/88</td><td class="mono err">500</td><td class="num">8.6 ms</td><td class="num">63 ms</td><td class="mono muted">hel·024</td></tr>
            <tr><td class="mono muted">14:30:27.118</td><td><span class="oc ok"><i style="background: var(--ok)"></i>ok</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/5</td><td class="mono warn">404</td><td class="num">0.8 ms</td><td class="num">5 ms</td><td class="mono muted">fsn·022</td></tr>
            <tr><td class="mono muted">14:30:20.553</td><td><span class="oc err"><i style="background: var(--err)"></i>exception</span></td><td class="mono pth"><span class="muted">GET</span> /api/report/104</td><td class="mono err">500</td><td class="num">7.7 ms</td><td class="num">57 ms</td><td class="mono muted">fsn·021</td></tr>
            <tr><td class="mono muted">14:30:12.006</td><td><span class="oc ok"><i style="background: var(--ok)"></i>ok</span></td><td class="mono pth"><span class="muted">PUT</span> /api/report/77/share</td><td class="mono warn">409</td><td class="num">1.4 ms</td><td class="num">9 ms</td><td class="mono muted">nbg·023</td></tr>
          </tbody>
        </table>
        <div style="padding: 10px 16px; border-top: 1px solid var(--b1); display: flex; align-items: center; gap: 10px" class="sm"><span class="spin" style="width: 11px; height: 11px"></span><span>Streaming via <span class="mono">GET /api/workers/:id/tail</span> · filtered client-side</span><div style="flex: 1"></div><span>12 matches in buffer</span></div>
      </section>

      <UiDrawer style="position: relative; inset: auto; width: auto; height: auto; border-radius: 12px; border: 1px solid var(--b1); overflow: hidden">
        <UiDrawerHeader>
          <div style="min-width: 0">
            <div style="display: flex; gap: 8px; align-items: center"><UiBadge tone="err" dot>EXCEPTION</UiBadge><span class="mono" style="font-size: 13px">GET /api/report/412</span></div>
            <div class="sm" style="margin-top: 4px">14:31:06.902 · ray 8e4c1f0a2b7d · v42 · fsn · k3s-022</div>
          </div>
          <UiIconButton icon="x" label="Close" />
        </UiDrawerHeader>
        <UiDrawerBody style="display: flex; flex-direction: column; gap: 16px">
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px">
            <div><div class="sm">Status</div><div class="num err">500</div></div>
            <div><div class="sm">CPU</div><div class="num">7.9 ms</div></div>
            <div><div class="sm">Wall</div><div class="num">58 ms</div></div>
            <div><div class="sm">Subreq</div><div class="num">3</div></div>
          </div>
          <div>
            <div class="flb" style="margin-bottom: 8px">Binding calls</div>
            <div class="bc"><ResourceBindingChip kind="kv" /><span class="mono" style="overflow: hidden; text-overflow: ellipsis">SESSIONS.get("s:9f1c…")</span><span class="mono muted">2 ms</span></div>
            <div class="bc"><ResourceBindingChip kind="d1" /><span class="mono err" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">DB.prepare("SELECT … tz").first()</span><span class="mono muted">8 ms</span></div>
            <div class="bc"><ResourceBindingChip kind="q" /><span class="mono" style="overflow: hidden; text-overflow: ellipsis">EVENTS.send({type:"report.fail"})</span><span class="mono muted">3 ms</span></div>
          </div>
          <div>
            <div class="flb" style="margin-bottom: 8px">Exception</div>
            <div class="code" style="font-size: 11.5px; padding: 10px 12px; white-space: pre; overflow: hidden"><span style="color: var(--err)">Error: D1_ERROR: no such column: tz</span>{{ "\n" }}<span class="c">    at D1PreparedStatement.first (d1:211)</span>
    at loadReport (<span class="s">src/report.ts:48:22</span>)
    at handle (<span class="s">src/router.ts:117:14</span>)
<span class="c">    at Object.fetch (src/index.ts:12:10)</span></div>
          </div>
          <div>
            <div class="flb" style="margin-bottom: 8px">console · 3 lines</div>
            <div class="tail" style="font-size: 11.5px; padding: 8px 12px"><span class="t">+0ms </span>{{ " " }}<span class="c">log  </span> report 412 requested by u_1182
<span class="t">+11ms</span>{{ " " }}<span class="warn">warn </span> tz param missing, default UTC
<span class="t">+52ms</span>{{ " " }}<span class="err">error</span> loadReport failed {"id":412}</div>
          </div>
          <div>
            <div class="flb" style="margin-bottom: 8px">Request headers <span class="dim" style="font-weight: 400">· 7 of 14</span></div>
            <div class="hd"><span>host</span><span>edge.checkumi.com</span><span>user-agent</span><span>Mozilla/5.0 (Macintosh; Intel Mac OS X)</span><span>cf-connecting-ip</span><span>203.0.113.•• (masked)</span><span>accept</span><span>application/json</span><span>authorization</span><span class="dim">Bearer •••••••• (redacted)</span><span>x-request-id</span><span>req_01JD9K2Q…</span><span>cf-ipcountry</span><span>JP</span></div>
          </div>
        </UiDrawerBody>
        <UiDrawerFooter><UiButton variant="secondary" size="sm"><UiIcon name="copy" :size="12" />Copy as JSON</UiButton><UiButton variant="secondary" size="sm"><UiIcon name="term" :size="12" />curl replay</UiButton><div style="flex: 1"></div><UiButton variant="secondary" size="sm" to="/workers/checkumi-edge/deployments">Open v42</UiButton></UiDrawerFooter>
      </UiDrawer>
    </div></template>
