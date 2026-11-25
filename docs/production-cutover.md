# Production cutover: scale-to-zero, WebSocket hibernation and alerts

This is the repository-side checklist for rolling out the cell features that
are now enabled in `deploy/k8s`. It does not apply anything to a cluster.

## 1. Build from the pinned runtime

`OPENFLARE_CONTRACT_REV` is the source of truth for the runtime the manifests
were tested against (currently `4a18cd1`). Rebuild and digest-pin all four
images from that exact OpenFlare revision; the base config uses
`scaleToZero.alarmWakeGraceMs`, which older runtimes reject as an unknown key.

- `vrt-host`, `vrt-provider`, `vrt-cell-controller`, `vrt-sql`
- replace the `images:` digests in the production overlay
- `OPENFLARE_DIR=<checkout@pin> node scripts/vrt-k8s-check.mjs <overlay>`

## 2. Cell config already enabled

`deploy/k8s/base/config/vrt-host.toml` and the example overlay enable:

- `[scaleToZero] enabled = true` (10 min idle, 2 min residency)
- `[ingress.websocket] hibernation = true` (64 KiB replay window)
- `alarmWakeGraceMs = 60000`

Confirm the production overlay replaces every `REPLACE_ME_*` value and keeps
the content-hashed ConfigMaps. A config change must roll the pod.

## 3. External monitoring

- Install the VictoriaMetrics operator, then opt into
  `deploy/k8s/components/runtime-alerts` in the overlay. It renders the
  `VMRule` with D1, DO alarm and scale-to-zero groups.
- Point vmalert at the existing VictoriaMetrics datasource/notifier. For the
  standalone stack, use `VMALERT_DATASOURCE_URL`, `VMALERT_REMOTE_WRITE_URL`
  and `VMALERT_NOTIFIER_URL`.
- Do not ship the silent Alertmanager receiver to production. Start from
  `openflare/deploy/standalone/monitoring/alertmanager.webhook.example.yml`
  (or a Slack/PagerDuty equivalent) and keep the real endpoint and
  credentials outside both repositories.

## 4. Watch the first tenant cycle

- `vrt_host_hibernate_total{outcome="committed"}` — tenants actually sleep.
- `vrt_host_wake_total{source="alarm"|"websocket"}` and
  `vrt_host_wake_seconds{source="alarm"}` — wake path/latency.
- `vrt_host_ws_session_end_total{reason="detached"|"reattached"}` — WS
  sessions survive sleep; `reattach_failed`/`replay_overflow` mean the replay
  window is too small or the client is misbehaving.
- Alerts: `OpenflareAlarmWakeSlow`, `OpenflareDoAlarmWakeFailures`,
  `OpenflareDoSessionsFailReattach` (see `openflare/docs/runtime-alerts.md`).

## 5. Rollback

Set `[scaleToZero] enabled = false` and
`[ingress.websocket] hibernation = false` in the overlay and re-apply; the
content hash rolls the pod. Remove the `runtime-alerts` component if the
operator/vmalert is not ready. Existing WebSocket sessions close on the
config roll, which is the pre-feature behavior.
