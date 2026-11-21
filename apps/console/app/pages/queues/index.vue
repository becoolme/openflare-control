<script setup lang="ts">
definePageMeta({
  nav: 'Queues',
  crumbs: () => [{ label: 'storage', to: '/storage' }, { label: 'queues' }],
})
</script>

<template><div class="wrap pg-queue-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px; display: flex; gap: 8px; align-items: center"><ResourceBindingChip kind="q" />Storage &amp; Databases</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Queues</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">At-least-once message queues. Producers bind with <span class="mono" style="color: var(--t2)">[[queues.producers]]</span>; one consumer worker per queue, with retries and a dead-letter queue.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt queues create</UiButton>
        <UiButton variant="primary"><UiIcon name="plus" />Create queue</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Queues"><template #value>7</template><UiMetricFoot>1 lagging · 1 dead-letter</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Backlog"><template #value>1,284</template><UiMetricFoot><span class="warn">playtown-events 1,204</span></UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Delivered" hint="24h"><template #value>2.2<small> M</small></template><UiMetricFoot>retries 0.4%</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="In DLQ" value-style="color: var(--err)"><template #value>3</template><UiMetricFoot>playtown-events-dlq</UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by queue or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All <span class="n">7</span></UiSegment><UiSegment>Lagging <span class="n">1</span></UiSegment><UiSegment>No consumer <span class="n">1</span></UiSegment><UiSegment>Dead-letter <span class="n">1</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Worker: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Backlog ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Queue</th><th>Status</th><th>Producers</th><th>Consumer</th><th style="text-align: right">Backlog</th><th>Delivered 24h</th><th style="text-align: right">Oldest</th><th style="text-align: right">DLQ</th><th></th></tr></thead>
        <tbody>
          <tr class="sel"><td><div class="nm"><NuxtLink to="/queues/playtown-events">playtown-events</NuxtLink></div><div class="sm">batch 50 · 3 retries</div></td><td><UiBadge tone="warn" dot>LAGGING</UiBadge></td><td><div class="bw"><span class="wk">playtown-api</span><span class="wk">playtown-hooks</span></div></td><td><span class="wk">playtown-hooks</span></td><td class="num warn" style="text-align: right">1,204</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">1.41M</span><ChartSparkline seed="ql1" :width="60" :height="18" color="var(--warn)" /></div></td><td class="num warn" style="text-align: right">6 m 12 s</td><td class="num err" style="text-align: right">3</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">checkumi-jobs</div><div class="sm">batch 10 · 5 retries</div></td><td><UiBadge tone="ok" dot>ACTIVE</UiBadge></td><td><div class="bw"><span class="wk">checkumi-edge</span></div></td><td><span class="wk">checkumi-cron</span></td><td class="num" style="text-align: right">72</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">604k</span><ChartSparkline seed="ql2" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num" style="text-align: right">4 s</td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">rybbit-ingest</div><div class="sm">batch 100 · 3 retries</div></td><td><UiBadge tone="ok" dot>ACTIVE</UiBadge></td><td><div class="bw"><span class="wk">rybbit-proxy</span></div></td><td><span class="wk">rybbit-proxy</span></td><td class="num" style="text-align: right">0</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">188k</span><ChartSparkline seed="ql3" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num dim" style="text-align: right">—</td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">whois-fetch</div><div class="sm">batch 5 · 10 retries</div></td><td><UiBadge tone="ok" dot>ACTIVE</UiBadge></td><td><div class="bw"><span class="wk">whois-cron</span></div></td><td><span class="wk">whois-cron</span></td><td class="num" style="text-align: right">8</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">9.6k</span><ChartSparkline seed="ql4" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num" style="text-align: right">41 s</td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">opentin-reindex</div><div class="sm">batch 20 · 3 retries</div></td><td><UiBadge tone="ok" dot>ACTIVE</UiBadge></td><td><div class="bw"><span class="wk">opentin-search</span></div></td><td><span class="wk">opentin-search</span></td><td class="num" style="text-align: right">0</td><td><div style="display: flex; align-items: center; gap: 10px"><span class="num" style="min-width: 44px">2.4k</span><ChartSparkline seed="ql5" :width="60" :height="18" color="var(--t2)" /></div></td><td class="num dim" style="text-align: right">—</td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">playtown-events-dlq</div><div class="sm">dead-letter for playtown-events</div></td><td><UiBadge tone="err" dot>DEAD-LETTER</UiBadge></td><td><span class="muted" style="font-size: 12.5px">from playtown-events</span></td><td><span class="muted" style="font-size: 12.5px">—</span></td><td class="num err" style="text-align: right">3</td><td><span class="num dim">—</span></td><td class="num" style="text-align: right">2 h</td><td class="num dim" style="text-align: right">—</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="dim"><td><div class="nm">checkumi-email</div><div class="sm">batch 10 · 3 retries</div></td><td><UiBadge tone="neu" dot>NO CONSUMER</UiBadge></td><td><div class="bw"><span class="wk">checkumi-edge</span></div></td><td><span class="muted" style="font-size: 12.5px">—</span></td><td class="num" style="text-align: right">0</td><td><span class="num">0</span></td><td class="num dim" style="text-align: right">—</td><td class="num" style="text-align: right">0</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>7 of 7 · sorted by backlog</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

    <UiBanner tone="info" icon="info"><div>Queues are listed from producer and consumer bindings across workers. <span class="miss"><UiIcon name="warn" :size="10" />account-level Queues list API</span> A queue with no binding is not shown.</div></UiBanner>

  </div></template>
