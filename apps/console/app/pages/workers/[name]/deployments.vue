<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'checkumi-edge' }],
})
const overlays = useOverlays(['rollback'] as const)
</script>

<template>    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start">
      <section class="card" style="padding: 0">
        <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
          <span class="sec-t" style="font-size: 14px">Deployments</span><span class="mono dim" style="font-size: 12px">traffic split over time</span>
          <div style="flex: 1"></div>
          <UiInputBox style="width: 200px; height: 30px"><UiIcon name="search" :size="13" /><input placeholder="Filter by message, author…" aria-label="Filter deployments" /></UiInputBox>
          <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Source</UiButton>
        </div>
        <div class="tl" style="padding: 4px 16px 4px 42px">
          <div class="tli">
            <span class="dot gr"></span>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
              <UiBadge tone="warn"><UiIcon name="spin" :size="11" />GRADUAL</UiBadge>
              <span class="vp"><b>v42</b>90%</span><span class="vp" style="border-color: rgba(245,184,61,.45)"><b>v43</b><span class="warn">10%</span></span>
              <span class="kind">CLI</span>
              <div style="flex: 1"></div>
              <span class="mono muted" style="font-size: 12px">18 min ago</span>
              <UiIconButton icon="more" label="More" />
            </div>
            <div style="margin-top: 8px; font-size: 13.5px">feat: R2 signed uploads</div>
            <div class="sm" style="margin-top: 4px; display: flex; gap: 12px; align-items: center"><span style="display: inline-flex; gap: 5px; align-items: center"><UiIcon name="user" :size="11" />alex</span><span>vrt deploy --version v43 --percent 10</span><span>dep_8a1f02</span></div>
            <div style="display: flex; gap: 8px; margin-top: 10px"><UiButton variant="primary" size="sm"><UiIcon name="arrup" :size="12" />Promote to 100%</UiButton><UiButton variant="secondary" size="sm">Edit split</UiButton><UiButton variant="secondary" size="sm">Abort · back to v42</UiButton></div>
          </div>
          <div class="tli">
            <span class="dot live"></span>
            <div style="display: flex; align-items: center; gap: 8px">
              <UiBadge tone="neu">SUPERSEDED</UiBadge><span class="vp"><b>v42</b>100%</span><span class="kind">Git</span>
              <div style="flex: 1"></div><span class="mono muted" style="font-size: 12px">2 h ago</span><UiIconButton icon="more" label="More" />
            </div>
            <div style="margin-top: 8px; font-size: 13.5px">fix: cache headers on /api/check</div>
            <div class="sm" style="margin-top: 4px; display: flex; gap: 12px; align-items: center"><span style="display: inline-flex; gap: 5px; align-items: center"><UiIcon name="github" :size="11" />acme/checkumi · main · a41f9c2</span><span>dep_77c0e1</span></div>
          </div>
          <div class="tli">
            <span class="dot rb"></span>
            <div style="display: flex; align-items: center; gap: 8px">
              <UiBadge tone="info">ROLLBACK</UiBadge><span class="vp"><b>v40</b>100%</span><span class="kind">API</span>
              <div style="flex: 1"></div><span class="mono muted" style="font-size: 12px">yesterday 22:14</span><UiIconButton icon="more" label="More" />
            </div>
            <div style="margin-top: 8px; font-size: 13.5px">Rolled back from v41 — “exceededCpu on /api/report”</div>
            <div class="sm" style="margin-top: 4px; display: flex; gap: 12px; align-items: center"><span style="display: inline-flex; gap: 5px; align-items: center"><UiIcon name="user" :size="11" />mira</span><span>secrets unchanged</span><span>dep_51aa90</span></div>
          </div>
          <div class="tli">
            <span class="dot"></span>
            <div style="display: flex; align-items: center; gap: 8px">
              <UiBadge tone="err">FAILED</UiBadge><span class="vp"><b>v41</b>0%</span><span class="kind">Git</span>
              <div style="flex: 1"></div><span class="mono muted" style="font-size: 12px">yesterday 21:58</span><UiIconButton icon="more" label="More" />
            </div>
            <div style="margin-top: 8px; font-size: 13.5px">feat: timezone-aware reports</div>
            <div class="sm" style="margin-top: 4px; display: flex; gap: 12px; align-items: center"><span style="display: inline-flex; gap: 5px; align-items: center"><UiIcon name="github" :size="11" />main · 5d2e8b0</span><span class="err">health gate: error rate 6.2% &gt; 1%</span></div>
          </div>
          <div class="tli">
            <span class="dot"></span>
            <div style="display: flex; align-items: center; gap: 8px">
              <UiBadge tone="neu">SUPERSEDED</UiBadge><span class="vp"><b>v40</b>100%</span><span class="kind">Hook</span>
              <div style="flex: 1"></div><span class="mono muted" style="font-size: 12px">Nov 18</span><UiIconButton icon="more" label="More" />
            </div>
            <div style="margin-top: 8px; font-size: 13.5px">chore: bump compat date to 2026-09-01</div>
            <div class="sm" style="margin-top: 4px">deploy hook “nightly” · dep_3f0b2c</div>
          </div>
        </div>
      </section>

      <div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="sec-t" style="font-size: 14px">Gradual deploy</span><span class="miss"><UiIcon name="warn" :size="10" />no split API yet</span></div>
          <div class="sec-d" style="margin: 0 0 12px">Shift traffic between two versions. Requests stick to a version by <span class="mono">Cf-Ray</span> hash.</div>
          <div class="field"><div class="flb">Version A</div><UiInputBox><span class="mono">v42 · a41f9c2</span><div style="flex: 1"></div><UiIcon name="updown" :size="12" /></UiInputBox></div>
          <div class="field" style="margin-top: 10px"><div class="flb">Version B</div><UiInputBox focused><span class="mono">v43 · c09e117</span><div style="flex: 1"></div><UiIcon name="updown" :size="12" /></UiInputBox></div>
          <div class="sld"><span class="f" style="width: 25%"></span><span class="k" style="left: 25%"></span></div>
          <div style="display: flex; justify-content: space-between" class="mono"><span style="font-size: 12px" class="muted">v42 <b style="color: var(--t1)">75%</b></span><span style="font-size: 12px" class="muted">v43 <b class="warn">25%</b></span></div>
          <div style="display: flex; gap: 6px; margin-top: 10px"><button type="button" class="kind" style="background: transparent">10%</button><button type="button" class="kind" style="background: var(--s3); color: var(--t1); border-color: var(--t3)">25%</button><button type="button" class="kind" style="background: transparent">50%</button><button type="button" class="kind" style="background: transparent">100%</button></div>
          <div style="border-top: 1px solid var(--b1); margin: 14px 0 12px"></div>
          <div class="flb" style="margin-bottom: 8px">Health gate</div>
          <label class="chk" style="margin-bottom: 6px"><UiCheckbox checked :mark="false" />Auto-abort if error rate &gt; <span class="mono">1%</span></label>
          <label class="chk" style="margin-bottom: 6px"><UiCheckbox checked :mark="false" />Auto-abort if CPU p99 &gt; <span class="mono">50 ms</span></label>
          <label class="chk"><UiCheckbox />Auto-promote after <span class="mono">30 min</span> healthy</label>
          <div style="display: flex; gap: 8px; margin-top: 14px"><UiButton variant="primary" size="sm" style="flex: 1">Apply split</UiButton><UiButton variant="secondary" size="sm">Cancel</UiButton></div>
          <div class="code" style="font-size: 11.5px; padding: 8px 10px; margin-top: 12px"><span class="p">$</span> vrt versions deploy v42@75 v43@25</div>
        </section>
        <section class="card" style="padding: 16px">
          <div class="ch-h"><span class="sec-t" style="font-size: 14px">Canary health · v43</span><span class="v">last 18 min</span></div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
            <div><div class="sm">Error rate</div><div class="num" style="font-size: 18px">0.11%</div><ChartSparkline seed="k1" :width="150" :height="28" color="var(--ok)" /></div>
            <div><div class="sm">CPU p99</div><div class="num" style="font-size: 18px">3.4 ms</div><ChartSparkline seed="k2" :width="150" :height="28" color="var(--accent)" /></div>
          </div>
        </section>
      </div>
    </div>

    <section class="card" style="padding: 0; position: relative; overflow: hidden">
      <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--b1)">
        <span class="sec-t" style="font-size: 14px">Versions</span><span class="mono dim" style="font-size: 12px">immutable code + bindings snapshots · keep last 50</span>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="upload" :size="12" />Upload version</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Version</th><th>Tag / message</th><th>Created</th><th>Source</th><th class="num">Size</th><th>Bindings diff</th><th>Traffic</th><th></th></tr></thead>
        <tbody>
          <tr><td class="mono">v43 <span class="dim">c09e117</span></td><td>feat: R2 signed uploads</td><td class="mono muted">18m ago</td><td><span class="kind">CLI</span></td><td class="num">42.8 KiB</td><td><span class="mono" style="font-size: 12px"><span class="ok">+UPLOADS</span> <span class="warn">~MAX_MB</span></span></td><td><span class="warn mono">10%</span></td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
          <tr><td class="mono">v42 <span class="dim">a41f9c2</span></td><td>fix: cache headers on /api/check</td><td class="mono muted">2h ago</td><td><span class="kind">Git</span></td><td class="num">41.2 KiB</td><td class="dim mono" style="font-size: 12px">no change</td><td><span class="mono">90%</span></td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
          <tr><td class="mono">v41 <span class="dim">5d2e8b0</span></td><td>feat: timezone-aware reports</td><td class="mono muted">yesterday</td><td><span class="kind">Git</span></td><td class="num">41.0 KiB</td><td><span class="mono" style="font-size: 12px"><span class="warn">~DB</span></span></td><td class="dim mono">—</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
          <tr class="sel"><td class="mono">v40 <span class="dim">e7710aa</span></td><td>chore: bump compat date</td><td class="mono muted">Nov 18</td><td><span class="kind">Hook</span></td><td class="num">40.6 KiB</td><td><span class="mono" style="font-size: 12px"><span class="err">−FLAGS</span> <span class="warn">~compat</span></span></td><td class="dim mono">—</td><td style="text-align: right"><UiButton variant="secondary" size="sm" @click="overlays.toggle('rollback')" :aria-expanded="overlays.isOpen('rollback') ? 'true' : 'false'"><UiIcon name="redo" :size="12" />Roll back</UiButton></td></tr>
          <tr><td class="mono">v39 <span class="dim">0b9c4d1</span></td><td>feat: room presence via DO</td><td class="mono muted">Nov 14</td><td><span class="kind">API</span></td><td class="num">39.9 KiB</td><td><span class="mono" style="font-size: 12px"><span class="ok">+ROOMS</span></span></td><td class="dim mono">—</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
          <tr><td class="mono">v38 <span class="dim">9a0f3e2</span></td><td>init: edge checker</td><td class="mono muted">Nov 10</td><td><span class="kind">CLI</span></td><td class="num">31.4 KiB</td><td class="dim mono" style="font-size: 12px">initial</td><td class="dim mono">—</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="padding: 10px 16px; border-top: 1px solid var(--b1); display: flex; justify-content: space-between" class="sm"><span>6 of 43 versions</span><span>Older versions are pruned automatically · deleting the version that serves traffic is blocked</span></div>

      <div v-if="overlays.isOpen('rollback')" class="scrim" style="position: absolute; inset: 0; border-radius: 0" @click="overlays.close('rollback')"></div>
      <UiDialog v-if="overlays.isOpen('rollback')" aria-labelledby="rbt" style="top: 20px; transform: translateX(-50%); width: 520px">
        <UiDialogBody>
          <UiDialogTitle as="div" id="rbt" style="display: flex; gap: 10px; align-items: center"><span style="color: var(--warn)"><UiIcon name="redo" :size="16" /></span>Roll back checkumi-edge to v40?</UiDialogTitle>
          <div class="sec-d" style="margin: 6px 0 12px">100% of traffic moves to v40 immediately. v42 and v43 stay available as versions.</div>
          <div class="flb" style="margin-bottom: 6px">What changes · v42 → v40</div>
          <div class="dif"><span class="m">~ compatibility_date  2026-09-01 → 2026-08-15</span>{{ "\n" }}<span class="a">+ kv  FLAGS        → feature-flags</span>{{ "\n" }}<span class="r">− r2  UPLOADS      (v43 only, not served)</span>{{ "\n" }}<span class="m">~ var MAX_MB       "25" → "10"</span></div>
          <UiBanner tone="warn" icon="lock" :icon-size="13" style="margin-top: 12px"><span><b>Secrets are not rolled back.</b> v40 will read the current values of <span class="mono">API_KEY</span>, <span class="mono">JWT_SECRET</span>, <span class="mono">STRIPE_WH</span>.</span></UiBanner>
          <div class="field" style="margin-top: 12px"><div class="flb">Type <span class="mono" style="color: var(--t1)">checkumi-edge</span> to confirm</div><UiInputBox focused><input value="checkumi-ed" aria-label="Confirm worker name" /></UiInputBox></div>
        </UiDialogBody>
        <UiDialogFooter><span class="sm" style="margin-right: auto">POST /api/workers/:id/rollback</span><UiButton variant="secondary" size="sm" @click="overlays.close('rollback')">Cancel</UiButton><UiButton variant="primary" size="sm" disabled style="opacity: .5">Roll back</UiButton></UiDialogFooter>
      </UiDialog>
    </section></template>
