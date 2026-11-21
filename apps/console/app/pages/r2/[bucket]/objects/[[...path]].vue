<script setup lang="ts">
definePageMeta({
  nav: 'R2',
  crumbs: () => [{ label: 'r2', to: '/storage' }, { label: 'checkumi-assets' }],
  validate: (route) => (route.params as Record<string, unknown>).bucket === 'checkumi-assets',
})
</script>

<template><div class="wrap pg-r2" style="display: flex; flex-direction: column; gap: 18px; position: relative">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="r2" />Object storage bucket</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">checkumi-assets</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px; display: flex; gap: 14px; align-items: center"><span>binding <span class="mono" style="color: var(--t2)">ASSETS</span> in <span class="mono" style="color: var(--t2)">checkumi-edge</span></span><span>S3-compatible · MinIO on <span class="mono">k3s-009</span></span><span>created Aug 30</span></p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="plus" :size="13" />New folder</UiButton>
        <UiButton variant="primary"><UiIcon name="upload" :size="13" />Upload</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Objects"><template #value>48,906</template><UiMetricFoot>+612 today</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Stored"><template #value>38.4<small> GB</small></template><ChartArea seed="r2s" :width="240" :height="18" color="#FFB020" /></UiMetricCard>
      <UiMetricCard label="Class A ops" hint="24h · write/list"><template #value>21.7<small> k</small></template><ChartSparkline seed="r2a" :width="240" :height="18" color="var(--t2)" /></UiMetricCard>
      <UiMetricCard label="Class B ops" hint="24h · read"><template #value>1.3<small> M</small></template><ChartSparkline seed="r2b" :width="240" :height="18" color="#FFB020" /></UiMetricCard>
    </div>

    <UiTabs>
      <UiTab active>Objects</UiTab><UiTab>Metrics</UiTab><UiTab>Settings</UiTab>
    </UiTabs>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; border: 1px solid var(--b1); border-radius: 12px; overflow: hidden; background: var(--s1)">
      <section style="min-width: 0">
        <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
          <div class="crumbp"><a href="#">checkumi-assets</a><span class="s">/</span><a href="#">uploads</a><span class="s">/</span><span style="color: var(--t1)">2026-11</span><span class="s">/</span></div>
          <div style="flex: 1"></div>
          <UiInputBox style="width: 230px; height: 30px"><UiIcon name="search" :size="13" /><span style="color: var(--t4)">Filter by prefix</span></UiInputBox>
          <UiButton variant="secondary" size="sm"><UiIcon name="redo" :size="12" /></UiButton>
        </div>
        <table class="tbl ot">
          <thead><tr><th style="width: 28px"><UiCheckbox /></th><th>Name</th><th style="text-align: right">Size</th><th>Type</th><th>Modified</th><th>ETag</th></tr></thead>
          <tbody>
            <tr><td></td><td><span class="on2"><span class="fi fo"><UiIcon name="layers" :size="12" /></span>avatars/</span></td><td class="num muted" style="text-align: right">—</td><td class="muted">folder</td><td class="muted">—</td><td></td></tr>
            <tr><td></td><td><span class="on2"><span class="fi fo"><UiIcon name="layers" :size="12" /></span>reports/</span></td><td class="num muted" style="text-align: right">—</td><td class="muted">folder</td><td class="muted">—</td><td></td></tr>
            <tr class="sel"><td><UiCheckbox checked /></td><td><span class="on2"><span class="fi"><UiIcon name="eye" :size="12" /></span>og-checklist-9a1f.png</span></td><td class="num" style="text-align: right">184 KB</td><td class="mono dim" style="font-size: 12px">image/png</td><td class="num">2 m ago</td><td class="mono dim" style="font-size: 11.5px">"8f2a1c9e…"</td></tr>
            <tr><td><UiCheckbox /></td><td><span class="on2"><span class="fi"><UiIcon name="eye" :size="12" /></span>og-checklist-02be.png</span></td><td class="num" style="text-align: right">171 KB</td><td class="mono dim" style="font-size: 12px">image/png</td><td class="num">14 m ago</td><td class="mono dim" style="font-size: 11.5px">"a11e0b47…"</td></tr>
            <tr><td><UiCheckbox /></td><td><span class="on2"><span class="fi"><UiIcon name="logs" :size="12" /></span>export-u_8f2a1c.csv</span></td><td class="num" style="text-align: right">2.4 MB</td><td class="mono dim" style="font-size: 12px">text/csv</td><td class="num">1 h ago</td><td class="mono dim" style="font-size: 11.5px">"0c2ff91d…"</td></tr>
            <tr><td><UiCheckbox /></td><td><span class="on2"><span class="fi"><UiIcon name="logs" :size="12" /></span>export-u_a4410f.csv</span></td><td class="num" style="text-align: right">812 KB</td><td class="mono dim" style="font-size: 12px">text/csv</td><td class="num">3 h ago</td><td class="mono dim" style="font-size: 11.5px">"5d9e2c10…"</td></tr>
            <tr><td><UiCheckbox /></td><td><span class="on2"><span class="fi"><UiIcon name="eye" :size="12" /></span>logo-team-acme.svg</span></td><td class="num" style="text-align: right">6.1 KB</td><td class="mono dim" style="font-size: 12px">image/svg+xml</td><td class="num">Nov 20</td><td class="mono dim" style="font-size: 11.5px">"91aa0e3f…"</td></tr>
            <tr><td><UiCheckbox /></td><td><span class="on2"><span class="fi"><UiIcon name="layers" :size="12" /></span>backup-lists-1120.json.gz</span></td><td class="num" style="text-align: right">48.2 MB</td><td class="mono dim" style="font-size: 12px">application/gzip</td><td class="num">Nov 20</td><td class="mono dim" style="font-size: 11.5px">"ee410d77…-6"</td></tr>
            <tr><td><UiCheckbox /></td><td><span class="on2"><span class="fi"><UiIcon name="eye" :size="12" /></span>og-checklist-77c0.png</span></td><td class="num" style="text-align: right">166 KB</td><td class="mono dim" style="font-size: 12px">image/png</td><td class="num">Nov 19</td><td class="mono dim" style="font-size: 11.5px">"1b6c3a02…"</td></tr>
          </tbody>
        </table>
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
          <span>2 folders · 7 objects in <span class="mono" style="color: var(--t2)">uploads/2026-11/</span> · page size 1000</span>
          <UiButton variant="secondary" size="sm">Load more</UiButton>
        </div>
        <div class="drop"><UiIcon name="upload" :size="16" /><span><b style="color: var(--t1)">Drop files to upload</b> into <span class="mono">uploads/2026-11/</span> · up to 100 MB per file (single PUT)</span><span class="miss" style="margin-left: auto">multipart</span></div>
    <UiToast style="position: static; width: 360px; margin: 0 14px 14px auto; flex-direction: column; align-items: stretch; gap: 4px">
      <div style="display: flex; align-items: center; gap: 8px"><span class="spin" style="color: var(--accent)"><UiIcon name="spin" /></span><span class="tt" style="flex: 1">Uploading 3 files · 41.6 MB</span><UiIconButton icon="x" :size="12" label="Dismiss" style="width: 22px; height: 22px" /></div>
      <div class="upl"><span class="n">og-checklist-5d14.png</span><span class="p ok">done</span><span class="b"><i style="width: 100%"></i></span></div>
      <div class="upl"><span class="n">export-team-acme.csv</span><span class="p">64%</span><span class="b"><i style="width: 64%"></i></span></div>
      <div class="upl"><span class="n">backup-lists-1121.json.gz</span><span class="p">12%</span><span class="b"><i style="width: 12%"></i></span></div>
      <span class="td">Keep this tab open — single PUT per file, no resume.</span>
    </UiToast>
      </section>

      <UiDrawer style="box-shadow: none">
        <UiDrawerHeader>
          <ResourceBindingChip kind="r2" label="OBJ" />
          <span class="mono" style="font-size: 12.5px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">og-checklist-9a1f.png</span>
          <UiIconButton icon="x" label="Close" />
        </UiDrawerHeader>
        <UiDrawerBody>
          <div class="prev"><div class="img"></div><span class="mono" style="position: absolute; right: 8px; bottom: 8px; font-size: 11px; padding: 2px 7px; border-radius: 6px; background: rgba(0,0,0,.6); color: var(--t2)">1200×630</span></div>
          <div>
            <UiKeyValueRow label="Key" value-class="mono" value-style="font-size: 12px">uploads/2026-11/og-checklist-9a1f.png</UiKeyValueRow>
            <UiKeyValueRow label="Size">184,212 bytes</UiKeyValueRow>
            <UiKeyValueRow label="Content-Type" value-class="mono">image/png</UiKeyValueRow>
            <UiKeyValueRow label="ETag" value-class="mono" value-style="font-size: 12px">"8f2a1c9e04b7d3…"</UiKeyValueRow>
            <UiKeyValueRow label="Uploaded">2026-11-21 14:40 UTC · by worker</UiKeyValueRow>
            <UiKeyValueRow label="Cache-Control" value-class="mono" value-style="font-size: 12px">public, max-age=86400</UiKeyValueRow>
          </div>
          <div class="field">
            <div style="display: flex; justify-content: space-between; align-items: center"><label>Custom metadata</label><UiButton variant="secondary" size="sm"><UiIcon name="edit" :size="12" />Edit</UiButton></div>
            <div style="border: 1px solid var(--b1); border-radius: 8px; padding: 4px 10px">
              <div class="cm"><span class="k">checklist</span><span class="v">chk_9a1f</span></div>
              <div class="cm"><span class="k">renderer</span><span class="v">satori@0.10</span></div>
            </div>
          </div>
          <div class="field">
            <label>Public URL</label>
            <UiInputBox style="opacity: .6"><span class="mono" style="font-size: 12px">Bucket is private</span><span class="miss" style="margin-left: auto">public access</span></UiInputBox>
          </div>
        </UiDrawerBody>
        <UiDrawerFooter>
          <UiButton variant="secondary" style="color: var(--err)"><UiIcon name="trash" :size="13" />Delete</UiButton>
          <div style="flex: 1"></div>
          <UiButton variant="secondary"><UiIcon name="copy" :size="13" />Copy key</UiButton>
          <UiButton variant="primary"><UiIcon name="arrup" :size="13" />Download</UiButton>
        </UiDrawerFooter>
      </UiDrawer>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Public access</span><span class="miss">API</span></div>
        <p class="muted" style="font-size: 12.5px; margin: 0 0 10px">Serve objects from a <span class="mono">*.r2.example.dev</span> subdomain or a custom domain. Today, objects are reachable only through the worker binding.</p>
        <div style="display: flex; gap: 10px; align-items: center"><UiSwitch /><span style="font-size: 12.5px">Allow public reads</span></div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">CORS policy</span><span class="miss">API</span></div>
        <div class="code" style="font-size: 11px; padding: 10px 10px">[{
  <span class="v">"AllowedOrigins"</span>: [<span class="s">"https://checkumi.app"</span>],
  <span class="v">"AllowedMethods"</span>: [<span class="s">"GET"</span>, <span class="s">"PUT"</span>]
}]</div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Lifecycle rules</span><span class="miss">API</span></div>
        <UiKeyValueRow label="reports/" key-class="mono">delete after 30 d</UiKeyValueRow>
        <UiKeyValueRow label="*" key-class="mono">abort uploads after 7 d</UiKeyValueRow>
      </section>
    </div>


  </div></template>
