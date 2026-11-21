# Migrating Vibeploy onto this repository

During the split, Vibeploy keeps a byte-identical copy at
`server/src/vrt-control`. `scripts/check-vibeploy-sync.mjs` fails if the two
diverge; `--write` propagates this repository into Vibeploy.

```sh
VIBEPLOY_DIR=../vibeploy node scripts/check-vibeploy-sync.mjs
```

The remaining steps need the repository to exist on a remote (push it first):

1. **Publish the package.** Push a `v*` tag; `release-npm.yml` builds
   `openflare-control` and publishes it. Then Vibeploy adds
   `"openflare-control": "^0.1.0"` and replaces relative imports of
   `server/src/vrt-control/*` with the package. The existing `export *` shims
   make that mechanical: change each shim to `export * from 'openflare-control'`,
   delete the copied sources once typecheck and tests are green.
2. **Use the manifests as a remote base.** In Vibeploy's private overlay:

   ```yaml
   resources:
     - github.com/becoolme/openflare-control//deploy/k8s/base?ref=v0.1.0
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

Until step 1 lands, treat this repository as the source of truth for the
portable files and run the sync gate in review.
