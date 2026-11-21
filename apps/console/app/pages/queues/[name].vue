<script setup lang="ts">
definePageMeta({
  nav: 'Queues',
  crumbs: () => [{ label: 'queues', to: '/storage' }, { label: 'playtown-events' }],
  validate: (route) => (route.params as Record<string, unknown>).name === 'playtown-events',
})
</script>

<template><div class="wrap pg-queue" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Storage &amp; Databases · Queues</div>
        <div class="qh">
          <span class="pico" style="color: #B69CFF"><UiIcon name="layers" :size="16" /></span>
          <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em" class="mono">playtown-events</h1>
          <UiBadge tone="warn" dot>BACKLOG GROWING</UiBadge>
        </div>
        <p class="muted" style="margin: 8px 0 0; font-size: 13.5px">Bound by 2 producers · consumed by <span class="mono" style="color: var(--t2)">playtown-hooks</span> · DLQ <span class="mono" style="color: var(--t2)">playtown-events-dlq</span> · created Oct 21 by alex</p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="copy" :size="13" />Copy name</UiButton>
        <UiButton variant="secondary"><UiIcon name="plus" :size="13" />Add consumer</UiButton>
        <UiButton variant="secondary" style="color: var(--err)"><UiIcon name="trash" :size="13" />Purge…</UiButton>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
      <UiMetricCard label="Backlog" hint="messages" value-class="warn"><template #value>18,402</template><UiMetricFoot><span class="warn">+3.1k</span> in last 15 min</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Produced" hint="msg/s"><template #value>42.6</template><UiMetricFoot>2 producers · avg 1.8 KiB</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Consumed" hint="msg/s"><template #value>39.1</template><UiMetricFoot>ack 97.2% · retry 2.6%</UiMetricFoot></UiMetricCard>
      <UiMetricCard label="Oldest message" hint="age"><template #value>7<small> m</small> 42<small> s</small></template><UiMetricFoot>retention 4 d</UiMetricFoot></UiMetricCard>
    </div>

    <UiTabs>
      <UiTab active>Overview</UiTab>
      <UiTab>Messages <span class="miss" style="margin-left: 4px">no browse API</span></UiTab>
      <UiTab>Consumers <span class="mono dim">1</span></UiTab>
      <UiTab>Settings</UiTab>
    </UiTabs>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Backlog</span><span class="v">last 6h · peak 18.4k</span></div>
        <ChartArea seed="qb1" :width="600" :height="140" color="var(--warn)" />
        <div class="axis"><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span><span>14:00</span><span>15:00</span><span>now</span></div>
      </section>
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Throughput</span><span class="v"><span style="color: #B69CFF">■</span> produced &nbsp;<span style="color: var(--t3)">■</span> consumed</span></div>
        <div style="position: relative; height: 140px">
          <div style="position: absolute; inset: 0"><ChartArea seed="qt1" :width="600" :height="140" color="#B69CFF" /></div>
          <div style="position: absolute; inset: 0; opacity: .8"><ChartArea seed="qt2" :width="600" :height="140" color="var(--t3)" /></div>
        </div>
        <div class="axis"><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span><span>14:00</span><span>15:00</span><span>now</span></div>
      </section>
    </div>

    <UiBanner tone="warn" icon="warn"><div><b>Consumer is falling behind.</b> <span class="mono">playtown-hooks</span> v9 errors on 4.7% of batches; each failed batch retries up to 3× before going to the DLQ. Raise <span class="mono">max_concurrency</span> or fix the handler — <NuxtLink to="/workers/checkumi-edge/logs" style="color: var(--t1); text-decoration: underline">open live tail</NuxtLink>.</div></UiBanner>

    <section class="card" style="padding: 0">
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--b1)">
        <div><h2 class="sec-t">Producers &amp; consumers</h2><p class="sec-d">From each worker's <span class="mono">[[queues.producers]]</span> / <span class="mono">[[queues.consumers]]</span> in its active deployment.</p></div>
        <UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Add consumer</UiButton>
      </div>
      <table class="tbl cons">
        <thead><tr><th>Worker</th><th>Role</th><th>Binding</th><th>Batch size</th><th>Max wait</th><th>Retries</th><th>Concurrency</th><th>DLQ</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr><td><div class="nm">checkumi-edge</div><div class="sm">v42 · 90%</div></td><td><span class="kind">PRODUCER</span></td><td class="num">EVENTS</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td><td><UiBadge tone="ok" dot>SENDING</UiBadge></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr><td><div class="nm">playtown-api</div><div class="sm">v31</div></td><td><span class="kind">PRODUCER</span></td><td class="num">QUEUE</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td><td class="num dim">—</td><td><UiBadge tone="ok" dot>SENDING</UiBadge></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          <tr class="sel"><td><div class="nm">playtown-hooks</div><div class="sm">v9 · queue() handler</div></td><td><span class="kind" style="color: #B69CFF; border-color: rgba(167,139,250,.4)">CONSUMER</span></td><td class="num dim">—</td><td class="num">25</td><td class="num">5 s</td><td class="num">3</td><td class="num">4 <span class="dim">/ auto</span></td><td class="num">playtown-events-dlq</td><td><UiBadge tone="warn" dot>LAGGING</UiBadge></td><td style="text-align: right"><UiIconButton icon="edit" label="More" /></td></tr>
        </tbody>
      </table>
    </section>

    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px">
      <section class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 12px">
        <div class="ch-h" style="margin: 0"><span class="t">Dead-letter queue</span><a href="#" class="mono" style="font-size: 12px; color: var(--t3)">playtown-events-dlq →</a></div>
        <div style="display: flex; align-items: baseline; gap: 8px"><span class="mono" style="font-size: 28px; font-weight: 500; color: var(--err)">214</span><span class="muted" style="font-size: 12.5px">messages · oldest 2 h</span></div>
        <UiKeyValueRow label="Top error" value-style="color: var(--err)">TypeError: cannot read 'id'</UiKeyValueRow>
        <UiKeyValueRow label="Last arrival">3 m ago</UiKeyValueRow>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto">
          <UiButton variant="secondary" size="sm" disabled style="opacity: .55"><UiIcon name="redo" :size="12" />Redrive to source</UiButton>
          <span class="miss"><UiIcon name="warn" :size="10" />no redrive API</span>
        </div>
      </section>
      <section class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 10px">
        <div class="ch-h" style="margin: 0"><span class="t">Send test message</span><span class="miss"><UiIcon name="warn" :size="10" />no send API</span></div>
        <UiSegmented><UiSegment pressed>JSON</UiSegment><UiSegment>Text</UiSegment><UiSegment>Bytes</UiSegment></UiSegmented>
        <div class="code" style="font-size: 12px; padding: 10px 12px; height: 100px">{
  <span class="v">"type"</span>: <span class="s">"match.finished"</span>,
  <span class="v">"matchId"</span>: <span class="s">"m_8f21"</span>
}</div>
        <div style="display: flex; gap: 8px; align-items: center"><UiInputBox style="flex: 1; height: 30px"><span class="dim">delay</span><span style="color: var(--t1)">0 s</span></UiInputBox><UiButton variant="primary" size="sm">Send</UiButton></div>
      </section>
      <section class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 4px">
        <div class="ch-h"><span class="t">Settings</span><UiButton variant="secondary" size="sm"><UiIcon name="edit" :size="12" />Edit</UiButton></div>
        <UiKeyValueRow label="Delivery delay">0 s</UiKeyValueRow>
        <UiKeyValueRow label="Retention">4 days</UiKeyValueRow>
        <UiKeyValueRow label="Max message size">128 KiB</UiKeyValueRow>
        <UiKeyValueRow label="Backend">runtime-local · k3s-014</UiKeyValueRow>
        <UiKeyValueRow label="Queue ID">q_7c1e9a04…</UiKeyValueRow>
      </section>
    </div>

    <section class="card" style="padding: 16px; border-color: rgba(255,92,87,.3); display: grid; grid-template-columns: minmax(0, 1fr) 480px; gap: 24px; align-items: center; background: linear-gradient(90deg, rgba(255,92,87,.04), transparent 60%)">
      <div>
        <div class="gl" style="color: var(--err)">Danger zone</div>
        <h2 class="sec-t" style="margin-top: 6px">Purge or delete this queue</h2>
        <p class="sec-d" style="line-height: 1.6">Purge drops every pending message (<span class="mono">POST /api/workers/:id/queues/:q/purge</span>) — producers and consumers keep running. Delete removes the queue; workers that still bind it fail their next deploy until the binding is removed.</p>
        <div style="display: flex; gap: 8px; margin-top: 14px"><UiButton variant="secondary" style="color: var(--err)">Purge messages</UiButton><UiButton variant="secondary" style="color: var(--err)"><UiIcon name="trash" :size="13" />Delete queue</UiButton></div>
      </div>
      <UiDialog inline aria-label="Purge queue">
        <UiDialogBody>
          <UiDialogTitle>Purge playtown-events?</UiDialogTitle>
          <p class="muted" style="font-size: 13px; margin: 0 0 12px; line-height: 1.55">All <b style="color: var(--t1)">18,402</b> pending messages are deleted immediately. In-flight batches finish; the DLQ is not touched. This cannot be undone.</p>
          <div class="field"><label>Type <span class="mono" style="color: var(--t1)">playtown-events</span> to confirm</label><UiInputBox focused><span class="mono" style="color: var(--t1)">playtown-ev</span><span style="width: 1px; height: 15px; background: var(--accent)"></span></UiInputBox></div>
        </UiDialogBody>
        <UiDialogFooter><span class="hint" style="margin-right: auto">writes audit <span class="mono">queue.purge</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton size="sm" disabled style="background: var(--err); color: #fff; opacity: .5; border-color: transparent">Purge 18,402 messages</UiButton></UiDialogFooter>
      </UiDialog>
    </section>

  </div></template>
