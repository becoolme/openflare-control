# Deploying a cell on Kubernetes

`deploy/k8s` is a Kustomize base plus an example overlay. One cell = one pod
containing `vrt-host`, `vrt-provider` and `cell-controller` (the controller
delivers desired state through a shared `/run/vrt` emptyDir, which cannot
cross pods by design), plus a `vrt-sql` stateful workload for D1.

## Placeholders

`deploy/k8s/overlays/example` lists every value you must fill:
`REPLACE_ME_KEY_ID`, `REPLACE_ME_PUBLIC_KEY` (from the plane's startup log),
`REPLACE_ME_CP_HOST`, `REPLACE_ME_CELL_ID`, `REPLACE_ME_ROUTE_BASE_DOMAIN`,
`REPLACE_ME_WILDCARD_TLS_SECRET`, `REPLACE_ME_STORAGE_CLASS`, S3/Kvrocks
endpoints, and the four image digests.

## Checks before apply

```sh
OPENFLARE_DIR=../openflare node scripts/vrt-k8s-check.mjs deploy/k8s/overlays/example
```

The gate renders the overlay and fails on: residual placeholders, tag-only
images, an ingress other than `:8080`, a missing egress allowlist, a
Kvrocks/S3 asymmetry between provider and cell-controller, or a
`vrt-sql` persistence backend without its egress rule.

## Networking

- Default-deny in the namespace; the tenant ingress rule admits only the front
  proxy (Traefik by default). Retarget it in an overlay when using another
  ingress controller, and keep `[ingress]` trusted CIDRs in sync with the
  policy — the policy is authoritative.
- Tenant egress is public-internet only (43/80/443) with every private,
  link-local, CGNAT and metadata range excluded; the same deny table exists in
  the runtime as a second layer.
- Kvrocks/S3 live in `vrt-data` and monitoring in `vrt-monitoring` by
  default; patch the dedicated `vrt-host-data-egress` policy if yours differ.

## Images

Four images are built from the pinned OpenFlare checkout:
`vrt-host`, `vrt-provider`, `vrt-sql`, `vrt-cell-controller`. The `Release
images` workflow builds them on a `v*` tag and pushes to
`ghcr.io/<owner>/vrt/*`; the build script prints `IMAGE name@sha256:<digest>`
lines that replace the `images:` block in the overlay. Tags alone are
rejected by the render gate — pin digests.

## Production cutover

See [`production-cutover.md`](./production-cutover.md) for the scale-to-zero,
WebSocket hibernation, image-pin and external-alerting checklist.

## Rollout and rollback

ConfigMaps are content-hashed, so changing a TOML restarts the pod. The
`vrt-secrets` Secret is out of band: rotate it and restart the deployments.
Rolling back a plane release means re-applying the previous overlay revision;
the cell immediately converges because the snapshot carries a monotonic
revision fence.

## Probe ingress, storage class and test-only manifests (#65)

- **Kubelet probes and NetworkPolicy (M4/L12).** The cell policy must admit
  kubelet probes to `vrt-host:9090` and `vrt-sql:8082`. The base rules use a
  bare `ports:` entry because probes originate from the node, not a pod
  label. Whether the CNI enforces NetworkPolicy on host/pod traffic varies
  (Calico does, several others do not). To scope the rules, patch `from:`
  with an `ipBlock` for the node/pod CIDR:

  ```yaml
  - from:
      - ipBlock: { cidr: 10.42.0.0/16 } # k3s default pod CIDR
    ports: [{ port: 8082, protocol: TCP }]
  ```

  Keep added blocks inside private ranges; `scripts/vrt-k8s-check.mjs` renders
  and validates the policy.

- **vrt-host startup observability (M7).** The metrics listener
  (`host-metrics`, :9494) binds _before_ the initial-snapshot wait, so
  `GET /metrics` answers during the startup race: a cell waiting for the
  controller is distinguishable from a crashed one, and scrapes start on
  the first second. The cell is still not Ready until desired arrives —
  pod readiness stays transitive through the controller's `/readyz`, and
  the k8s startup/liveness probes stay on the ingress socket (the serving
  check) with the 10-minute startup gate. The all-in-one healthcheck now
  requires the metrics socket in addition to the live workerd child.

- **Local-path storage (M6).** `components/local-path-perms` is an opt-in
  workaround for storage classes without `fsGroup` support (k3s local-path).
  It runs a root `chown` init container and therefore lowers the namespace to
  `baseline`. Prefer a storage class that honors `fsGroup` (Longhorn, EBS,
  CephFS, ...) and do not include the component there.

- **`deploy/k8s/e2e/plane.yaml` is test-only (L14).** It ships a committed
  `vrt/vrt` Postgres with no securityContext, resource limits or
  NetworkPolicy. Never use it outside the kind e2e.
