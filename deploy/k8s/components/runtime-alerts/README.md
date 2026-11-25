# Runtime alert rules (VictoriaMetrics operator)

Add this optional component to a cell overlay when the VictoriaMetrics
operator (vmalert) is installed:

```yaml
components:
  - ../../components/runtime-alerts
```

It renders one `VMRule` in `openflare-system` with the canonical groups from
`openflare/deploy/alerts/openflare-runtime.yaml` (D1 failover, DO alarm wake
and scale-to-zero alarm-wake latency). The standalone compose profile wires the
same file directly into vmalert; the control-plane `scripts/test` gate keeps
the copies from drifting while the canonical file lives in the runtime
repository.
