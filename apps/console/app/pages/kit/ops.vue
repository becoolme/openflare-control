<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'ops' }],
})
</script>

<template><div class="wrap pg-ops" style="display: flex; flex-direction: column; gap: 22px">

    <div>
      <div class="gl" style="margin-bottom: 6px">Compute · Workers · interaction states</div>
      <h1 style="margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.03em">Workers — dialogs, drawers &amp; toasts</h1>
      <p class="muted" style="margin: 8px 0 0; font-size: 13.5px">Every create / edit / destructive flow for Workers and their storage, shown open. Each one names the API it calls and the audit event it writes.</p>
    </div>

    <div class="gal">

      <!-- 1 create worker -->
      <div class="cell">
        <div class="gl">01 · Create worker</div>
        <UiDialog inline aria-label="Create worker">
          <UiDialogBody>
            <UiDialogTitle>Create a Worker</UiDialogTitle>
            <div class="field"><label>Name</label><UiInputBox focused><span class="mono" style="color: var(--t1)">match-hub</span></UiInputBox>
              <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px"><span class="ok-l"><UiIcon name="check" :size="12" />available</span><span class="hint">URL <span class="mono" style="color: var(--t2)">https://w-match-hub.example.dev</span></span></div></div>
            <div class="flb" style="margin: 14px 0 8px">Start from</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
              <div class="opt on"><UiRadio checked /><div><div class="ot">Template</div><div class="od">Hello World, Router, DO chat, Queue consumer</div></div></div>
              <div class="opt"><UiRadio /><div><div class="ot">Import from Git</div><div class="od">GitHub repo · builds on push</div></div></div>
              <div class="opt"><UiRadio /><div><div class="ot">Upload bundle</div><div class="od">Drop a built <span class="mono">dist/</span> or <span class="mono">.zip</span></div></div></div>
              <div class="opt"><UiRadio /><div><div class="ot">CLI</div><div class="od"><span class="mono">vrt deploy</span> from your repo</div></div></div>
            </div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">worker.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Create &amp; deploy</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 2 create kv / d1 -->
      <div class="cell">
        <div class="gl">02 · Create KV namespace · name taken</div>
        <UiDialog inline aria-label="Create KV">
          <UiDialogBody>
            <UiDialogTitle>Create KV namespace</UiDialogTitle>
            <div class="field"><label>Namespace name</label><UiInputBox invalid><span class="mono" style="color: var(--t1)">sessions</span></UiInputBox><div class="err-l" style="margin-top: 6px"><UiIcon name="warn" :size="12" />A namespace named "sessions" already exists in this team.</div></div>
            <div class="field" style="margin-top: 12px"><label>Bind to worker <span class="dim">(optional)</span></label><UiInputBox><UiIcon name="chev" :size="13" /><span style="color: var(--t1)">checkumi-edge</span><span class="dim" style="margin-left: auto">as</span><span class="mono" style="color: var(--t1)">SESSIONS</span></UiInputBox></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">kv.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm" disabled style="opacity: .5">Create</UiButton></UiDialogFooter>
        </UiDialog>
        <div class="gl" style="margin-top: 12px">03 · Create D1 database</div>
        <UiDialog inline aria-label="Create D1">
          <UiDialogBody>
            <UiDialogTitle>Create D1 database</UiDialogTitle>
            <div class="field"><label>Database name</label><UiInputBox focused><span class="mono" style="color: var(--t1)">checkumi-prod</span></UiInputBox></div>
            <div class="field" style="margin-top: 12px"><label>Location hint</label><UiSegmented><UiSegment pressed>Auto</UiSegment><UiSegment>fsn</UiSegment><UiSegment>nbg</UiSegment><UiSegment>hel</UiSegment></UiSegmented></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">d1.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Create</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 4 create r2 -->
      <div class="cell">
        <div class="gl">04 · Create R2 bucket</div>
        <UiDialog inline aria-label="Create bucket">
          <UiDialogBody>
            <UiDialogTitle>Create R2 bucket</UiDialogTitle>
            <div class="field"><label>Bucket name</label><UiInputBox focused><span class="mono" style="color: var(--t1)">checkumi-uploads</span></UiInputBox><div class="hint" style="margin-top: 6px">3–63 chars · lowercase, digits, hyphens</div></div>
            <div class="field" style="margin-top: 12px"><label>Storage class</label><UiSegmented><UiSegment pressed>Standard</UiSegment><UiSegment>Infrequent access</UiSegment></UiSegmented></div>
            <label class="chk" style="margin-top: 12px"><UiCheckbox />Allow public access via <span class="mono">r2.example.dev</span></label>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">r2.bucket.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Create bucket</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 5 create queue -->
      <div class="cell">
        <div class="gl">05 · Create Queue</div>
        <UiDialog inline aria-label="Create queue">
          <UiDialogBody>
            <UiDialogTitle>Create Queue</UiDialogTitle>
            <div class="field"><label>Queue name</label><UiInputBox focused><span class="mono" style="color: var(--t1)">match-results</span></UiInputBox></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px">
              <div class="field"><label>Delivery delay</label><UiInputBox><span style="color: var(--t1)">0</span><span class="dim" style="margin-left: auto">s</span></UiInputBox></div>
              <div class="field"><label>Retention</label><UiInputBox><span style="color: var(--t1)">4</span><span class="dim" style="margin-left: auto">days</span></UiInputBox></div>
            </div>
            <label class="chk" style="margin-top: 12px"><UiCheckbox checked />Create DLQ <span class="mono">match-results-dlq</span></label>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">queue.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Create queue</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 6 hyperdrive -->
      <div class="cell">
        <div class="gl">06 · Create Hyperdrive config</div>
        <UiDialog inline aria-label="Create Hyperdrive">
          <UiDialogBody>
            <UiDialogTitle>Create Hyperdrive config</UiDialogTitle>
            <div class="field"><label>Name</label><UiInputBox focused><span class="mono" style="color: var(--t1)">checkumi-pg</span></UiInputBox></div>
            <div class="flb" style="margin: 14px 0 8px">Origin database</div>
            <div style="display: flex; flex-direction: column; gap: 8px">
              <div class="opt on"><UiRadio checked /><div style="flex: 1"><div class="ot">Managed Postgres</div><div class="od">Pick a managed database — credentials stay server-side</div><UiInputBox style="margin-top: 8px"><UiIcon name="db" :size="13" /><span style="color: var(--t1)">checkumi-main</span><span class="dim" style="margin-left: auto">pg 18 · grp3</span></UiInputBox></div></div>
              <div class="opt"><UiRadio /><div><div class="ot">Connection string</div><div class="od mono">postgres://user:••••@host:5432/db</div></div></div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 14px"><div><div class="ot" style="font-size: 13px">Query caching</div><div class="hint">Cache read queries for 60 s at the edge</div></div><UiSwitch checked /></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">hyperdrive.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Create</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 7 add binding drawer -->
      <div class="cell">
        <div class="gl">07 · Add binding · drawer</div>
        <UiDrawer inline aria-label="Add binding">
          <UiDrawerHeader><span style="font-weight: 600">Add binding</span><span class="hint">checkumi-edge</span><div style="flex: 1"></div><UiIconButton icon="x" label="Close" /></UiDrawerHeader>
          <UiDrawerBody>
            <div class="tg">
              <div class="ty"><ResourceBindingChip kind="kv" />KV</div>
              <div class="ty on"><ResourceBindingChip kind="d1" />D1</div>
              <div class="ty"><ResourceBindingChip kind="r2" />R2</div>
              <div class="ty"><ResourceBindingChip kind="q" />Queue</div>
              <div class="ty"><ResourceBindingChip kind="do" />Durable Obj.</div>
              <div class="ty"><ResourceBindingChip kind="sv" label="SV" />Service</div>
              <div class="ty"><ResourceBindingChip kind="wf" />Workflow</div>
              <div class="ty"><ResourceBindingChip kind="hd" />Hyperdrive</div>
              <div class="ty"><ResourceBindingChip kind="as" label="AS" />Assets</div>
              <div class="ty"><ResourceBindingChip label="$" />Variable</div>
            </div>
            <div class="field"><label>Variable name</label><UiInputBox invalid><span class="mono" style="color: var(--t1)">checkumiDb</span></UiInputBox><div class="err-l" style="margin-top: 6px"><UiIcon name="warn" :size="12" />Use UPPER_SNAKE_CASE — e.g. <span class="mono">CHECKUMI_DB</span></div></div>
            <div class="field"><label>D1 database</label><UiInputBox><UiIcon name="db" :size="13" /><span style="color: var(--t1)">checkumi-prod</span><span class="dim" style="margin-left: auto">412 MiB</span><UiIcon name="chev" :size="13" /></UiInputBox></div>
            <UiBanner tone="info" icon="info" :icon-size="14" style="font-size: 12.5px"><div>Bindings change the deployment manifest. <b>Requires redeploy</b> — v44 will be created from v43's code.</div></UiBanner>
          </UiDrawerBody>
          <UiDrawerFooter><UiButton variant="secondary" size="sm">Cancel</UiButton><div style="flex: 1"></div><UiButton variant="secondary" size="sm">Save only</UiButton><UiButton variant="primary" size="sm">Save &amp; redeploy</UiButton></UiDrawerFooter>
        </UiDrawer>
      </div>

      <!-- 8 add secret -->
      <div class="cell">
        <div class="gl">08 · Add secret</div>
        <UiDialog inline aria-label="Add secret">
          <UiDialogBody>
            <UiDialogTitle>Add secret</UiDialogTitle>
            <div class="field"><label>Name</label><UiInputBox focused><span class="mono" style="color: var(--t1)">STRIPE_SECRET_KEY</span></UiInputBox></div>
            <div class="field" style="margin-top: 12px"><label>Value</label><UiInputBox><UiIcon name="lock" :size="13" /><span class="mono" style="color: var(--t1); letter-spacing: .15em">••••••••••••••••••••••</span><UiIconButton icon="eye" :size="13" label="Show" style="margin-left: auto" /></UiInputBox></div>
            <UiBanner tone="warn" icon="warn" :icon-size="14" style="font-size: 12.5px; margin-top: 12px"><div>Encrypted at rest and <b>never shown again</b>. Workers read it as <span class="mono">env.STRIPE_SECRET_KEY</span>.</div></UiBanner>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">worker.secret.add</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Save secret</UiButton></UiDialogFooter>
        </UiDialog>
        <div class="gl" style="margin-top: 12px">09 · Add cron trigger</div>
        <UiDialog inline aria-label="Add cron">
          <UiDialogBody>
            <UiDialogTitle>Add cron trigger</UiDialogTitle>
            <div class="field"><label>Schedule</label><UiInputBox focused><span class="mono" style="color: var(--t1)">*/15 9-18 * * 1-5</span></UiInputBox><div class="ok-l" style="margin-top: 6px"><UiIcon name="clock" :size="12" />Every 15 minutes, 09:00–18:59, Monday to Friday (UTC)</div></div>
            <div class="flb" style="margin: 12px 0 4px">Next 3 runs</div>
            <div class="cron-n"><span>Mon Nov 23 · 09:00 UTC</span><span class="dim">in 1 d 17 h</span></div>
            <div class="cron-n"><span>Mon Nov 23 · 09:15 UTC</span><span class="dim">in 1 d 18 h</span></div>
            <div class="cron-n"><span>Mon Nov 23 · 09:30 UTC</span><span class="dim">in 1 d 18 h</span></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">calls <span class="mono">scheduled()</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton variant="primary" size="sm">Add trigger</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 10 custom domain -->
      <div class="cell">
        <div class="gl">10 · Add custom domain · verifying</div>
        <UiDialog inline aria-label="Add custom domain">
          <UiDialogBody>
            <UiDialogTitle>Add custom domain</UiDialogTitle>
            <div class="field"><label>Hostname</label><UiInputBox focused><span class="mono" style="color: var(--t1)">api.checkumi.com</span></UiInputBox></div>
            <div class="flb" style="margin: 14px 0 6px">Add this DNS record at your provider</div>
            <div style="border: 1px solid var(--b1); border-radius: 8px; padding: 4px 12px; background: var(--bg)">
              <UiKeyValueRow label="Type">CNAME</UiKeyValueRow>
              <UiKeyValueRow label="Name">api</UiKeyValueRow>
              <div style="padding: 8px 0 6px"><div class="hint" style="margin-bottom: 4px">Target</div><div style="display: flex; align-items: center; gap: 6px"><span class="mono" style="font-size: 12.5px; color: var(--t1)">w-checkumi-edge.example.dev</span><UiIconButton icon="copy" :size="13" label="Copy target" style="margin-left: auto" /></div></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px">
              <div class="ok-l"><UiIcon name="check" :size="12" />DNS resolves to the edge · 14:58:10</div>
              <div style="display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--warn)"><UiIcon name="spin" :size="12" />Issuing TLS certificate (Let's Encrypt HTTP-01)…</div>
              <div class="hint" style="padding-left: 18px">Usually under 2 minutes. You can close this dialog.</div>
            </div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">domain.add</span></span><UiButton variant="secondary" size="sm">Close</UiButton></UiDialogFooter>
        </UiDialog>
        <div class="gl" style="margin-top: 12px">10b · TLS issued</div>
        <div class="card" style="padding: 12px 14px; display: flex; align-items: center; gap: 10px"><UiBadge tone="ok" dot>ACTIVE</UiBadge><span class="mono" style="font-size: 13px">api.checkumi.com</span><span class="hint" style="margin-left: auto">TLS · until Feb 19</span></div>
      </div>

      <!-- 11 delete worker -->
      <div class="cell">
        <div class="gl">11 · Delete worker</div>
        <UiDialog inline aria-label="Delete worker">
          <UiDialogBody>
            <UiDialogTitle>Delete checkumi-edge?</UiDialogTitle>
            <p class="muted" style="font-size: 13px; margin: 0 0 10px; line-height: 1.55">Removes 43 deployments, 2 routes, 1 custom domain and 3 cron triggers. The URL <span class="mono">w-checkumi-edge.example.dev</span> stops serving immediately.</p>
            <UiBanner tone="info" icon="info" :icon-size="14" style="font-size: 12.5px; margin-bottom: 12px"><div>Bindings are <b>detached, not deleted</b>: KV <span class="mono">sessions</span>, D1 <span class="mono">checkumi-prod</span>, R2 <span class="mono">checkumi-uploads</span> and queue <span class="mono">playtown-events</span> keep their data. Durable Object storage for <span class="mono">RoomDO</span> is deleted.</div></UiBanner>
            <div class="field"><label>Type <span class="mono" style="color: var(--t1)">checkumi-edge</span> to confirm</label><UiInputBox focused><span class="mono" style="color: var(--t1)">checkumi-edge</span></UiInputBox></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">worker.delete</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton size="sm" style="background: var(--err); color: #fff; border-color: transparent">Delete worker</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 12 delete kv key / bucket -->
      <div class="cell">
        <div class="gl">12 · Delete KV key</div>
        <UiDialog inline aria-label="Delete KV key">
          <UiDialogBody>
            <UiDialogTitle>Delete key?</UiDialogTitle>
            <p class="muted" style="font-size: 13px; margin: 0; line-height: 1.55"><span class="mono" style="color: var(--t1)">session:u_291c:9f0a</span> in <span class="mono">sessions</span> · 1.4 KiB · expires in 6 d. Reads may still return it from edge caches for up to 60 s.</p>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto">audit <span class="mono">kv.key.delete</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton size="sm" style="background: var(--err); color: #fff; border-color: transparent">Delete key</UiButton></UiDialogFooter>
        </UiDialog>
        <div class="gl" style="margin-top: 12px">13 · Delete bucket · not empty</div>
        <UiDialog inline aria-label="Delete bucket">
          <UiDialogBody>
            <UiDialogTitle>Delete checkumi-uploads?</UiDialogTitle>
            <UiBanner tone="err" icon="warn" :icon-size="14" style="font-size: 12.5px"><div><b>Bucket must be empty.</b> It still holds 12,840 objects (3.2 GiB). Delete them first, or add a lifecycle rule that expires everything.</div></UiBanner>
            <div style="display: flex; gap: 8px; margin-top: 12px"><UiButton variant="secondary" size="sm"><UiIcon name="ext" :size="12" />Open objects</UiButton><UiButton variant="secondary" size="sm">Add expire-all rule</UiButton></div>
          </UiDialogBody>
          <UiDialogFooter><span class="hint" style="margin-right: auto"><span class="mono">r2.bucket.delete</span></span><UiButton variant="secondary" size="sm">Cancel</UiButton><UiButton size="sm" disabled style="background: var(--err); color: #fff; opacity: .45; border-color: transparent">Delete bucket</UiButton></UiDialogFooter>
        </UiDialog>
      </div>

      <!-- 14 toasts -->
      <div class="cell">
        <div class="gl">14 · Toasts</div>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <UiToast inline><span style="color: var(--ok)"><UiIcon name="check" :size="15" /></span><div><div class="tt">Deployed v44 to checkumi-edge</div><div class="td">100% traffic · 41 KiB · 6.2 s</div></div><UiButton variant="secondary" size="sm" style="margin-left: auto">View</UiButton></UiToast>
          <UiToast inline><span style="color: var(--ok)"><UiIcon name="redo" :size="15" /></span><div><div class="tt">Rolled back to v42</div><div class="td">v43 kept as inactive · 1.1 s</div></div><UiButton variant="secondary" size="sm" style="margin-left: auto">Undo</UiButton></UiToast>
          <UiToast inline><span style="color: var(--warn)"><UiIcon name="clock" :size="15" /></span><div><div class="tt">Purge queued for playtown-events</div><div class="td">18,402 messages · runs in background</div></div></UiToast>
          <UiToast inline style="border-color: rgba(255,92,87,.4)"><span style="color: var(--err)"><UiIcon name="warn" :size="15" /></span><div><div class="tt">Deploy failed — bundle exceeds 10 MiB</div><div class="td">request id <span class="mono">01JD6R0M3Z…9b2</span></div></div><UiIconButton icon="copy" :size="13" label="Copy request id" style="margin-left: auto" /></UiToast>
        </div>
      </div>

      <!-- 15 empty states -->
      <div class="cell">
        <div class="gl">15 · Empty states</div>
        <div class="empty">
          <span class="pico"><UiIcon name="zap" :size="16" /></span>
          <div style="font-size: 15px; font-weight: 600">No Workers yet</div>
          <div class="muted" style="font-size: 13px; max-width: 360px">Deploy from your repo with the CLI, or start from a template.</div>
          <div class="code" style="font-size: 12px; padding: 8px 12px">npx vrt deploy</div>
          <UiButton variant="primary" size="sm"><UiIcon name="plus" :size="12" />Create Worker</UiButton>
        </div>
        <div class="empty" style="padding: 24px">
          <span class="pico"><UiIcon name="layers" :size="16" /></span>
          <div style="font-size: 14px; font-weight: 600">No R2 buckets</div>
          <div class="muted" style="font-size: 12.5px">S3-compatible object storage, no egress fees inside OpenFlare.</div>
          <UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Create bucket</UiButton>
        </div>
      </div>

    </div>
  </div></template>
