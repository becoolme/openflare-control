<script setup lang="ts">
definePageMeta({
  nav: 'Workers',
  crumbs: () => [{ label: 'workers', to: '/workers' }, { label: 'checkumi-edge' }],
})
const overlays = useOverlays(['binding'] as const)
</script>

<template>    <div style="display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 24px; align-items: start">
      <nav class="snav" aria-label="Settings sections">
        <a href="#vars" class="on">Variables &amp; Secrets</a>
        <a href="#bindings">Bindings</a>
        <a href="#domains">Domains &amp; Routes</a>
        <a href="#triggers">Triggers</a>
        <a href="#runtime">Runtime</a>
        <a href="#obs">Observability</a>
        <a href="#hooks">Deploy hooks</a>
        <a href="#webhooks">Webhooks</a>
        <a href="#build">Build &amp; Git</a>
        <a href="#danger" class="dz">Danger zone</a>
      </nav>

      <div style="display: flex; flex-direction: column; gap: 18px; min-width: 0">

        <section class="card sc" id="vars">
          <div class="h"><div style="flex: 1"><div class="sec-t">Variables &amp; Secrets</div><div class="sec-d">Available on <span class="mono">env</span>. Changes create a new version and deploy it to 100%.</div></div><UiButton variant="secondary" size="sm"><UiIcon name="upload" :size="12" />Import .dev.vars</UiButton><UiButton variant="primary" size="sm"><UiIcon name="plus" :size="12" />Add variable</UiButton></div>
          <table class="tbl">
            <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              <tr><td class="mono">MAX_MB</td><td><span class="kind">plaintext</span></td><td class="mono">25</td><td class="mono muted">18m ago</td><td style="text-align: right"><UiIconButton icon="edit" :size="13" label="Edit" /><UiIconButton icon="trash" :size="13" label="Delete" /></td></tr>
              <tr><td class="mono">CORS</td><td><span class="kind">json</span></td><td class="mono" style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{"origins":["https://checkumi.com"]}</td><td class="mono muted">Nov 14</td><td style="text-align: right"><UiIconButton icon="edit" :size="13" label="Edit" /><UiIconButton icon="trash" :size="13" label="Delete" /></td></tr>
              <tr><td class="mono">API_KEY</td><td><span class="kind" style="color: var(--vio); border-color: rgba(167,139,250,.4)"><UiIcon name="lock" :size="9" /> secret</span></td><td><span class="msk">••••••••••••</span></td><td class="mono muted">Nov 10</td><td style="text-align: right"><UiIconButton icon="redo" :size="13" label="Rotate" /><UiIconButton icon="trash" :size="13" label="Delete" /></td></tr>
              <tr><td class="mono">JWT_SECRET</td><td><span class="kind" style="color: var(--vio); border-color: rgba(167,139,250,.4)"><UiIcon name="lock" :size="9" /> secret</span></td><td><span class="msk">••••••••••••</span></td><td class="mono muted">Oct 30</td><td style="text-align: right"><UiIconButton icon="redo" :size="13" label="Rotate" /><UiIconButton icon="trash" :size="13" label="Delete" /></td></tr>
              <tr class="sel"><td><UiInputBox focused style="height: 30px"><input value="STRIPE_WH" aria-label="New variable name" /></UiInputBox></td><td><UiInputBox style="height: 30px; width: 112px"><span class="mono" style="font-size: 12px">secret</span><div style="flex: 1"></div><UiIcon name="updown" :size="11" /></UiInputBox></td><td><UiInputBox style="height: 30px"><input type="password" value="whsec_xxxxxxxxxxxx" aria-label="New variable value" /></UiInputBox></td><td></td><td style="text-align: right; white-space: nowrap"><UiButton variant="primary" size="sm">Save</UiButton></td></tr>
            </tbody>
          </table>
          <div class="f"><UiIcon name="shield" :size="13" /><span>Secrets are encrypted at rest with the cluster KMS key and are write-only — values are never returned by the API or shown again.</span></div>
        </section>

        <section class="card sc" id="bindings">
          <div class="h"><div style="flex: 1"><div class="sec-t">Bindings</div><div class="sec-d">Resolved from <span class="mono">wrangler.toml</span> on each deploy. Editing here produces a new version.</div></div><span class="miss"><UiIcon name="warn" :size="10" />edit outside deploy</span>
            <div style="position: relative"><UiButton variant="secondary" size="sm" @click="overlays.toggle('binding')" :aria-expanded="overlays.isOpen('binding') ? 'true' : 'false'"><UiIcon name="plus" :size="12" />Add binding <UiIcon name="chev" :size="11" /></UiButton>
              <UiMenu v-if="overlays.isOpen('binding')" style="position: absolute; right: 0; top: 36px; width: 230px; z-index: 5">
                <UiMenuLabel>Storage</UiMenuLabel>
                <UiMenuItem highlighted><ResourceBindingChip kind="kv" />KV namespace</UiMenuItem>
                <UiMenuItem><ResourceBindingChip kind="d1" />D1 database</UiMenuItem>
                <UiMenuItem><ResourceBindingChip kind="r2" />R2 bucket</UiMenuItem>
                <UiMenuSeparator />
                <UiMenuLabel>Compute</UiMenuLabel>
                <UiMenuItem><ResourceBindingChip kind="q" />Queue producer</UiMenuItem>
                <UiMenuItem><ResourceBindingChip kind="do" />Durable Object</UiMenuItem>
                <UiMenuItem><ResourceBindingChip kind="sv" label="SV" />Service binding</UiMenuItem>
                <UiMenuItem><ResourceBindingChip kind="hd" />Hyperdrive · Postgres</UiMenuItem>
              </UiMenu>
            </div>
          </div>
          <table class="tbl">
            <thead><tr><th>Variable</th><th>Type</th><th>Resource</th><th>Since</th><th></th></tr></thead>
            <tbody>
              <tr><td class="mono">SESSIONS</td><td><ResourceBindingChip kind="kv" /></td><td class="mono">checkumi-sessions</td><td class="mono muted">v38</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
              <tr><td class="mono">DB</td><td><ResourceBindingChip kind="d1" /></td><td class="mono">checkumi-main</td><td class="mono muted">v38</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
              <tr><td class="mono">UPLOADS</td><td><ResourceBindingChip kind="r2" /></td><td class="mono">checkumi-uploads</td><td class="mono muted">v43</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
              <tr><td class="mono">EVENTS</td><td><ResourceBindingChip kind="q" /></td><td class="mono">checkumi-events</td><td class="mono muted">v39</td><td style="text-align: right"><UiIconButton icon="more" label="More" /></td></tr>
            </tbody>
          </table>
        </section>

        <section class="card sc" id="domains">
          <div class="h"><div style="flex: 1"><div class="sec-t">Domains &amp; Routes</div><div class="sec-d">Custom domains get a certificate automatically once DNS points at the edge.</div></div><UiButton variant="primary" size="sm"><UiIcon name="plus" :size="12" />Add domain</UiButton></div>
          <table class="tbl">
            <thead><tr><th>Domain</th><th>DNS</th><th>TLS</th><th>Added</th><th></th></tr></thead>
            <tbody>
              <tr><td class="mono">w-checkumi-edge.example.dev</td><td><UiBadge tone="ok" dot>PLATFORM</UiBadge></td><td><UiBadge tone="ok" dot>WILDCARD</UiBadge></td><td class="mono muted">Nov 10</td><td></td></tr>
              <tr><td class="mono">edge.checkumi.com</td><td><UiBadge tone="ok" dot>VERIFIED</UiBadge></td><td><UiBadge tone="ok" dot>ISSUED</UiBadge></td><td class="mono muted">Nov 11</td><td style="text-align: right"><UiIconButton icon="trash" :size="13" label="Remove" /></td></tr>
              <tr class="sel"><td class="mono">api.checkumi.app</td><td><UiBadge tone="warn" dot>PENDING</UiBadge></td><td><UiBadge tone="neu">WAITING</UiBadge></td><td class="mono muted">6m ago</td><td style="text-align: right"><UiButton variant="secondary" size="sm"><UiIcon name="redo" :size="12" />Check now</UiButton></td></tr>
            </tbody>
          </table>
          <div style="padding: 14px 18px; border-top: 1px solid var(--b1)">
            <div class="flb" style="margin-bottom: 8px">Add these records at your DNS provider for <span class="mono" style="color: var(--t1)">api.checkumi.app</span></div>
            <table class="tbl" style="border: 1px solid var(--b1); border-radius: 8px">
              <thead><tr><th>Type</th><th>Name</th><th>Value</th><th>Status</th><th></th></tr></thead>
              <tbody>
                <tr><td class="mono">CNAME</td><td class="mono">api</td><td class="mono">edge.example.dev</td><td><span class="hint err" style="margin: 0">not found · last check 40s ago</span></td><td style="text-align: right"><UiIconButton icon="copy" :size="13" label="Copy" /></td></tr>
                <tr><td class="mono">TXT</td><td class="mono">_openflare.api</td><td class="mono">vp-verify=7d1e09c4a2</td><td><span class="hint ok" style="margin: 0">found</span></td><td style="text-align: right"><UiIconButton icon="copy" :size="13" label="Copy" /></td></tr>
              </tbody>
            </table>
          </div>
          <div style="padding: 4px 18px 16px">
            <div style="display: flex; align-items: center; gap: 10px"><div class="flb" style="width: 110px; margin: 0">Route pattern</div>
              <UiInputBox style="height: 32px; flex: 1"><span class="mono" style="font-size: 12.5px">edge.checkumi.com/*</span><div style="flex: 1"></div><span class="kind">all paths</span></UiInputBox>
              <UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Add route</UiButton>
            </div>
          </div>
        </section>

        <section class="card sc" id="triggers">
          <div class="h"><div style="flex: 1"><div class="sec-t">Triggers</div><div class="sec-d">Cron schedules run <span class="mono">scheduled()</span>; queue consumers run <span class="mono">queue()</span>. Times are UTC.</div></div></div>
          <div style="padding: 0 18px 4px; display: flex; align-items: center"><div class="flb" style="flex: 1">Cron triggers</div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Add cron</UiButton></div>
          <table class="tbl">
            <thead><tr><th>Expression</th><th>Meaning</th><th>Next run</th><th>Last result</th><th></th></tr></thead>
            <tbody>
              <tr><td class="mono">*/15 * * * *</td><td class="muted">every 15 minutes</td><td class="mono">14:45 UTC</td><td><UiBadge tone="ok" dot>OK · 212 ms</UiBadge></td><td style="text-align: right"><UiIconButton icon="play" :size="13" label="Run now" /><UiIconButton icon="trash" :size="13" label="Delete" /></td></tr>
              <tr><td class="mono">0 3 * * *</td><td class="muted">daily at 03:00</td><td class="mono">tomorrow 03:00</td><td><UiBadge tone="err" dot>exceededCpu</UiBadge></td><td style="text-align: right"><UiIconButton icon="play" :size="13" label="Run now" /><UiIconButton icon="trash" :size="13" label="Delete" /></td></tr>
            </tbody>
          </table>
          <div style="padding: 16px 18px 4px; display: flex; align-items: center; gap: 8px"><div class="flb" style="flex: 1">Queue consumers</div><span class="miss"><UiIcon name="warn" :size="10" />consumer settings API</span><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Add consumer</UiButton></div>
          <div class="row2" style="grid-template-columns: 1.3fr 1fr 1fr 1fr 1.4fr; padding-top: 8px">
            <div class="field"><div class="flb">Queue</div><UiInputBox><ResourceBindingChip kind="q" /><span class="mono" style="font-size: 12.5px">checkumi-events</span></UiInputBox></div>
            <div class="field"><div class="flb">Batch size</div><UiInputBox><input value="10" aria-label="Batch size" /></UiInputBox></div>
            <div class="field"><div class="flb">Batch timeout</div><UiInputBox><input value="5" aria-label="Batch timeout" /><span class="dim">s</span></UiInputBox></div>
            <div class="field"><div class="flb">Max retries</div><UiInputBox><input value="3" aria-label="Max retries" /></UiInputBox></div>
            <div class="field"><div class="flb">Dead-letter queue</div><UiInputBox><span class="mono" style="font-size: 12.5px">checkumi-events-dlq</span><div style="flex: 1"></div><UiIcon name="updown" :size="11" /></UiInputBox></div>
          </div>
        </section>

        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start">
          <section class="card sc" id="runtime">
            <div class="h"><div style="flex: 1"><div class="sec-t">Runtime</div><div class="sec-d">Changes deploy a new version.</div></div></div>
            <div style="padding: 0 18px 16px; display: flex; flex-direction: column; gap: 12px">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
                <div class="field"><div class="flb">Compatibility date</div><UiInputBox><span class="mono">2026-09-01</span><div style="flex: 1"></div><UiIcon name="clock" :size="12" /></UiInputBox></div>
                <div class="field"><div class="flb">CPU limit</div><UiInputBox><input value="50" aria-label="CPU limit" /><span class="dim">ms</span></UiInputBox></div>
              </div>
              <div class="field"><div class="flb">Compatibility flags</div><UiInputBox style="gap: 6px"><span class="kind" style="color: var(--t1)">nodejs_compat ×</span><span class="kind" style="color: var(--t1)">streams_enable… ×</span><input placeholder="Add…" aria-label="Add compatibility flag" /></UiInputBox></div>
              <div class="field"><div class="flb">Usage model</div><div style="display: flex; gap: 16px; align-items: center; height: 24px"><label class="chk"><UiRadio checked />Standard · CPU-time</label><label class="chk"><UiRadio />Unbound · wall-time</label></div></div>
            </div>
          </section>
          <section class="card sc" id="obs">
            <div class="h"><div style="flex: 1"><div class="sec-t">Observability</div><div class="sec-d">What Logs and <span class="mono">vrt tail</span> can see.</div></div></div>
            <div style="padding: 0 18px 16px; display: flex; flex-direction: column; gap: 13px">
              <div style="display: flex; align-items: center; gap: 12px"><UiSwitch checked /><div style="flex: 1"><div style="font-size: 13.5px">Live tail</div><div class="sm">Stream to connected tail sessions</div></div></div>
              <div style="display: flex; align-items: center; gap: 12px"><UiSwitch checked /><div style="flex: 1"><div style="font-size: 13.5px">Capture <span class="mono">console.*</span></div><div class="sm">256 KiB per invocation · redacted</div></div></div>
              <div style="display: flex; align-items: center; gap: 12px"><UiSwitch /><div style="flex: 1"><div style="font-size: 13.5px; display: flex; gap: 8px; align-items: center">Persist 7 days <span class="miss"><UiIcon name="warn" :size="10" />not built</span></div><div class="sm">Search beyond the live buffer</div></div></div>
              <div style="display: flex; align-items: center; gap: 12px"><div style="flex: 1"><div style="font-size: 13.5px; display: flex; gap: 8px; align-items: center">Sampling <span class="miss"><UiIcon name="warn" :size="10" />not built</span></div></div><UiSegmented role="group" aria-label="Sampling"><UiSegment>1%</UiSegment><UiSegment>10%</UiSegment><UiSegment pressed>100%</UiSegment></UiSegmented></div>
            </div>
          </section>
        </div>

        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start">
          <section class="card sc" id="hooks">
            <div class="h"><div style="flex: 1"><div class="sec-t">Deploy hooks</div><div class="sec-d">POST to build and deploy a branch.</div></div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Create</UiButton></div>
            <div style="padding: 0 18px 8px">
              <div class="dm2" style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--b1)"><div style="flex: 1; min-width: 0"><div style="font-size: 13px">nightly <span class="mono dim">· main</span></div><div class="mono muted" style="font-size: 11.5px"><span class="msk">dh_••••3f0b</span> · used Nov 18</div></div><UiIconButton icon="copy" :size="13" label="Copy" /><UiButton variant="secondary" size="sm"><UiIcon name="redo" :size="12" />Regenerate</UiButton></div>
              <div style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--b1)"><div style="flex: 1; min-width: 0"><div style="font-size: 13px">cms-publish <span class="mono dim">· main</span></div><div class="mono muted" style="font-size: 11.5px"><span class="msk">dh_••••a71c</span> · never used</div></div><UiIconButton icon="copy" :size="13" label="Copy" /><UiButton variant="secondary" size="sm"><UiIcon name="redo" :size="12" />Regenerate</UiButton></div>
            </div>
            <div class="f"><UiIcon name="warn" :size="12" /><span>Anyone with the URL can trigger a deploy.</span></div>
          </section>
          <section class="card sc" id="webhooks">
            <div class="h"><div style="flex: 1"><div class="sec-t">Webhooks</div><div class="sec-d">HMAC-SHA256 signed · HTTPS only.</div></div><UiButton variant="secondary" size="sm"><UiIcon name="plus" :size="12" />Add</UiButton></div>
            <div style="padding: 0 18px 8px">
              <div style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--b1)"><div style="flex: 1; min-width: 0"><div class="mono" style="font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">hooks.slack.com/services/T0…</div><div style="display: flex; gap: 4px; margin-top: 4px"><span class="kind">deploy.succeeded</span><span class="kind">deploy.failed</span></div></div><UiBadge tone="ok" dot>200</UiBadge></div>
              <div style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--b1)"><div style="flex: 1; min-width: 0"><div class="mono" style="font-size: 12.5px">ops.checkumi.com/openflare</div><div style="display: flex; gap: 4px; margin-top: 4px"><span class="kind">rollback</span><span class="kind">cron.failed</span></div></div><UiBadge tone="err" dot>TIMEOUT ×3</UiBadge></div>
            </div>
            <div class="f"><UiIcon name="shield" :size="12" /><span>Private and link-local addresses are rejected.</span></div>
          </section>
        </div>

        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start">
          <section class="card sc" id="build">
            <div class="h"><div style="flex: 1"><div class="sec-t">Build &amp; Git</div><div class="sec-d">Push to main deploys to 100%.</div></div><UiButton variant="secondary" size="sm">Disconnect</UiButton></div>
            <div style="margin: 0 18px; border: 1px solid var(--b1); border-radius: 10px; padding: 10px 12px; display: flex; gap: 10px; align-items: center; background: var(--s2)"><UiIcon name="github" :size="16" /><div style="flex: 1"><div class="mono" style="font-size: 12.5px">acme/checkumi</div><div class="sm">GitHub App #4812</div></div><UiBadge tone="ok" dot>CONNECTED</UiBadge></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px 18px 16px">
              <div class="field"><div class="flb">Branch</div><UiInputBox><span class="mono">main</span></UiInputBox></div>
              <div class="field"><div class="flb">Root directory</div><UiInputBox><span class="mono">workers/edge</span></UiInputBox></div>
              <div class="field"><div class="flb">Build command</div><UiInputBox><span class="mono">pnpm build</span></UiInputBox></div>
              <div class="field"><div class="flb">Deploy command</div><UiInputBox><span class="mono">vrt deploy</span></UiInputBox></div>
            </div>
          </section>
          <section class="card sc" id="danger" style="border-color: rgba(239,68,68,.35)">
            <div class="h"><div style="flex: 1"><div class="sec-t" style="color: var(--err)">Danger zone</div></div></div>
            <div style="padding: 0 18px 14px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--b1)">
              <div style="flex: 1"><div style="font-size: 13.5px; display: flex; gap: 8px; align-items: center">Transfer <span class="miss"><UiIcon name="warn" :size="10" />no API</span></div><div class="sm">Out-of-project bindings are removed.</div></div>
              <UiButton variant="secondary" size="sm">Transfer…</UiButton>
            </div>
            <div style="padding: 14px 18px 18px">
              <div style="font-size: 13.5px">Delete worker</div>
              <div class="muted" style="font-size: 12px; margin: 2px 0 12px">Removes versions, routes, domains, crons and hooks. KV, D1, R2 and Queues are kept.</div>
              <UiInputBox invalid><input value="checkumi-edg" aria-label="Type worker name to confirm" /></UiInputBox>
              <div class="hint err">Type <span class="mono">checkumi-edge</span> to confirm</div>
              <UiButton size="sm" style="margin-top: 10px; background: var(--err); color: #fff; opacity: .5" disabled><UiIcon name="trash" :size="12" />Delete checkumi-edge</UiButton>
            </div>
          </section>
        </div>
      </div>
    </div></template>
