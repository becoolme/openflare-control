<script setup lang="ts">
definePageMeta({
  nav: 'R2',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'r2' }],
})
</script>

<template><div class="wrap pg-r2-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="r2" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">R2 buckets</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">S3-compatible object storage bound with <span class="mono" style="color: var(--t2)">[[r2_buckets]]</span>. Buckets are served by the cluster's MinIO; no egress fees between workers and buckets.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt r2 bucket create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create bucket</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Buckets"><template #value>5</template><UiMetricFoot>4 bound · 1 unbound</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Objects"><template #value>184<small> k</small></template><UiMetricFoot>61.7 GB stored</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Class A / B ops" hint="24h"><template #value>412<small> k / 6.8 M</small></template><UiMetricFoot>writes / reads</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Public buckets"><template #value>0</template><UiMetricFoot><span class="miss"><UiIcon name="warn" :size="10" />public URL API</span></UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by bucket or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Binding"><UiSegment pressed>All <span class="n">5</span></UiSegment><UiSegment>Bound <span class="n">4</span></UiSegment><UiSegment>Unbound <span class="n">1</span></UiSegment></UiSegmented>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Size ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Bucket</th><th>Bound by</th><th style="text-align: right">Objects</th><th style="text-align: right">Size</th><th>Public access</th><th style="text-align: right">Class A / B 24h</th><th>Node</th><th>Created</th><th></th></tr></thead>
        <tbody>
          <tr class="sel"><td><div class="nm"><NuxtLink to="/r2/checkumi-assets/objects">checkumi-assets</NuxtLink></div><div class="sm">ASSETS</div></td><td><div class="bw"><span class="wk">checkumi-edge</span></div></td><td class="num" style="text-align: right">128,402</td><td class="num" style="text-align: right">42.8 GB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">288k / 5.1M</td><td class="num muted">fsn · k3s-009</td><td class="num muted">Aug 30</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">whois-archive</div><div class="sm">ARCHIVE</div></td><td><div class="bw"><span class="wk">whois-cron</span></div></td><td class="num" style="text-align: right">51,040</td><td class="num" style="text-align: right">18.4 GB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">96 / 1.4k</td><td class="num muted">fsn · k3s-009</td><td class="num muted">Oct 02</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-uploads</div><div class="sm">UPLOADS</div></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td class="num" style="text-align: right">4,912</td><td class="num" style="text-align: right">512 MB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">124k / 1.3M</td><td class="num muted">fsn · k3s-009</td><td class="num muted">Nov 02</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">playtown-replays</div><div class="sm">REPLAYS</div></td><td><div class="bw"><span class="wk">playtown-hooks</span></div></td><td class="num" style="text-align: right">2,206</td><td class="num" style="text-align: right">31 MB</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">412 / 2.8k</td><td class="num muted">fsn · k3s-009</td><td class="num muted">Nov 09</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">import-scratch</div><div class="sm">unbound</div></td><td><span class="muted" style="font-size: 12.5px">—</span></td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0 B</td><td><UiBadge tone="neu" dot>PRIVATE</UiBadge></td><td class="num" style="text-align: right">0 / 0</td><td class="num muted">fsn · k3s-009</td><td class="num muted">Sep 28</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>5 of 5 · sorted by size</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

  </div></template>
