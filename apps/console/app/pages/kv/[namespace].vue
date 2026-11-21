<script setup lang="ts">
definePageMeta({
  nav: 'KV',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'kv', to: '/kv' }, { label: 'CHECKUMI_CACHE' }],
  validate: (route) => (route.params as Record<string, unknown>).namespace === 'CHECKUMI_CACHE',
})
</script>

<template><div class="wrap pg-kv" style="display: flex; flex-direction: column; gap: 18px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="kv" />KV namespace</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em; font-family: 'Geist Mono', monospace">CHECKUMI_CACHE</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px; display: flex; gap: 14px; align-items: center"><span class="mono">kv_7f3a91c2</span><UiIconButton icon="copy" :size="12" label="Copy ID" style="width: 22px; height: 22px" /><span>Bound by <span class="mono" style="color: var(--t2)">checkumi-edge</span>, <span class="mono" style="color: var(--t2)">checkumi-cron</span></span><span>created Sep 12 · alex</span></p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="upload" :size="13" />Bulk import <span class="miss" style="margin-left: 4px">API</span></UiButton>
        <UiButton variant="secondary"><UiIcon name="arrup" :size="13" />Export JSON <span class="miss" style="margin-left: 4px">API</span></UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Add key</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Keys"><template #value>812,440</template><UiMetricFoot>+4,120 today</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Stored"><template #value>1.1<small> GB</small></template><UiMetricFoot>avg value 1.4 KB · max 25 MB</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Reads" hint="24h"><template #value>6.2<small> M</small></template><ChartSparkline seed="kvr" :width="240" :height="18" color="#5EB0FF" /></UiMetricCard>
      <UiMetricCard label="Writes · deletes" hint="24h"><template #value>98.1<small> k · 2.3 k</small></template><ChartSparkline seed="kvw" :width="240" :height="18" color="var(--t2)" /></UiMetricCard>
    </div>

    <UiTabs>
      <UiTab active>Keys</UiTab><UiTab>Metrics</UiTab><UiTab>Bindings <span class="mono dim">2</span></UiTab><UiTab>Settings</UiTab>
    </UiTabs>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 0; border: 1px solid var(--b1); border-radius: 12px; overflow: hidden; background: var(--s1)">
      <section style="min-width: 0">
        <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
          <UiInputBox focused style="flex: 1; max-width: 360px"><UiIcon name="search" /><span class="mono" style="color: var(--t1)">session:</span><span style="color: var(--t4)">prefix…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
          <span class="muted" style="font-size: 12px">prefix match · server-side</span>
          <div style="flex: 1"></div>
          <UiButton variant="secondary" size="sm"><UiIcon name="redo" :size="12" />Refresh</UiButton>
        </div>
        <div style="display: flex; gap: 10px; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--b1); background: rgba(198,244,50,.04); font-size: 12.5px">
          <UiCheckbox checked /><span><b>3 selected</b></span><UiButton variant="secondary" size="sm" style="color: var(--err)"><UiIcon name="trash" :size="12" />Delete 3 keys</UiButton><UiButton variant="secondary" size="sm">Clear</UiButton><div style="flex: 1"></div><span class="muted">deletes run one request per key</span>
        </div>
        <table class="tbl kt">
          <thead><tr><th style="width: 28px"><UiCheckbox checked style="opacity: .6" /></th><th>Key</th><th style="text-align: right">Size</th><th>Expiration</th><th>Metadata</th><th></th></tr></thead>
          <tbody>
            <tr style="background: rgba(198,244,50,.03)">
              <td><UiCheckbox style="border-color: var(--accent)" /></td>
              <td><span class="kk"><span class="pf">session:</span><span style="color: var(--accent)">+ new key name</span></span></td>
              <td colspan="3"><div style="display: flex; gap: 8px; align-items: center"><UiInputBox style="height: 28px; flex: 1"><span class="mono" style="font-size: 12px">{"user":"…"}</span></UiInputBox><UiInputBox style="height: 28px; width: 110px"><span class="mono" style="font-size: 12px">TTL 3600 s</span></UiInputBox></div></td>
              <td style="text-align: right; white-space: nowrap"><UiButton variant="primary" size="sm">Add</UiButton></td>
            </tr>
            <tr class="sel"><td><UiCheckbox checked /></td><td><span class="kk"><span class="pf">session:</span>u_8f2a1c/7f3a9</span></td><td class="num" style="text-align: right">1.2 KB</td><td class="num">in 42 m</td><td><span class="mt">{"ip":"88.12.x","ua":"ios"}</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox checked /></td><td><span class="kk"><span class="pf">session:</span>u_8f2a1c/a11e0</span></td><td class="num" style="text-align: right">1.1 KB</td><td class="num">in 2 h</td><td><span class="mt">{"ip":"88.12.x","ua":"web"}</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox checked /></td><td><span class="kk"><span class="pf">session:</span>u_91b0de/0c2ff</span></td><td class="num" style="text-align: right">980 B</td><td class="num warn">in 38 s</td><td><span class="mt dim">—</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox /></td><td><span class="kk"><span class="pf">session:</span>u_a4410f/5d9e2</span></td><td class="num" style="text-align: right">1.3 KB</td><td class="num">in 6 h</td><td><span class="mt">{"ip":"10.0.x","ua":"cli"}</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox /></td><td><span class="kk"><span class="pf">session:</span>u_b2e7c3/91aa0</span></td><td class="num" style="text-align: right">1.2 KB</td><td class="num">in 11 h</td><td><span class="mt dim">—</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox /></td><td><span class="kk"><span class="pf">session:</span>u_c00d18/ee410</span></td><td class="num" style="text-align: right">2.4 KB</td><td class="num muted">never</td><td><span class="mt">{"pinned":true}</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox /></td><td><span class="kk"><span class="pf">session:</span>u_d39f72/1b6c3</span></td><td class="num" style="text-align: right">1.0 KB</td><td class="num">in 23 h</td><td><span class="mt dim">—</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox /></td><td><span class="kk"><span class="pf">session:</span>u_e5a2b9/77d04</span></td><td class="num" style="text-align: right">1.2 KB</td><td class="num">in 3 d</td><td><span class="mt dim">—</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><UiCheckbox /></td><td><span class="kk"><span class="pf">session:</span>u_f1c004/0a9b1</span></td><td class="num" style="text-align: right">1.1 KB</td><td class="num">in 5 d</td><td><span class="mt">{"ip":"172.16.x","ua":"ios"}</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          </tbody>
        </table>
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
          <span>Showing 1–9 of <span class="mono">402,118</span> keys matching <span class="mono" style="color: var(--t2)">session:</span></span>
          <UiButton variant="secondary" size="sm">Load more <span class="mono dim" style="margin-left: 4px">cursor eyJr…</span></UiButton>
        </div>
      </section>

      <UiDrawer style="box-shadow: none">
        <UiDrawerHeader>
          <ResourceBindingChip kind="kv" label="KEY" />
          <span class="mono" style="font-size: 12.5px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">session:u_8f2a1c/7f3a9</span>
          <UiIconButton icon="copy" :size="13" label="Copy key" />
          <UiIconButton icon="x" label="Close" />
        </UiDrawerHeader>
        <UiDrawerBody>
          <UiKeyValueRow label="Size" style="padding-top: 0">1.2 KB · application/json</UiKeyValueRow>
          <div class="field">
            <div style="display: flex; justify-content: space-between; align-items: center"><label>Value</label><UiSegmented role="group" aria-label="Format"><UiSegment pressed>JSON</UiSegment><UiSegment>Text</UiSegment><UiSegment>Base64</UiSegment></UiSegmented></div>
            <div class="ed on"><div class="ln">1
2
3
4
5
6
7
8
9</div><div class="tx">{
  <span class="v">"user"</span>: <span class="s">"u_8f2a1c"</span>,
  <span class="v">"team"</span>: <span class="s">"acme"</span>,
  <span class="v">"roles"</span>: [<span class="s">"owner"</span>],
  <span class="v">"mfa"</span>: <span class="k">true</span>,
  <span class="v">"issuedAt"</span>: <span class="p">1763712402</span>,
  <span class="v">"csrf"</span>: <span class="s">"b8f…e21"</span>
}
</div></div>
            <span class="hint ok"><UiIcon name="check" :size="11" /> valid JSON · 214 bytes</span>
          </div>
          <div class="field">
            <label>Metadata <span class="muted" style="font-weight: 400">· ≤ 1024 bytes, returned on list</span></label>
            <div class="ed"><div class="ln">1</div><div class="tx">{ <span class="v">"ip"</span>: <span class="s">"88.12.x"</span>, <span class="v">"ua"</span>: <span class="s">"ios"</span> }</div></div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
            <div class="field"><label>Expiration TTL</label><UiInputBox><span class="mono" style="color: var(--t1)">3600</span><span style="margin-left: auto">s</span></UiInputBox></div>
            <div class="field"><label>Expires at</label><UiInputBox><span class="mono" style="font-size: 12px">2026-11-21 15:42 UTC</span></UiInputBox></div>
          </div>
          <span class="hint">Minimum TTL 60 s. Writes are eventually consistent — other locations may serve the old value for up to 60 s.</span>
        </UiDrawerBody>
        <UiDrawerFooter>
          <UiButton variant="secondary" style="color: var(--err)"><UiIcon name="trash" :size="13" />Delete</UiButton>
          <div style="flex: 1"></div>
          <UiButton variant="secondary">Discard</UiButton>
          <UiButton variant="primary">Save <kbd>⌘S</kbd></UiButton>
        </UiDrawerFooter>
      </UiDrawer>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Bindings</span><a href="#" class="muted" style="font-size: 12.5px">Manage →</a></div>
        <UiKeyValueRow label="CACHE" key-class="mono" key-style="color: var(--t1)">checkumi-edge · v42, v43</UiKeyValueRow>
        <UiKeyValueRow label="CACHE" key-class="mono" key-style="color: var(--t1)">checkumi-cron · v11</UiKeyValueRow>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Read latency</span><span class="v">p50 0.9 ms · p99 6 ms</span></div>
        <ChartArea seed="kvlat" :width="360" :height="64" color="#5EB0FF" />
        <div class="axis"><span>-24h</span><span>-12h</span><span>now</span></div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Danger zone</span></div>
        <p class="muted" style="font-size: 12.5px; margin: 0 0 10px">Deleting the namespace removes all 812,440 keys. Workers still bound to <span class="mono">CACHE</span> fail to deploy until the binding is removed.</p>
        <UiButton variant="secondary" style="color: var(--err); border-color: rgba(255,92,87,.35)"><UiIcon name="trash" :size="13" />Delete namespace…</UiButton>
      </section>
    </div>

  </div></template>
