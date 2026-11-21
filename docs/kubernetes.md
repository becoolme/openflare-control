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

## Rollout and rollback

ConfigMaps are content-hashed, so changing a TOML restarts the pod. The
`vrt-secrets` Secret is out of band: rotate it and restart the deployments.
Rolling back a plane release means re-applying the previous overlay revision;
the cell immediately converges because the snapshot carries a monotonic
revision fence.
