<script setup lang="ts">
definePageMeta({
  nav: 'Workflows',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'workflows' }],
})
</script>

<template><div class="wrap pg-workflows-list" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute</div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workflows</h1>
        <p class="muted" style="margin: 6px 0 0; font-size: 13.5px">Durable multi-step runs declared with <span class="mono" style="color: var(--t2)">[[workflows]]</span>. Each step is checkpointed; failed steps retry with backoff.</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt workflows list</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Workflows"><template #value>6</template><UiMetricFoot>across 5 workers</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Running / waiting"><template #value>14<small> / 36</small></template><UiMetricFoot>2 paused</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Complete" hint="24h"><template #value>4,903</template><UiMetricFoot>p50 1 m 48 s</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Errored" hint="24h" value-style="color: var(--err)"><template #value>18</template><UiMetricFoot><span class="warn">order-fulfillment 17</span></UiMetricFoot></UiMetricCard>
    </div>

    <section class="card" style="padding: 0">
      <UiTabs style="padding: 0 10px">
        <UiTab to="/workers">Workers <span class="mono dim">27</span></UiTab>
        <UiTab active>Workflows <span class="mono dim">6</span></UiTab>
        <UiTab>Cron triggers <span class="mono dim">9</span></UiTab>
        <UiTab>Queue consumers <span class="mono dim">5</span></UiTab>
      </UiTabs>
      <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
        <UiInputBox style="width: 280px"><UiIcon name="search" /><span>Filter by workflow, class or worker…</span><kbd style="margin-left: auto">/</kbd></UiInputBox>
        <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All <span class="n">6</span></UiSegment><UiSegment>Running <span class="n">3</span></UiSegment><UiSegment>Errored 24h <span class="n">2</span></UiSegment><UiSegment>Idle <span class="n">1</span></UiSegment></UiSegmented>
        <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Worker: any</UiButton>
        <div style="flex: 1"></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="updown" :size="12" />Last run ↓</UiButton>
      </div>
      <table class="tbl">
        <thead><tr><th>Workflow</th><th>Worker</th><th>Class</th><th style="text-align: right">Running</th><th style="text-align: right">Waiting</th><th style="text-align: right">Complete 24h</th><th style="text-align: right">Errored 24h</th><th>Last run</th><th></th></tr></thead>
        <tbody>
          <UiLinkRow to="/workflows/order-fulfillment" class="sel"><td><div class="nm"><NuxtLink to="/workflows/order-fulfillment">order-fulfillment</NuxtLink></div><div class="sm">4 steps · v42</div></td><td><span class="wk">checkumi-edge</span></td><td class="num muted">OrderWorkflow</td><td class="num" style="text-align: right; color: var(--warn)">12</td><td class="num" style="text-align: right">31</td><td class="num" style="text-align: right">4,208</td><td class="num" style="text-align: right; color: var(--err)">17</td><td class="num">8 s ago</td><td style="text-align: right"><UiIcon name="chevr" /></td></UiLinkRow>
          <tr><td><div class="nm">match-settlement</div><div class="sm">3 steps · v9</div></td><td><span class="wk">playtown-hooks</span></td><td class="num muted">SettleWorkflow</td><td class="num" style="text-align: right">2</td><td class="num" style="text-align: right">5</td><td class="num" style="text-align: right">612</td><td class="num" style="text-align: right; color: var(--err)">1</td><td class="num">41 s ago</td><td style="text-align: right"><UiIcon name="chevr" /></td></tr>
          <tr><td><div class="nm">refund-review</div><div class="sm">5 steps · v42</div></td><td><span class="wk">checkumi-edge</span></td><td class="num muted">RefundWorkflow</td><td class="num dim" style="text-align: right">0</td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">38</td><td class="num dim" style="text-align: right">0</td><td class="num">12 m ago</td><td style="text-align: right"><UiIcon name="chevr" /></td></tr>
          <tr><td><div class="nm">whois-rescan</div><div class="sm">2 steps · v6</div></td><td><span class="wk">whois-cron</span></td><td class="num muted">RescanWorkflow</td><td class="num dim" style="text-align: right">0</td><td class="num dim" style="text-align: right">0</td><td class="num" style="text-align: right">44</td><td class="num dim" style="text-align: right">0</td><td class="num">14:45 UTC</td><td style="text-align: right"><UiIcon name="chevr" /></td></tr>
          <tr><td><div class="nm">nightly-digest</div><div class="sm">3 steps · v31</div></td><td><span class="wk">playtown-api</span></td><td class="num muted">DigestWorkflow</td><td class="num dim" style="text-align: right">0</td><td class="num dim" style="text-align: right">0</td><td class="num" style="text-align: right">1</td><td class="num dim" style="text-align: right">0</td><td class="num">03:00 UTC</td><td style="text-align: right"><UiIcon name="chevr" /></td></tr>
          <tr class="dim"><td><div class="nm">user-export</div><div class="sm">4 steps · v27</div></td><td><span class="wk">opentin-search</span></td><td class="num muted">ExportWorkflow</td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0</td><td class="num" style="text-align: right">0</td><td class="num muted">Nov 08</td><td style="text-align: right"><UiIcon name="chevr" /></td></tr>
        </tbody>
      </table>
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted">
        <span>6 of 6 · sorted by last run</span>
        <div style="display: flex; gap: 6px"><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Previous</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5">Next</UiButton></div>
      </div>
    </section>

  </div></template>
