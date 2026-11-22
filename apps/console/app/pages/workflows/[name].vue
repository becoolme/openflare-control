<script setup lang="ts">
definePageMeta({
  nav: 'Workflows',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'workflows', to: '/workflows' }, { label: 'order-fulfillment' }],
  validate: (route) => (route.params as Record<string, unknown>).name === 'order-fulfillment',
})
const overlays = useOverlays(['instance'] as const)
</script>

<template><div class="wrap pg-workflows" style="display: flex; flex-direction: column; gap: 20px">

    <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <div class="gl" style="margin-bottom: 6px">Compute · Workflows</div>
        <div style="display: flex; align-items: center; gap: 12px">
          <span class="pico" style="color: #F5A623"><UiIcon name="redo" :size="16" /></span>
          <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em" class="mono">order-fulfillment</h1>
          <UiBadge tone="neu" dot>v42 · 4 steps</UiBadge>
        </div>
        <p class="muted" style="margin: 8px 0 0; font-size: 13.5px; display: flex; gap: 14px; align-items: center"><span>class <span class="mono" style="color: var(--t2)">OrderWorkflow</span> in <span class="mono" style="color: var(--t2)">checkumi-edge</span></span><span>12 running · 31 waiting · 17 errored 24h</span><span>last run 8 s ago</span></p>
      </div>
      <div style="display: flex; gap: 8px">
        <UiButton variant="secondary"><UiIcon name="term" :size="13" />vrt workflows instances list</UiButton>
        <UiButton variant="secondary" disabled style="opacity: .6"><UiIcon name="play" :size="13" />Trigger instance<span class="miss" style="margin-left: 6px">no create API</span></UiButton>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 12px">
      <h2 style="margin: 0; font-size: 15px; font-weight: 600">Instances</h2>
      <div style="flex: 1"></div>
      <UiSegmented role="group" aria-label="Status"><UiSegment pressed>All</UiSegment><UiSegment>Running 12</UiSegment><UiSegment>Waiting 31</UiSegment><UiSegment>Paused 2</UiSegment><UiSegment>Errored 17</UiSegment><UiSegment>Complete</UiSegment></UiSegmented>
    </div>

    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 0; border: 1px solid var(--b1); border-radius: 12px; overflow: hidden; background: var(--s1)">
      <div style="min-width: 0">
        <div style="display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--b1)">
          <UiInputBox style="flex: 1"><UiIcon name="search" /><span>Instance id or param value…</span></UiInputBox>
          <UiButton variant="secondary" size="sm"><UiIcon name="filter" :size="12" />Started: 24h</UiButton>
        </div>
        <table class="tbl">
          <thead><tr><th>Instance</th><th>Status</th><th>Started</th><th>Duration</th><th>Current step</th><th></th></tr></thead>
          <tbody>
            <tr class="sel" @click="overlays.toggle('instance')"><td><div class="nm">wf_ord_9a1c</div><div class="sm">order #A-58213</div></td><td><UiBadge tone="err" dot>ERRORED</UiBadge></td><td class="num">14:58:02</td><td class="num">44 s</td><td class="num">charge-card <span class="dim">· 3/3</span></td><td style="text-align: right"><UiIconButton icon="redo" label="Restart" /></td></tr>
            <tr><td><div class="nm">wf_ord_9a1b</div><div class="sm">order #A-58212</div></td><td><UiBadge tone="warn" dot>RUNNING</UiBadge></td><td class="num">14:57:40</td><td class="num">1 m 6 s</td><td class="num">reserve-stock</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="Pause" /></td></tr>
            <tr><td><div class="nm">wf_ord_9a17</div><div class="sm">order #A-58208</div></td><td><UiBadge tone="info" dot>WAITING</UiBadge></td><td class="num">14:41:19</td><td class="num">17 m</td><td class="num">waitForEvent <span class="dim">shipped</span></td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><div class="nm">wf_ord_9a12</div><div class="sm">order #A-58203</div></td><td><UiBadge tone="neu" dot>PAUSED</UiBadge></td><td class="num">14:12:55</td><td class="num">46 m</td><td class="num">step.sleep <span class="dim">1h</span></td><td style="text-align: right"><UiIconButton icon="play" label="Resume" /></td></tr>
            <tr><td><div class="nm">wf_ord_9a0f</div><div class="sm">order #A-58200</div></td><td><UiBadge tone="ok" dot>COMPLETE</UiBadge></td><td class="num">13:59:31</td><td class="num">2 m 12 s</td><td class="num dim">—</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr><td><div class="nm">wf_ord_9a0e</div><div class="sm">order #A-58199</div></td><td><UiBadge tone="ok" dot>COMPLETE</UiBadge></td><td class="num">13:58:47</td><td class="num">1 m 51 s</td><td class="num dim">—</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
            <tr class="dim"><td><div class="nm">wf_ord_99f2</div><div class="sm">order #A-58170</div></td><td><UiBadge tone="neu" dot>TERMINATED</UiBadge></td><td class="num">12:02:10</td><td class="num">8 m</td><td class="num">by alex</td><td style="text-align: right"><UiIconButton icon="more" :size="15" label="More" /></td></tr>
          </tbody>
        </table>
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--b1); font-size: 12.5px" class="muted"><span>7 of 4,268 · newest first</span><UiButton variant="secondary" size="sm">Load more</UiButton></div>
      </div>
      <UiDrawer v-if="overlays.isOpen('instance')" aria-label="Instance detail">
        <UiDrawerHeader><span class="mono" style="font-weight: 600">wf_ord_9a1c</span><UiBadge tone="err" dot>ERRORED</UiBadge><div style="flex: 1"></div><UiIconButton icon="copy" label="Copy id" /><UiIconButton icon="x" label="Close" @click="overlays.close('instance')" /></UiDrawerHeader>
        <UiDrawerBody>
          <div>
            <div class="gl" style="margin-bottom: 6px">Params</div>
            <div class="code" style="font-size: 11.5px; padding: 8px 10px">{ <span class="v">"orderId"</span>: <span class="s">"A-58213"</span>,
  <span class="v">"amount"</span>: <span class="p">4900</span>, <span class="v">"currency"</span>: <span class="s">"usd"</span> }</div>
          </div>
          <div>
            <div class="gl" style="margin-bottom: 10px">Steps</div>
            <div class="stp"><span class="ic ok"><UiIcon name="check" :size="11" /></span><div><div class="t">step.do("validate-order")</div><div class="d">1 attempt · output <span class="mono">{ ok: true, items: 3 }</span></div></div><span class="r">120 ms</span></div>
            <div class="stp"><span class="ic ok"><UiIcon name="check" :size="11" /></span><div><div class="t">step.do("reserve-stock")</div><div class="d">1 attempt · output <span class="mono">{ reservation: "rs_77f" }</span></div></div><span class="r">2.1 s</span></div>
            <div class="stp"><span class="ic ok"><UiIcon name="clock" :size="11" /></span><div><div class="t">step.sleep("cool-off", "30 seconds")</div><div class="d">woke 14:58:36</div></div><span class="r">30 s</span></div>
            <div class="stp"><span class="ic err"><UiIcon name="x" :size="11" /></span><div><div class="t">step.do("charge-card")</div><div class="d" style="color: var(--err)">3/3 attempts · backoff exponential 2 s</div></div><span class="r">11.4 s</span></div>
            <div class="stp"><span class="ic"><UiIcon name="mail" :size="11" /></span><div><div class="t dim">step.waitForEvent("shipped")</div><div class="d">not reached · timeout 7 d</div></div><span class="r">—</span></div>
          </div>
          <div>
            <div class="gl" style="margin-bottom: 6px; color: var(--err)">Error</div>
            <div class="code" style="font-size: 11.5px; padding: 8px 10px; border-color: rgba(255,92,87,.3)"><span style="color: var(--err)">NonRetryableError</span>: card_declined (insufficient_funds)
  at charge (src/order.ts:88:13)
<span class="c">request id 01JD6Q2T8W…c4e</span></div>
          </div>
        </UiDrawerBody>
        <UiDrawerFooter><UiButton variant="secondary" size="sm" disabled style="opacity: .5"><UiIcon name="clock" :size="12" />Pause</UiButton><UiButton variant="secondary" size="sm" disabled style="opacity: .5"><UiIcon name="play" :size="12" />Resume</UiButton><UiButton variant="primary" size="sm"><UiIcon name="redo" :size="12" />Restart</UiButton><div style="flex: 1"></div><UiButton variant="secondary" size="sm" style="color: var(--err)">Terminate</UiButton></UiDrawerFooter>
      </UiDrawer>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start">
      <section class="card" style="padding: 16px">
        <div class="ch-h"><span class="t">Instance actions</span><span class="v">POST …/instances/:i/:action</span></div>
        <UiKeyValueRow label="pause">running → paused · current step finishes first</UiKeyValueRow>
        <UiKeyValueRow label="resume">paused → running</UiKeyValueRow>
        <UiKeyValueRow label="restart">replays from step 1 · same params</UiKeyValueRow>
        <UiKeyValueRow label="terminate" value-style="color: var(--err)">any → terminated · not resumable</UiKeyValueRow>
        <UiKeyValueRow label="audit">workflow.instance.&lt;action&gt;</UiKeyValueRow>
      </section>
      <section class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 10px">
        <div class="ch-h" style="margin: 0"><span class="t">Trigger new instance</span><span class="miss"><UiIcon name="warn" :size="10" />no create API</span></div>
        <div class="field"><label>Instance id <span class="dim">(optional, idempotency key)</span></label><UiInputBox><span class="dim">auto · wf_ord_…</span></UiInputBox></div>
        <div class="code" style="font-size: 12px; padding: 10px 12px; height: 64px">{ <span class="v">"orderId"</span>: <span class="s">"A-58214"</span>, <span class="v">"amount"</span>: <span class="p">1200</span> }</div>
        <div style="display: flex; gap: 8px; justify-content: flex-end"><UiButton variant="primary" size="sm" disabled style="opacity: .5"><UiIcon name="play" :size="12" />Create instance</UiButton></div>
      </section>
    </div>

  </div></template>
