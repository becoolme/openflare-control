# Migrating Vibeploy onto this repository

Vibeploy now consumes this repository as a **Git dependency** and no longer
carries a copy:

```json
"openflare-control": "github:becoolme/openflare-control#v0.2.1&path:packages/control"
```

`scripts/check-vibeploy-sync.mjs` verifies the dependency is declared and that
`server/src/vrt-control` is gone (fail closed if both exist):

```sh
VIBEPLOY_DIR=../vibeploy node scripts/check-vibeploy-sync.mjs
```

The remaining steps:

1. **Optional: switch Git to npm.** `release-npm.yml` publishes on a manual
   workflow run with `NPM_TOKEN`. Once published, change the dependency to
   `"openflare-control": "^0.2.1"`; no import changes are needed.
2. **Use the manifests as a remote base.** In Vibeploy's private overlay:

   ```yaml
   resources:
     - github.com/becoolme/openflare-control//deploy/k8s/base?ref=v0.2.1
   ```

   Delete `server/tools/vrt-platform/k8s/{base,components,overlays/example}`;
   keep only `overlays/internal-test` (private values). `vrt-k8s-check.mjs`
   moves with the base, so the gate keeps running against the pinned ref.

3. **Publish images here.** `release-images.yml` builds the four images from
   the pinned OpenFlare checkout and pushes digest-pinned tags. Vibeploy
   overlays only reference those digests; it no longer builds the Rust images.
4. **Retire the reverse dependency.** Vibeploy's CI no longer passes
   `VRT_DEPLOY_TOML_DIRS` into a private path: this repository's `k8s` job
   renders its own overlay, and OpenFlare's `deploy_toml` tests can point at
   it.

This repository remains the source of truth for the portable files; the sync
gate still runs in review to catch a reintroduced copy.
